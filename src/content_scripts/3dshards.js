const browserAPI = chrome || browser;
const store = '3D Shards';
const sleepMilliseconds = 500;
let allowedToParse = false;

browserAPI.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
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


// https://3dshards.com/account-4/downloads/
async function mainParsing() {
  // get all order URLs from the library page
  const productRows = document.querySelectorAll('.woocommerce-table--order-downloads tbody tr');
  const orderDict = {};
  // console.log(`(${store}) found ${productRows.length} products in downloads page. mainParsing `, productRows);

  for (const item of productRows) {
    if (!allowedToParse) { break; }
    const downloadProduct = item.querySelector('.download-product');
    const link = downloadProduct.querySelector('a');
    const url = (link) ? link.href : '';
    const title = downloadProduct.textContent.trim();

    if (url in orderDict) {
      continue;
    }

    orderDict[url] = {'url':url, 'title':title};
  }
  // console.log(`(${store}) found ${Object.keys(orderDict).length} products in downloads page. mainParsing `, orderDict);

  const orderUrls = await getOrderUrls();
  const totalPages = orderUrls.length;
  let currentPageNumber = 1;
  let downloadsParsed = 0;

  for (const orderUrl of orderUrls) {
    if (!allowedToParse) { break; }
    downloadsParsed += await parseOrderDetailsPage(orderUrl, orderDict, currentPageNumber, totalPages, downloadsParsed);
    currentPageNumber += 1;
  }
}
// unsure if 3dshards provides pagination


async function getOrderUrls() {
  const orderUrl = 'https://3dshards.com/account-4/orders/';
  const response = await fetch(orderUrl);

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}, ` + orderUrl);
    return null;
  }

  const htmlString = await response.text();
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(htmlString, 'text/html');

  const rows = doc.querySelectorAll('.woocommerce-orders-table tbody tr');
  const orderUrls = [];
  for (const item of rows) {
    const link = item.querySelector('th a');
    const url = link.href;
    orderUrls.push(url);
  }

  // console.log(`(${store}) found ${orderUrls.length} orders, getOrderUrls`, orderUrls);
  return orderUrls;
}


async function parseOrderDetailsPage(orderUrl, orderDict, currentPageNumber, totalPages, downloadsParsedAlready) {
  const urlTokens = orderUrl.split('/'); //    https://3dshards.com/account-4/view-order/40132/
  const orderId = urlTokens[urlTokens.length - 2];
  const totalDownloads = Object.keys(orderDict).length;
  const response = await fetch(orderUrl);

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}, ` + orderUrl);
    return null;
  }

  const htmlString = await response.text();
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(htmlString, 'text/html');

  const purchaseDate = doc.querySelector('.order-date').textContent;
  const products = doc.querySelectorAll('.woocommerce-order-details .woocommerce-table--order-details tbody tr');
  // console.log(`(${store}) parsing order ${orderId}, found ${products.length} products. parseOrderDetailsPage,`, products);
  let productCount = 0;

  for (const item of products) {
    if (!allowedToParse) { break; }
    const link = item.querySelector('.product-name a');
    const productUrl = link.href;
    const title = link.textContent.trim();

    const publishers = item.querySelectorAll('.product-name ul.wc-item-meta li');
    const publisherList = [];
    for (const p of publishers) {
      const pName = p.querySelector('a').textContent;
      publisherList.push(pName);
    }
    const publisher = publisherList.join(', ');

    const productDetails = await getProductDetails(productUrl);
    const imgUrl = (productDetails) ? productDetails.imgUrl : '';
    let category = (productDetails) ? productDetails.category : null;
    if (category === '') { category = null; } // avoid empty string as category key
    const tags = null;
    const currentAssets = {};
    const product = {'url':productUrl, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':tags, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[productUrl] = product;
    productCount += 1;
    const overallCount = downloadsParsedAlready + productCount;

    const percentDone = (overallCount == totalDownloads) ? 100 : Math.min( Math.round( (overallCount / totalDownloads) * 100 ), 99 );
    // console.log(`(${store}) parsed product download ${overallCount} of ${totalDownloads} (${percentDone}%)`);
    
    browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
        percentDone: percentDone,
        assets: currentAssets
    } });
  }

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return products.length
}


async function getProductDetails(productUrl) {
  const response = await fetch(productUrl);

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}, ` + productUrl);
    return null;
  }

  const htmlString = await response.text();
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(htmlString, 'text/html');
  const imgPreviewLink = doc.head.querySelector('meta[property="og:image"]');
  const imgUrl = imgPreviewLink ? imgPreviewLink.content.replace('scaled.jpg', 'scaled-400x520.jpg') : '';
  const categoryElement = doc.querySelector('.product-single-category');
  const category = categoryElement ? categoryElement.textContent : '';

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return { imgUrl, category };
}
