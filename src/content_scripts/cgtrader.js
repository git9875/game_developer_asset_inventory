const browserAPI = chrome || browser;
const store = 'CGTrader';
const sleepMilliseconds = 500;
let allowedToParse = false;


browserAPI.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    // console.log(`(${store}) Message from the background script:`, request.command);

    if (request.command === "PARSE_GAME_ASSETS") {
        console.log(`(${store}) Start parsing`);
        allowedToParse = true;
        mainParsing();
    }
    else if (request.command === "STOP_PARSING") {
        console.log(`(${store}) Stopping parsing as per request.`);
        allowedToParse = false;
    }
});


async function mainParsing() {
    let currentPageNumber = 1;

    while (currentPageNumber) {
      if (!allowedToParse) { break; }
      currentPageNumber = await parseAssetsFromPurchases(currentPageNumber, sleepMilliseconds);
    }
    // console.log(`(${store}) finished parsing all pages`);
}


async function parseAssetsFromPurchases(currentPageNumber, sleepMilliseconds) {
  const apiUrl = 'https://www.cgtrader.com/api/internal/profile/purchases?status%5B%5D=paid&page=' + currentPageNumber;
  const response = await fetch(apiUrl);

  if (!response.ok) {
    // console.error(`(${store}) HTTP error! status: ${response.status}`);
    return null;
  }

  const jsonData = await response.json();
  // console.log(`(${store}) jsonData`, jsonData);
  const currentAssets = {};
  const totalPages = jsonData['meta']['totalPages'];
  const items = jsonData['data'];

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
    currentAssets[url] = product;
  }

  const percentDone = Math.round((currentPageNumber / totalPages) * 100);
  // console.log(`(${store}) parsed page ${currentPageNumber} of ${totalPages} (${percentDone}%)`);
  
  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
      percentDone: percentDone,
      assets: currentAssets
  } });

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return (currentPageNumber < totalPages) ? currentPageNumber + 1 : null;
}
