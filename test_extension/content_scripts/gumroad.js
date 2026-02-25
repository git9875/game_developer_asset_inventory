const browserAPI = chrome || browser;
const store = 'Gumroad';
const sleepMilliseconds = 500;
let allowedToParse = false;

const groupTimestamp = createLocalDateISO();
const iterationLimitPerTest = 3;
let totalTestsRun = 0;
let totalTestsPassed = 0;



browserAPI.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    // console.log(`(${store}) Message from the background script:`, request.command);

    if (request.command === "PARSE_GAME_ASSETS") {
        console.log(`(${store}) Start parsing`);
        allowedToParse = true;
        await mainParsing();

        console.log(`(${store}) Finished parsing. Total tests ran: ${totalTestsPassed}`);
        browserAPI.runtime.sendMessage({ source:"CONTENT", action:"TESTS_FINISHED"});
    }
    else if (request.command === "STOP_PARSING_GAME_ASSETS") {
        console.log(`(${store}) Stopping parsing as per request.`);
        allowedToParse = false;
    }
});


function createLocalDateISO() {
  const date = new Date();
  const localTimestamp = date.getTime() - date.getTimezoneOffset() * 60 * 1000;
  const localDate = new Date(localTimestamp);
  return localDate.toISOString().slice(0, -1).replace('T', ' '); // Remove the 'Z'
}

function sendTestResultMessage(testName, pass, details) {
  console.log(`(${store}) Test Result - ${testName}: ${pass ? "PASS" : "FAIL"} - ${details}`);

    totalTestsRun += 1;
    if (pass) {
      totalTestsPassed += 1;
    }

    browserAPI.runtime.sendMessage({ source:"CONTENT", action:"TEST_RESULT",
      progress: { total: totalTestsRun, passed: totalTestsPassed },
      data: {
        store: store,
        testName: testName,
        pass: pass,
        details: details,
        timestamp: createLocalDateISO(),
        groupTimestamp: groupTimestamp
      }
  });
}



// https://gumroad.com/library
async function mainParsing() {
  // get all order URLs from the library page
  const productArticles = document.querySelectorAll('.library section article');
  if (productArticles.length === 0) {
    sendTestResultMessage("mainParsing(): find product rows", false, `No product rows found on the library page.`);
    return;
  }
  else {
    sendTestResultMessage("mainParsing(): find product rows", true, `Found ${productArticles.length} product rows on the library page.`);
  }

  const orderDict = {};
  let i = 1;

  for (const item of productArticles) {
    if (!item.querySelector('a')) {
      sendTestResultMessage("mainParsing(): find product link", false, `Product row missing link element in row ${i}.`);
      continue;
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("mainParsing(): find product link", true, `Product row contains link element in row ${i}.`);
    }

    const url = item.querySelector('a').href;
    if (url in orderDict) {
      continue;
    }
    orderDict[url] = true;
    i += 1;
  }

  const totalPages = Object.keys(orderDict).length;
  // console.log(`(${store}) mainParsing Found ${totalPages} orders to process.`, orderDict);
  let currentPage = 0;
  const receiptUrls = {};
  i = 1;
  console.log("orderDict", orderDict);

  for (const url in orderDict) {
    if (!allowedToParse) { break; }
    const receiptUrl = await getReceiptUrl(url);
    currentPage += 1;

    if (!receiptUrl) {
      console.error(`Gumroad HTTP error! ` + url);
      sendTestResultMessage("getReceiptUrl(): fetch receipt page", false, `Failed to fetch receipt page or parse receipt URL from ${url}.`);
      break;
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("getReceiptUrl(): fetch receipt page", true, `Successfully fetched receipt page and parsed receipt URL from ${url}.`);
    }
    // console.log(`(${store}) mainParsing Got receipt URL: ` + receiptUrl);

    if (receiptUrl in receiptUrls) {
      continue; // skip duplicates
    }
    receiptUrls[receiptUrl] = true;

    await parsePurchaseReceiptPage(receiptUrl, currentPage, totalPages);
  }

  i += 1;
}


// this might be a problem since it sometimes verify being human
async function getReceiptUrl(orderUrl) {
    const response = await fetch(orderUrl);

    if (!response.ok) {
      if (response.status === 403) {
        alert("Gumroad 403 response prevented script from accessing purchase data.\nClick on a purchased item (to verify you are human),\nreturn to this page, and try again.");
        sendTestResultMessage("getReceiptUrl(): fetch receipt page", false, `Gumroad returned 403 Forbidden for ${orderUrl}. User verification may be required.`);
        return null;
      }

      console.error(`${store} HTTP error! status: ${response.status}, ` + orderUrl);
      sendTestResultMessage("getReceiptUrl(): fetch receipt page", false, `Gumroad returned HTTP error ${response.status} for ${orderUrl}.`);
      return null;
    }
    

    const htmlString = await response.text();
    let encodedJsonStartIdx = htmlString.indexOf('id="app" data-page="');
    if (encodedJsonStartIdx == -1) {
      alert("Gumroad prevented script from accessing purchase data.\nClick on a purchased item (to verify you are human),\nreturn to this page, and try again.");
      sendTestResultMessage("getReceiptUrl(): receipt page find purchase URL string", false, `Failed to parse receipt HTML from ${orderUrl}. User verification may be required.`);
      return null;
    }
    
    encodedJsonStartIdx += 20;
    const encodedJsonEndIdx = htmlString.indexOf('"', encodedJsonStartIdx);
    const htmlEncodedJson = htmlString.substring(encodedJsonStartIdx, encodedJsonEndIdx);
    const decodedJsonString = htmlEncodedJson.replace(/&quot;/g, '"'); // Handle HTML entities
    console.log('decodedJsonString', decodedJsonString);
    const jsonData = JSON.parse(decodedJsonString);
    let purchaseId = jsonData.props.purchase.bundle_purchase_id ? jsonData.props.purchase.bundle_purchase_id : jsonData.props.purchase.id;
    const receiptUrl = 'https://gumroad.com/purchases/' + purchaseId + '/receipt?email=' + jsonData.props.purchase.email; // https://gumroad.com/purchases/lsdfsdfie==/receipt?email=test%40test.com
    console.log("Parsed receipt URL:", receiptUrl);
    return receiptUrl;
}


async function parsePurchaseReceiptPage(receiptUrl, currentPage, totalPages) {
  const urlTokens = receiptUrl.split('/'); //    https://gumroad.com/purchases/XrsdflYAIW5NCUIIOLH69fQ==/receipt?email=test%40email.com

  if (urlTokens.length < 6) {
    sendTestResultMessage("parsePurchaseReceiptPage(): validate receipt URL structure to extract order ID", false, `Invalid receipt URL structure: ${receiptUrl}`);
    return null;
  }
  else {
    sendTestResultMessage("parsePurchaseReceiptPage(): validate receipt URL structure to extract order ID", true, `Valid receipt URL structure: ${receiptUrl}`);
  }

  const orderId = urlTokens[4];
  // console.log(`(${store}) parsePurchaseReceiptPage Parsing receipt page: ` + receiptUrl);
  const response = await fetch(receiptUrl);

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}, ` + receiptUrl);
    sendTestResultMessage("parsePurchaseReceiptPage(): fetch receipt page", false, `Failed to fetch receipt page from ${receiptUrl}. HTTP status: ${response.status}`);
    return null;
  }
  else if (currentPage < iterationLimitPerTest) {
    sendTestResultMessage("parsePurchaseReceiptPage(): fetch receipt page", true, `Successfully fetched receipt page from ${receiptUrl}`);
  }

  const htmlString = await response.text();
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(htmlString, 'text/html');

  const queryReceiptDate = doc.querySelectorAll('.receipt .info-row');
  if (queryReceiptDate.length < 2) {
    sendTestResultMessage("parsePurchaseReceiptPage(): parse receipt date", false, `Failed to parse receipt date from ${receiptUrl}.`);
    return null;
  }
  else if (currentPage < iterationLimitPerTest) {
    sendTestResultMessage("parsePurchaseReceiptPage(): parse receipt date", true, `Successfully parsed receipt date from ${receiptUrl}.`);
  }

  const purchaseDateElement = queryReceiptDate[1].querySelector('.info-value');
  if (!purchaseDateElement) {
    sendTestResultMessage("parsePurchaseReceiptPage(): validate receipt date element", false, `Receipt date element not found in receipt page ${receiptUrl}.`);
    return null;
  }
  else if (currentPage < iterationLimitPerTest) {
    sendTestResultMessage("parsePurchaseReceiptPage(): validate receipt date element", true, `Receipt date element found in receipt page ${receiptUrl}.`);
  }

  const purchaseDate = doc.querySelectorAll('.receipt .info-row')[1].querySelector('.info-value').textContent;
  const products = doc.querySelectorAll('.main .item');
  const currentAssets = {};

  if (products.length === 0) {
    console.warn(`${store} No purchased items found in receipt page ${receiptUrl}.`);
    sendTestResultMessage("parsePurchaseReceiptPage(): parse purchased items", false, `No purchased items found in receipt page ${receiptUrl}.`);
    return null;
  }
  else if (currentPage < iterationLimitPerTest) {
    sendTestResultMessage("parsePurchaseReceiptPage(): parse purchased items", true, `Found ${products.length} purchased items in receipt page ${receiptUrl}.`);
  }

  let i = 1;

  for (const item of products) {
    if (!item.querySelector('.figure a')) {
      sendTestResultMessage("parsePurchaseReceiptPage(): validate product link element", false, `Product link element not found in receipt page ${receiptUrl}.`);
      continue;
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("parsePurchaseReceiptPage(): validate product link element", true, `Product link element found in receipt page ${receiptUrl}.`);
    }

    if (!item.querySelector('.figure img')) {
      sendTestResultMessage("parsePurchaseReceiptPage(): validate product image element", false, `Product image element not found in receipt page ${receiptUrl}.`);
      continue;
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("parsePurchaseReceiptPage(): validate product image element", true, `Product image element found in receipt page ${receiptUrl}.`);
    }


    const url = item.querySelector('.figure a').href;
    const imgUrl = item.querySelector('.figure img').src;
    const titles = item.querySelector('.section .content');


    if (!titles.querySelector('h4 a')) {
      sendTestResultMessage("parsePurchaseReceiptPage(): validate product title element", false, `Product title element not found in receipt page ${receiptUrl}.`);
      continue;
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("parsePurchaseReceiptPage(): validate product title element", true, `Product title element found in receipt page ${receiptUrl}.`);
    }

    if (!titles.querySelector('.footer span a')) {
      sendTestResultMessage("parsePurchaseReceiptPage(): validate product publisher element", false, `Product publisher element not found in receipt page ${receiptUrl}.`);
      continue;
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("parsePurchaseReceiptPage(): validate product publisher element", true, `Product publisher element found in receipt page ${receiptUrl}.`);
    }

    const title = titles.querySelector('h4 a').textContent;
    const publisher = titles.querySelector('.footer span a').textContent;
    // const category = await getCategoryFromProductPage(url);

    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':null, 'tags':null, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[url] = product;

    i += 1;
  }

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
}

/*
// Cannot fetch category due to CORS restrictions on subdomains of product URLs.
// It can be done via background script, but that requires more effort than it's worth right now.
async function getCategoryFromProductPage(url) {
  url = url + '?layout=discover'; // required to get taxonomy_path
  console.log(`(${store}) getCategoryFromProductPage Parsing product page: ` + url);
  const response = await fetch(url);

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}, ` + url);
    return null;
  }

  const htmlString = await response.text();
  let taxonomyStartIdx = htmlString.indexOf('"taxonomy_path":"');
  if (taxonomyStartIdx == -1) {
    return null;
  }

  taxonomyStartIdx += 17;
  const taxonomyEndIdx = htmlString.indexOf('"', taxonomyStartIdx);
  const category = htmlString.substring(taxonomyStartIdx, taxonomyEndIdx);

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return category;
}
*/