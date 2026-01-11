const browserAPI = chrome || browser;
const store = '3D Shards';
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


// https://3dshards.com/account-4/downloads/
async function mainParsing() {
  // get all order URLs from the library page
  const productRows = document.querySelectorAll('.woocommerce-table--order-downloads tbody tr');
  if (productRows.length === 0) {
    sendTestResultMessage("mainParsing(): DOM query order downloads table rows", false, "No product rows found on downloads page.");
    return;
  }
  else {
    sendTestResultMessage("mainParsing(): DOM query order downloads table rows", true, `Found ${productRows.length} product rows on downloads page.`);
  }

  const orderDict = {};
  let rowNum = 1, singleTestFindDownloadProduct = true, singleTestDownloadProductDetails = true;
  // console.log(`(${store}) found ${productRows.length} products in downloads page. mainParsing `, productRows);

  for (const item of productRows) {
    if (!allowedToParse) { break; }
    const downloadProduct = item.querySelector('.download-product');
    if (!downloadProduct) {
      sendTestResultMessage("mainParsing(): find downloadProduct", false, `Missing .download-product element in downloads page row ${rowNum}.`);
      return;
    }
    else if (singleTestFindDownloadProduct) {
      sendTestResultMessage("mainParsing(): find downloadProduct", true, `Found .download-product element in downloads page row ${rowNum}.`);
      singleTestFindDownloadProduct = false;
    }

    const link = downloadProduct.querySelector('a');
    const url = (link) ? link.href : '';
    const title = downloadProduct.textContent.trim();

    if (!url) {
      console.warn("mainParsing(): downloadProduct URL is empty; occasionally that happens", rowNum);
    }
    if (!title) {
      sendTestResultMessage("mainParsing(): downloadProduct details", false, `Missing downloadProduct details in downloads page row ${rowNum}. [url: ${url}, title: ${title}]`);
      return;
    }
    else if (singleTestDownloadProductDetails) {
      sendTestResultMessage("mainParsing(): downloadProduct details", true, `Found downloadProduct details in downloads page row ${rowNum}.`);
      singleTestDownloadProductDetails = false;
    }

    if (url in orderDict) {
      continue;
    }

    orderDict[url] = {'url':url, 'title':title};
    rowNum += 1;

    if (rowNum > iterationLimitPerTest) {
      break; // limit number of orders parsed for testing
    }
  }
  // console.log(`(${store}) found ${Object.keys(orderDict).length} products in downloads page. mainParsing `, orderDict);

  const orderUrls = await getOrderUrls();
  let downloadsParsed = 0;

  for (const orderUrl of orderUrls) {
    if (!allowedToParse) { break; }
    downloadsParsed += await parseOrderDetailsPage(orderUrl, orderDict, downloadsParsed);
  }

}
// unsure if 3dshards provides pagination


async function getOrderUrls() {
  const orderUrl = 'https://3dshards.com/account-4/orders/';
  const response = await fetch(orderUrl);

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}, ` + orderUrl);
    sendTestResultMessage("getOrderUrls(): fetch Order", false, `Failed to fetch order from ${orderUrl}. HTTP status: ${response.status}`);
    return null;
  }
  else {
    sendTestResultMessage("getOrderUrls(): fetch Order", true, `Successfully fetched order from ${orderUrl}.`);
  }

  const htmlString = await response.text();
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(htmlString, 'text/html');

  const rows = doc.querySelectorAll('.woocommerce-orders-table tbody tr');
  if (rows.length === 0) {
    sendTestResultMessage("getOrderUrls(): DOM query orders table rows", false, "No rows found on orders page.");
    return;
  }
  else {
    sendTestResultMessage("getOrderUrls(): DOM query orders table rows", true, `Found ${rows.length} rows on orders page.`);
  }

  const orderUrls = [];
  let singleTestFindOrderLink = true, rowNum = 1;
  
  for (const item of rows) {
    const link = item.querySelector('th a');
    if (!link || !link.href) {
      sendTestResultMessage("getOrderUrls(): find order link", false, `Missing order link in orders page row ${rowNum}.`);
      return;
    }
    else if (singleTestFindOrderLink) {
      sendTestResultMessage("getOrderUrls(): find order link", true, `Found order link in orders page row ${rowNum}.`);
      singleTestFindOrderLink = false;
    }

    const url = link.href;
    orderUrls.push(url);
    rowNum += 1;

    if (rowNum > iterationLimitPerTest) {
      break; // limit number of orders parsed for testing
    }
  }

  // console.log(`(${store}) found ${orderUrls.length} orders, getOrderUrls`, orderUrls);
  return orderUrls;
}


async function parseOrderDetailsPage(orderUrl, orderDict, downloadsParsedAlready) {
  const urlTokens = orderUrl.split('/'); //    https://3dshards.com/account-4/view-order/40132/
  const orderId = urlTokens[urlTokens.length - 2];
  const totalDownloads = Object.keys(orderDict).length;
  const response = await fetch(orderUrl);

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}, ` + orderUrl);
    sendTestResultMessage("parseOrderDetailsPage(): fetch Order Details", false, `Failed to fetch order details from ${orderUrl}. HTTP status: ${response.status}`);
    return 0;
  }
  else {
    sendTestResultMessage("parseOrderDetailsPage(): fetch Order Details", true, `Successfully fetched order details from ${orderUrl}.`);
  }

  const htmlString = await response.text();
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(htmlString, 'text/html');

  const purchaseDate = doc.querySelector('.order-date').textContent;
  const products = doc.querySelectorAll('.woocommerce-order-details .woocommerce-table--order-details tbody tr');
  // console.log(`(${store}) parsing order ${orderId}, found ${products.length} products. parseOrderDetailsPage,`, products);
  if (products.length === 0) {
    sendTestResultMessage("parseOrderDetailsPage(): DOM query order details table rows", false, "No rows found on order details page.");
    return;
  }
  else {
    sendTestResultMessage("parseOrderDetailsPage(): DOM query order details table rows", true, `Found ${products.length} rows on order details page.`);
  }

  let productCount = 0, rowNum = 1, singleTestFindProductNameLink = true, singleTestProductPublishers = true, singleTestProductPublisherLink = true;

  for (const item of products) {
    if (!allowedToParse) { break; }
    const link = item.querySelector('.product-name a');
    if (!link || !link.href) {
      sendTestResultMessage("parseOrderDetailsPage(): find product name link", false, `Missing product name link in order details page row ${rowNum}.`);
      return 0;
    }
    else if (singleTestFindProductNameLink) {
      sendTestResultMessage("parseOrderDetailsPage(): find product name link", true, `Found product name link in order details page row ${rowNum}.`);
      singleTestFindProductNameLink = false;
    }

    const productUrl = link.href;
    const title = link.textContent.trim();

    const publishers = item.querySelectorAll('.product-name ul.wc-item-meta li');
    if (!publishers || publishers.length === 0) {
      sendTestResultMessage("parseOrderDetailsPage(): find product publishers", false, `Missing product publishers in order details page row ${rowNum}.`);
      return 0;
    }
    else if (singleTestProductPublishers) {
      sendTestResultMessage("parseOrderDetailsPage(): find product publishers", true, `Found product publishers in order details page row ${rowNum}.`);
      singleTestProductPublishers = false;
    }

    const publisherList = [];
    for (const p of publishers) {
      if (!p.querySelector('a')) {
        sendTestResultMessage("parseOrderDetailsPage(): find product publisher link", false, `Missing product publisher link in order details page row ${rowNum}.`);
        return 0;
      }
      else if (singleTestProductPublisherLink) {
        sendTestResultMessage("parseOrderDetailsPage(): find product publisher link", true, `Found product publisher link in order details page row ${rowNum}.`);
        singleTestProductPublisherLink = false;
      }

      const pName = p.querySelector('a').textContent;
      publisherList.push(pName);
    }
    const publisher = publisherList.join(', ');

    const productDetails = await getProductDetails(productUrl);
    if (!productDetails) {
      return 0;
    }
    
    const imgUrl = (productDetails) ? productDetails.imgUrl : '';
    let category = (productDetails) ? productDetails.category : null;
    if (category === '') { category = null; } // avoid empty string as category key
    const tags = null;
    const currentAssets = {};
    const product = {'url':productUrl, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':tags, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[productUrl] = product;
    productCount += 1;

    if (productCount > iterationLimitPerTest) {
      break; // limit number of products parsed per order for testing
    }

    rowNum += 1;
  }

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return products.length;
}


async function getProductDetails(productUrl) {
  const response = await fetch(productUrl);

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}, ` + productUrl);
    sendTestResultMessage("getProductDetails(): fetch Product Details", false, `Failed to fetch product from ${productUrl}. HTTP status: ${response.status}`);
    return null;
  }
  else {
    sendTestResultMessage("getProductDetails(): fetch Product Details", true, `Successfully fetched product from ${productUrl}.`);
  }

  const htmlString = await response.text();
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(htmlString, 'text/html');

  const imgPreviewLink = doc.head.querySelector('meta[property="og:image"]');
  if (!imgPreviewLink) {
    sendTestResultMessage("getProductDetails(): DOM query product image", false, "No product image found on product page.");
    return;
  }
  else {
    sendTestResultMessage("getProductDetails(): DOM query product image", true, "Found product image on product page.");
  }
  
  const categoryElement = doc.querySelector('.product-single-category');
  if (!categoryElement) {
    sendTestResultMessage("getProductDetails(): DOM query product category", false, "No product category found on product page.");
    return;
  }
  else {
    sendTestResultMessage("getProductDetails(): DOM query product category", true, "Found product category on product page.");
  }

  const imgUrl = imgPreviewLink ? imgPreviewLink.content.replace('scaled.jpg', 'scaled-400x520.jpg') : '';
  const category = categoryElement ? categoryElement.textContent : '';

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return { imgUrl, category };
}
