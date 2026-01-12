const browserAPI = chrome || browser;
const store = 'CGTrader';
const sleepMilliseconds = 500;
let allowedToParse = false;

const groupTimestamp = createLocalDateISO();
const iterationLimitPerTest = 3;
let totalTestsRun = 0;
let totalTestsPassed = 0;



browserAPI.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.command === "PARSE_GAME_ASSETS") {
        console.log(`(${store}) Start parsing`);
        allowedToParse = true;
        await mainParsing();

        console.log(`(${store}) Finished parsing. Total tests ran: ${totalTestsPassed}`);
        browserAPI.runtime.sendMessage({ source:"CONTENT", action:"TESTS_FINISHED"});
    }
    else if (request.command === "STOP_PARSING") {
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



async function mainParsing() {
    let currentPageNumber = 1;

    while (currentPageNumber) {
      if (!allowedToParse) { break; }
      currentPageNumber = await parseAssetsFromPurchases(currentPageNumber, sleepMilliseconds);

      if (totalTestsRun >= iterationLimitPerTest) {
        break; // limit number of pages parsed for testing
      }
    }
    // console.log(`(${store}) finished parsing all pages`);
}


async function parseAssetsFromPurchases(currentPageNumber, sleepMilliseconds) {
  const apiUrl = 'https://www.cgtrader.com/api/internal/profile/purchases?status%5B%5D=paid&page=' + currentPageNumber;
  const response = await fetch(apiUrl);

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}, ` + apiUrl);
    sendTestResultMessage("parseAssetsFromPurchases(): fetch Purchase page", false, `Failed to fetch purchases from ${apiUrl}. HTTP status: ${response.status}`);
    return null;
  }
  else {
    sendTestResultMessage("parseAssetsFromPurchases(): fetch Purchase page", true, `Successfully fetched purchases from ${apiUrl}`);
  }

  const jsonData = await response.json();
  // console.log(`(${store}) jsonData`, jsonData);
  const currentAssets = {};
  const totalPages = jsonData['meta']['totalPages'];
  const items = jsonData['data'];

  if (items.length === 0) {
    console.warn(`${store} No purchased items found on page ${currentPageNumber}.`);
    sendTestResultMessage("parseAssetsFromPurchases(): parse item data", false, `No purchased items found on page ${currentPageNumber}.`);
    return null;
  }
  else {
    sendTestResultMessage("parseAssetsFromPurchases(): parse item data", true, `Found ${items.length} purchased items on page ${currentPageNumber}.`);
  }

  if (!totalPages || totalPages < 1) {
    console.warn(`${store} Invalid total pages value: ${totalPages}`);
    sendTestResultMessage("parseAssetsFromPurchases(): validate total pages", false, `Invalid total pages value: ${totalPages}`);
    return null;
  }
  else {
    sendTestResultMessage("parseAssetsFromPurchases(): validate total pages", true, `Total pages value is valid: ${totalPages}`);
  }

  let i = 0;

  for (const item of items) {
    const attr = item['attributes'];
    const imgUrl = attr['image'];
    const url = attr['itemLink'];
    const publisher = attr['user'];
    const title = attr['title'];
    const purchaseDate = attr['paidAt'];
    const orderId = attr['invoicePath'].split('/')[2];

    // category can be parsed from URL path pattern
    const urlTokens = url.split('/');
    const category = urlTokens.slice(3, urlTokens.lastIndexOf('/')).join('/');

    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':null, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};

    if (!imgUrl || !url || !title || !publisher || !purchaseDate || !orderId || !category) {
      console.warn(`${store} Incomplete product data:`, product);
      sendTestResultMessage("parseAssetsFromPurchases(): validate product data", false, `Missing some product data for ${title}`);
      continue;
    }
    else {
      sendTestResultMessage("parseAssetsFromPurchases(): validate product data", true, `Product data is complete for ${title}`);
    }

    currentAssets[url] = product;
    i += 1;

    if (i >= iterationLimitPerTest) {
      break; // limit number of products parsed per page for testing
    }
  }

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return (currentPageNumber < totalPages) ? currentPageNumber + 1 : null;
}
