const browserAPI = chrome || browser;
const store = 'Gumroad';
const sleepMilliseconds = 500;
let allowedToParse = false;

browserAPI.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    // console.log(`(${store}) Message from the background script:`, request.command);

    if (request.command === "PARSE_GAME_ASSETS") {
        console.log(`(${store}) Start parsing`);
        allowedToParse = true;
        mainParsing();
    }
    else if (request.command === "STOP_PARSING_GAME_ASSETS") {
        console.log(`(${store}) Stopping parsing as per request.`);
        allowedToParse = false;
    }
});


// https://gumroad.com/library
async function mainParsing() {
  // get all order URLs from the library page
  const productArticles = document.querySelectorAll('.library section article');
  const orderDict = {};
  for (const item of productArticles) {
    const url = item.querySelector('a').href;
    if (url in orderDict) {
      continue;
    }
    orderDict[url] = true;
  }

  const totalPages = Object.keys(orderDict).length;
  // console.log(`(${store}) mainParsing Found ${totalPages} orders to process.`, orderDict);
  let currentPage = 0;
  const receiptUrls = {};

  for (const url in orderDict) {
    if (!allowedToParse) { break; }
    const receiptUrl = await getReceiptUrl(url);
    currentPage += 1;

    if (!receiptUrl) {
      console.error(`Gumroad HTTP error! ` + url);

      browserAPI.runtime.sendMessage({ source:"CONTENT", action:"ERROR", data: {
          message: 'Unable to access Gumroad purchase data. Please verify you are human by clicking on a purchased item, then return to this page and try again.'
      } });

      break;
    }
    // console.log(`(${store}) mainParsing Got receipt URL: ` + receiptUrl);

    if (receiptUrl in receiptUrls) {
      continue; // skip duplicates
    }
    receiptUrls[receiptUrl] = true;

    await parsePurchaseReceiptPage(receiptUrl, currentPage, totalPages);
  }

  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
      percentDone: 100,
      assets: {}
  } });
}


// this might be a problem since it sometimes verify being human
async function getReceiptUrl(orderUrl) {
    const response = await fetch(orderUrl);

    if (!response.ok) {
      if (response.status === 403) {
        alert("Gumroad 403 response prevented script from accessing purchase data.\nClick on a purchased item (to verify you are human),\nreturn to this page, and try again.");
      }

      console.error(`${store} HTTP error! status: ${response.status}, ` + orderUrl);
      return null;
    }

    const htmlString = await response.text();
    let encodedJsonStartIdx = htmlString.indexOf('id="app" data-page="');
    if (encodedJsonStartIdx == -1) {
      alert("Gumroad prevented script from accessing purchase data.\nClick on a purchased item (to verify you are human),\nreturn to this page, and try again.");
      return null;
    }
    
    encodedJsonStartIdx += 20;
    const encodedJsonEndIdx = htmlString.indexOf('"', encodedJsonStartIdx);
    const htmlEncodedJson = htmlString.substring(encodedJsonStartIdx, encodedJsonEndIdx);
    const decodedJsonString = htmlEncodedJson.replace(/&quot;/g, '"'); // Handle HTML entities
    const jsonData = JSON.parse(decodedJsonString);
    let purchaseId = jsonData.props.purchase.bundle_purchase_id ? jsonData.props.purchase.bundle_purchase_id : jsonData.props.purchase.id;
    const receiptUrl = 'https://gumroad.com/purchases/' + purchaseId + '/receipt?email=' + jsonData.props.purchase.email; // https://gumroad.com/purchases/lsdfsdfie==/receipt?email=test%40test.com
    return receiptUrl;
}


async function parsePurchaseReceiptPage(receiptUrl, currentPage, totalPages) {
  const urlTokens = receiptUrl.split('/'); //    https://gumroad.com/purchases/lsdfsdfie==/receipt?email=test%40test.com
  const orderId = urlTokens[4];
  // console.log(`(${store}) parsePurchaseReceiptPage Parsing receipt page: ` + receiptUrl);
  const response = await fetch(receiptUrl);

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}, ` + receiptUrl);
    return null;
  }

  const htmlString = await response.text();
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(htmlString, 'text/html');

  const purchaseDate = doc.querySelectorAll('.receipt .info-row')[1].querySelector('.info-value').textContent;
  const products = doc.querySelectorAll('.main .item');
  const currentAssets = {};

  for (const item of products) {
    const url = item.querySelector('.figure a').href;
    const imgUrl = item.querySelector('.figure img').src;
    const titles = item.querySelector('.section .content');
    const title = titles.querySelector('h4 a').textContent;
    const publisher = titles.querySelector('.footer span a').textContent;
    // const category = await getCategoryFromProductPage(url);

    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':null, 'tags':null, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[url] = product;
  }

  const percentDone = Math.round( (currentPage / totalPages) * 100 );
  // console.log(`(${store}) parsePurchaseReceiptPage Parsed ${Object.keys(currentAssets).length} assets from receipt page ${currentPage}/${totalPages} (${percentDone}%)`);

  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
      percentDone: percentDone,
      assets: currentAssets
  } });

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