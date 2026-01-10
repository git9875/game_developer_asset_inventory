const browserAPI = chrome || browser;
const store = 'Ovani Sound';
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


// https://ovanisound.com/account
async function mainParsing() {
  // get all order URLs from the order history page
  const orders = document.querySelectorAll('.order-history tbody tr');
  const totalOrders = orders.length;
  let pageNumber = 1;

  for (const item of orders) {
    if (!allowedToParse) { break; }
    const link = item.querySelector('a');
    const orderUrl = link.href;
    const orderId = link.textContent.trim().replace('#', '');
    const purchaseDate = item.querySelector('time').textContent.trim();
    await getOrderDetails(orderUrl, orderId, purchaseDate, pageNumber, totalOrders);
    pageNumber += 1;
  }
}


async function getOrderDetails(orderUrl, orderId, purchaseDate, pageNumber, totalPages) {
  const response = await fetch(orderUrl);

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}, ` + orderUrl);
    return null;
  }

  const htmlString = await response.text();
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(htmlString, 'text/html');
  const products = doc.querySelectorAll('.order-details tbody tr');
  let currentAssets = {};
  const assetsByTitle = {};

  for (const item of products) {
    const pitem = item.querySelector('td[data-label="Product"] div');
    const link = pitem.querySelector('a');
    const url = link.href;
    const title = link.textContent.trim();
    const imgUrl = null; // no image available
    const publisher = store;
    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[url] = product;
    assetsByTitle[title] = product;
  }

  // find downloads link
  const downloadLinkStartIdx = htmlString.indexOf('/apps/digital-downloads/orders/');
  if (downloadLinkStartIdx != -1) {
    const downloadLinkEndIdx = htmlString.indexOf('"', downloadLinkStartIdx);
    const downloadUrl = 'https://ovanisound.com' + htmlString.substring(downloadLinkStartIdx, downloadLinkEndIdx);
    await getDownloadDetailsProductListings(downloadUrl, assetsByTitle);
  }

  if (Object.keys(assetsByTitle).length == 1 && Object.values(assetsByTitle)[0]['orderAssetsCount'] > 5) {
    // likely a bundle, try to get more details from product page
    const firstProduct = Object.values(assetsByTitle)[0];
    const productUrl = firstProduct['url'];
    const newAssets = await getProductDetailsPageAssets(productUrl, orderId, purchaseDate);
    if (newAssets) {
      currentAssets = newAssets;
    }
  }
  else {
    // update currentAssets with any found images from download details page
    for (const url in currentAssets) {
      const title = currentAssets[url]['title'];
      if (title in assetsByTitle) {
        const assetInfo = assetsByTitle[title];
        if ('imgUrl' in assetInfo && assetInfo['imgUrl']) {
          currentAssets[url]['imgUrl'] = assetInfo['imgUrl'];
        }
      }
    }
  }

  const percentDone = Math.round( (pageNumber / totalPages) * 100 );

  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
      percentDone: percentDone,
      assets: currentAssets
  } });

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
}



// download page parsing to reveal individual product details such as the image URL
async function getDownloadDetailsProductListings(downloadDetailsUrl, assetsByTitle) {
    const downloadsResponse = await fetch(downloadDetailsUrl);
    if (!downloadsResponse.ok) {
      console.error(`${store} HTTP error! status: ${downloadsResponse.status}, ` + downloadDetailsUrl);
      return null;
    }

    const downloadsHtmlStr = await downloadsResponse.text();
    const doc = new DOMParser().parseFromString(downloadsHtmlStr, 'text/html');

    const productItems = doc.querySelectorAll('#MainContent .dda-order__item');
    for (const item of productItems) {
        const title = item.querySelector('.dda-order__item-name').textContent.trim();
        if (!(title in assetsByTitle)) {
          console.warn(`(${store}) getDownloadDetailsProductListings: Title not found in assetsByTitle: "${title}" in`, downloadDetailsUrl);
          continue;
        }

        // get image URL
        const headerImg = item.querySelector('.dda-order__item-image');
        if (headerImg) {
          const imgUrl = item.querySelector('.dda-order__item-image').src + '&width=320';
          assetsByTitle[title]['imgUrl'] = imgUrl;
        }

        // some items contain multiple assets, which may indicate a bundle
        const orderAssetsCount = item.querySelectorAll('.dda-order__asset').length;
        assetsByTitle[title]['orderAssetsCount'] = orderAssetsCount;
    }
}


// looking at product page to find bundle contents
async function getProductDetailsPageAssets(productUrl, orderId, purchaseDate) {
    const response = await fetch(productUrl);

    if (!response.ok) {
      console.error(`${store} HTTP error! status: ${response.status}, ` + productUrl);
      return null;
    }

    const htmlString = await response.text();
    const domParser = new DOMParser();
    const doc = domParser.parseFromString(htmlString, 'text/html');

    const bundleGridCards = doc.querySelectorAll('.bundle-grid .bundle-card');
    if (!bundleGridCards || bundleGridCards.length == 0) {
      return null;
    }

    const currentAssets = {};

    for (const item of bundleGridCards) {
      let imgUrl = item.querySelector('.card__media img').src;
      if (imgUrl.startsWith('//')) {
        imgUrl = 'https:' + imgUrl;
      }
      imgUrl = imgUrl.substring(0, imgUrl.indexOf('&width=')) + '&width=320'; // standardize width

      const url = item.querySelector('.card__heading a').href;
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


      const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':null, 'tags':tags, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
      currentAssets[url] = product;
    }

    const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
    await sleepPromise;
    return currentAssets;
}