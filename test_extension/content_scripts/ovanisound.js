const browserAPI = chrome || browser;
const store = 'Ovani Sound';
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



// https://ovanisound.com/account
async function mainParsing() {
  // get all order URLs from the order history page
  const orders = document.querySelectorAll('.order-history tbody tr');
  const totalOrders = orders.length;
  let pageNumber = 1;

  if (totalOrders === 0) {
    sendTestResultMessage("mainParsing(): validate order history", false, `No orders found in order history.`);
    return;
  }
  else {
    sendTestResultMessage("mainParsing(): validate order history", true, `Found ${totalOrders} orders in order history.`);
  }

  for (const item of orders) {
    if (!allowedToParse) { break; }
    const link = item.querySelector('a');

    if (!link) {
      sendTestResultMessage("mainParsing(): validate order link", false, `No order link found on order history row, page ${pageNumber}.`);
      continue;
    }
    else if (pageNumber <= iterationLimitPerTest) {
      sendTestResultMessage("mainParsing(): validate order link", true, `Order link found on order history row, page ${pageNumber}.`);
    }

    if (!item.querySelector('time')) {
      sendTestResultMessage("mainParsing(): validate purchase date", false, `No purchase date found on order history row, page ${pageNumber}.`);
      continue;
    }
    else if (pageNumber <= iterationLimitPerTest) {
      sendTestResultMessage("mainParsing(): validate purchase date", true, `Purchase date found on order history row, page ${pageNumber}.`);
    }

    const orderUrl = link.href;
    const orderId = link.textContent.trim().replace('#', '');
    const purchaseDate = item.querySelector('time').textContent.trim();
    await getOrderDetails(orderUrl, orderId, purchaseDate, pageNumber, totalOrders);
    pageNumber += 1;

    if (pageNumber > iterationLimitPerTest) {
      break;
    }
  }
}


async function getOrderDetails(orderUrl, orderId, purchaseDate, pageNumber, totalPages) {
  const response = await fetch(orderUrl);

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}, ` + orderUrl);
    sendTestResultMessage("getOrderDetails(): fetch order details", false, `Failed to fetch order details from ${orderUrl} . HTTP status: ${response.status}`);
    return null;
  }
  else {
    sendTestResultMessage("getOrderDetails(): fetch order details", true, `Successfully fetched order details from ${orderUrl} . HTTP status: ${response.status}`);
  }

  const htmlString = await response.text();
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(htmlString, 'text/html');
  const products = doc.querySelectorAll('.order-details tbody tr');
  let currentAssets = {};
  const assetsByTitle = {};
  let i = 1;

  if (products.length === 0) {
    sendTestResultMessage("getOrderDetails(): validate products in order", false, `No products found in order ${orderId}`);
    return;
  }
  else {
    sendTestResultMessage("getOrderDetails(): validate products in order", true, `Found ${products.length} products in order ${orderId}`);
  }

  for (const item of products) {
    const pitem = item.querySelector('td[data-label="Product"] div');

    if (!pitem) {
      sendTestResultMessage("getOrderDetails(): validate product item", false, `No product item found in order ${orderId}, row ${i}`);
      continue;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("getOrderDetails(): validate product item", true, `Product item found in order ${orderId}, row ${i}`);
    }

    const link = pitem.querySelector('a');

    if (!link) {
      sendTestResultMessage("getOrderDetails(): validate product link", false, `No product link found in order ${orderId}, row ${i}.`);
      continue;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("getOrderDetails(): validate product link", true, `Product link found in order ${orderId}, row ${i}.`);
    }

    const url = link.href;
    const title = link.textContent.trim();
    const imgUrl = null; // no image available
    const publisher = store;
    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[url] = product;
    assetsByTitle[title] = product;

    i += 1;
  }

  // find downloads link
  const downloadLinkStartIdx = htmlString.indexOf('/apps/digital-downloads/orders/');
  if (downloadLinkStartIdx != -1) {
    const downloadLinkEndIdx = htmlString.indexOf('"', downloadLinkStartIdx);

    if (downloadLinkEndIdx == -1) {
      sendTestResultMessage("getOrderDetails(): validate download link", false, `Could not find the end of download link in order ${orderId} near /apps/digital-downloads/orders/`);
      return;
    }
    else if (pageNumber <= iterationLimitPerTest) {
      sendTestResultMessage("getOrderDetails(): validate download link", true, `Download link found in order ${orderId} near /apps/digital-downloads/orders/`);
    }

    const downloadUrl = 'https://ovanisound.com' + htmlString.substring(downloadLinkStartIdx, downloadLinkEndIdx);
    await getDownloadDetailsProductListings(downloadUrl, assetsByTitle);
  }
  else {
    sendTestResultMessage("getOrderDetails(): validate download link", false, `Could not find download link in order ${orderId} near /apps/digital-downloads/orders/`);
  }

  if (Object.keys(assetsByTitle).length == 1) {
    const firstAssetByTitle = Object.values(assetsByTitle)[0];
    if (!('orderAssetsCount' in firstAssetByTitle) && firstAssetByTitle['orderAssetsCount'] == 0) {
      sendTestResultMessage("getOrderDetails(): validate order assets count", false, `No assets found in download details for order ${orderId}`);
    }
    else {
      sendTestResultMessage("getOrderDetails(): validate order assets count", true, `Found assets in download details for order ${orderId}`);
    }
  }

  if (Object.keys(assetsByTitle).length == 1 && Object.values(assetsByTitle)[0]['orderAssetsCount'] > 5) {
    // likely a bundle, try to get more details from product page
    const firstProduct = Object.values(assetsByTitle)[0];

    if (!('url' in firstProduct)) {
      sendTestResultMessage("getOrderDetails(): validate first product URL", false, `No URL found for first product in order ${orderId}`);
      return;
    }
    else if (pageNumber <= iterationLimitPerTest) {
      sendTestResultMessage("getOrderDetails(): validate first product URL", true, `URL found for first product in order ${orderId}`);
    }

    const productUrl = firstProduct['url'];
    const newAssets = await getProductDetailsPageAssets(productUrl, orderId, purchaseDate);
    if (newAssets) {
      currentAssets = newAssets;
    }
  }
  else {
    // update currentAssets with any found images from download details page
    i=1;

    for (const url in currentAssets) {
      if (!('title' in currentAssets[url])) {
        sendTestResultMessage("getOrderDetails(): validate product title", false, `No title found for product URL ${url}`);
        continue;
      }
      else if (i <= iterationLimitPerTest) {
        sendTestResultMessage("getOrderDetails(): validate product title", true, `Title found for product URL ${url}`);
      }

      const title = currentAssets[url]['title'];
      if (title in assetsByTitle) {
        const assetInfo = assetsByTitle[title];
        if ('imgUrl' in assetInfo && assetInfo['imgUrl']) {
          currentAssets[url]['imgUrl'] = assetInfo['imgUrl'];
        }
        else {
          // not sure if this should be a test since the original code allowed null images
          console.warn(`(${store}) getOrderDetails(): No image URL found for product title "${title}" in order ${orderId}.`, assetInfo);
        }
      }

      i += 1;
    }
  }

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
}



// download page parsing to reveal individual product details such as the image URL
async function getDownloadDetailsProductListings(downloadDetailsUrl, assetsByTitle) {
    const downloadsResponse = await fetch(downloadDetailsUrl);
    if (!downloadsResponse.ok) {
      console.error(`${store} HTTP error! status: ${downloadsResponse.status}, ` + downloadDetailsUrl);
      sendTestResultMessage("getDownloadDetailsProductListings(): fetch download details", false, `Failed to fetch download details from ${downloadDetailsUrl} . HTTP status: ${downloadsResponse.status}`);
      return null;
    }
    else {
      sendTestResultMessage("getDownloadDetailsProductListings(): fetch download details", true, `Successfully fetched download details from ${downloadDetailsUrl} . HTTP status: ${downloadsResponse.status}`);
    }

    const downloadsHtmlStr = await downloadsResponse.text();
    const doc = new DOMParser().parseFromString(downloadsHtmlStr, 'text/html');
    let i = 1;
    const productItems = doc.querySelectorAll('#MainContent .dda-order__item');

    for (const item of productItems) {
        const title = item.querySelector('.dda-order__item-name').textContent.trim();
        if (!(title in assetsByTitle)) {
          console.warn(`(${store}) getDownloadDetailsProductListings: Title not found in assetsByTitle: "${title}" in`, downloadDetailsUrl);
          sendTestResultMessage("getDownloadDetailsProductListings(): validate product title", false, `Title not found in assetsByTitle: "${title}" in ${downloadDetailsUrl}`);
          continue;
        }
        else if (i <= iterationLimitPerTest) {
          sendTestResultMessage("getDownloadDetailsProductListings(): validate product title", true, `Title found in assetsByTitle: "${title}" in ${downloadDetailsUrl}`);
        }

        // get image URL
        const headerImg = item.querySelector('.dda-order__item-image');
        if (headerImg) {
          const imgUrl = item.querySelector('.dda-order__item-image').src + '&width=320';

          if (!('imgUrl' in assetsByTitle[title]) || !assetsByTitle[title]['imgUrl']) {
            sendTestResultMessage("getDownloadDetailsProductListings(): validate product image URL", true, `Image URL found for product title "${title}" in ${downloadDetailsUrl}`);
          }
          else if (i <= iterationLimitPerTest) {
            sendTestResultMessage("getDownloadDetailsProductListings(): validate product image URL", true, `Image URL already exists for product title "${title}" in ${downloadDetailsUrl} , overwriting with new URL.`);
          }
          assetsByTitle[title]['imgUrl'] = imgUrl;
        }
        else {
          // should this be a test failure?
          console.warn(`(${store}) getDownloadDetailsProductListings(): No image URL found for product title "${title}" in ${downloadDetailsUrl}`);
          sendTestResultMessage("getDownloadDetailsProductListings(): validate product image URL", false, `No image URL found for product title "${title}" in ${downloadDetailsUrl}`);
        }

        // some items contain multiple assets, which may indicate a bundle
        const orderAssetsCount = item.querySelectorAll('.dda-order__asset').length;
        assetsByTitle[title]['orderAssetsCount'] = orderAssetsCount;

        if (orderAssetsCount == 0) {
          sendTestResultMessage("getDownloadDetailsProductListings(): validate order assets count", false, `No assets found for product title "${title}" in ${downloadDetailsUrl}`);
        }
        else if (i <= iterationLimitPerTest) {
          sendTestResultMessage("getDownloadDetailsProductListings(): validate order assets count", true, `Found ${orderAssetsCount} assets for product title "${title}" in ${downloadDetailsUrl}`);
        }

        i += 1;
    }
}


// looking at product page to find bundle contents
async function getProductDetailsPageAssets(productUrl, orderId, purchaseDate) {
    const response = await fetch(productUrl);

    if (!response.ok) {
      console.error(`${store} HTTP error! status: ${response.status}, ` + productUrl);
      sendTestResultMessage("getProductDetailsPageAssets(): fetch product page", false, `Failed to fetch product page from ${productUrl} . HTTP status: ${response.status}`);
      return null;
    }
    else {
      sendTestResultMessage("getProductDetailsPageAssets(): fetch product page", true, `Successfully fetched product page from ${productUrl} . HTTP status: ${response.status}`);
    }

    const htmlString = await response.text();
    const domParser = new DOMParser();
    const doc = domParser.parseFromString(htmlString, 'text/html');

    const bundleGridCards = doc.querySelectorAll('.bundle-grid .bundle-card');
    if (!bundleGridCards || bundleGridCards.length == 0) {
      sendTestResultMessage("getProductDetailsPageAssets(): validate bundle contents", false, `No bundle contents found on product page ${productUrl}`);
      return null;
    }
    else {
      sendTestResultMessage("getProductDetailsPageAssets(): validate bundle contents", true, `Found ${bundleGridCards.length} bundle contents on product page ${productUrl}`);
    }

    const currentAssets = {};
    let i = 1;

    for (const item of bundleGridCards) {
      if (!item.querySelector('.card__media img')) {
        sendTestResultMessage("getProductDetailsPageAssets(): validate bundle item image", false, `No image found for bundle item on product page ${productUrl} , row ${i}.`);
        continue;
      }
      else if (i <= iterationLimitPerTest) {
        sendTestResultMessage("getProductDetailsPageAssets(): validate bundle item image", true, `Image found for bundle item on product page ${productUrl} , row ${i}.`);
      }

      let imgUrl = item.querySelector('.card__media img').src;
      if (imgUrl.startsWith('//')) {
        imgUrl = 'https:' + imgUrl;
      }

      if (imgUrl.indexOf('&width=') == -1) {
        sendTestResultMessage("getProductDetailsPageAssets(): validate bundle item image URL format", false, `Image URL missing width parameter for bundle item on product page ${productUrl} , row ${i}.`);
      }
      else if (i <= iterationLimitPerTest) {
        sendTestResultMessage("getProductDetailsPageAssets(): validate bundle item image URL format", true, `Image URL contains width parameter for bundle item on product page ${productUrl} , row ${i}.`);
      }

      imgUrl = imgUrl.substring(0, imgUrl.indexOf('&width=')) + '&width=320'; // standardize width

      if (!item.querySelector('.card__heading a')) {
        sendTestResultMessage("getProductDetailsPageAssets(): validate bundle item link", false, `No link found for bundle item on product page ${productUrl} , row ${i}.`);
        continue;
      }
      else if (i <= iterationLimitPerTest) {
        sendTestResultMessage("getProductDetailsPageAssets(): validate bundle item link", true, `Link found for bundle item on product page ${productUrl} , row ${i}.`);
      }

      const url = item.querySelector('.card__heading a').href;

      if (!(item.dataset && 'productTitle' in item.dataset)) {
        sendTestResultMessage("getProductDetailsPageAssets(): validate bundle dataset item title", false, `No title found for bundle item on product page ${productUrl} , row ${i}.`);
        continue;
      }
      else if (i <= iterationLimitPerTest) {
        sendTestResultMessage("getProductDetailsPageAssets(): validate bundle dataset item title", true, `Title found for bundle item on product page ${productUrl} , row ${i}.`);
      }

      const title = item.dataset['productTitle'];
      const publisher = store;
      const orderId = '';
      const purchaseDate = '';

      // parse tags from title; music genres are too many and diverse to capture reliably
      const titleLower = title.toLowerCase();
      const tags = [];
      if (titleLower.includes('sound')) {
        tags.push('sound');
      }
      if (titleLower.includes('pack')) {
        tags.push('pack');
      }
      if (titleLower.includes('music')) {
        tags.push('music');
      }
      if (titleLower.includes('sound sfx')) {
        tags.push('sound-sfx');
      }
      if (titleLower.includes('plugin')) {
        tags.push('plugin');
      }
      if (titleLower.includes('voice')) {
        tags.push('voice');
      }

      if (tags.length == 0) {
        // it's possible for a title to not have these keywords
        console.warn(`(${store}) getProductDetailsPageAssets(): No tags found for bundle item "${title}" on product page ${productUrl}, row ${i}.`);
      }

      const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':null, 'tags':tags, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
      currentAssets[url] = product;

      i += 1;
    }

    const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
    await sleepPromise;
    return currentAssets;
}