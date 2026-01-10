const browserAPI = chrome || browser;
const store = 'Blender';
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

// https://superhivemarket.com/account/orders
async function mainParsing() {
  const orderRows = document.querySelectorAll('.orders-table tbody tr');
  const totalPages = orderRows.length;
  let pageNum = 1;

  for (const orderRow of orderRows) {
    if (!allowedToParse) { break; }
    const link = orderRow.querySelector('td:nth-child(5) a');
    const url = link.href;
    const purchaseDate = orderRow.querySelector('td:first-child').textContent.trim();
    await parseOrders(url, pageNum, totalPages, purchaseDate);
    pageNum += 1;
  }
}


async function parseOrders(downloadsUrl, pageNum, totalPages, purchaseDate) {
  const response = await fetch(downloadsUrl);

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}, ` + downloadsUrl);
    return null;
  }

  const htmlString = await response.text();
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(htmlString, 'text/html');
  const h1 = doc.querySelector('h1');
  const orderId = h1.textContent.substring( h1.textContent.indexOf('#')+1, h1.textContent.length-1 );
  const downloadList = doc.querySelectorAll('ul.list-unstyled li.cart-item');
  const currentAssets = {};

  for (const item of downloadList) {
    const link = item.querySelector('h5 a');
    const url = link.href;
    const title = link.textContent;
    const publisher = item.querySelector('p a').textContent;
    const category = item.querySelector('p a:nth-of-type(2)').textContent;
    const imgUrl = item.querySelector('img').src;
    // tags are available on each product page, but skipping for now
    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':null, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[url] = product;
  }

  const percentDone = Math.round( (pageNum / totalPages) * 100 );

  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
      percentDone: percentDone,
      assets: currentAssets
  } });

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
}
// what to do if there are only download zip files and no titles or images?
