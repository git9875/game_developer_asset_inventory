const browserAPI = chrome || browser;
const store = 'Godot Marketplace';
const sleepMilliseconds = 500;
let allowedToParse = false;
const tagFilterList = ['all', 'free', 'fbx', 'jpg', 'adobe', 'illustator', 'general', 'cs', 'graphic', 'and', 'png', 'ai', 'svg', 'coreldraw', 'age', 'cdr', 'eps', 'psd', 'photoshop', 'ui', 'x', 'psds', 'pngs', 'cc', 'item', 'obj', 'blender', 'model', 'art', 'wav', 'massive', 'various', 'game', 'big', 'multi', 'genre', 'audition', 'ogg', 'pro', 'complete', 'minimalist', 'interface', 'top', 'down', 'inkscape', 'super', 'eps', 'volume', 'mtl', 'max', 'tga', 'set', 'zbrush', 'substance', 'unitypackage', 'post', 'painter', 'maya', 'the', 'lsdj', 'sid', 'game'];
let totalDownloads = 0;
let productCount = 0;


browserAPI.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    // console.log(`(${store}) Message from the background script:`, request.command);

    if (request.command === "PARSE_GAME_ASSETS") {
        console.log(`(${store}) Start parsing`);
        allowedToParse = true;
        await orderParsing();

        browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
            percentDone: 100,
            assets: {}
        } });
    }
    else if (request.command === "STOP_PARSING") {
        console.log(`(${store}) Stopping parsing as per request.`);
        allowedToParse = false;
    }
});


// https://godotmarketplace.com/my-account/orders/
async function orderParsing() {
  // get all order URLs from the library page
  const orderRows = document.querySelectorAll('.woocommerce-orders-table tbody tr');
  const totalOrders = orderRows.length;
  let currentOrderNum = 1;

  for (const order of orderRows) {
    if (!allowedToParse) { break; }
    const orderIdElem = order.querySelector('th a');
    const orderId = orderIdElem.textContent.trim().replace('#', '');
    const orderUrl = orderIdElem.href;
    const orderDate = order.querySelector('td.woocommerce-orders-table__cell-order-date').textContent.trim();
    await parseOrderPage(orderUrl, orderId, orderDate, currentOrderNum, totalOrders);
    currentOrderNum += 1;
  }
}


async function parseOrderPage(orderUrl, orderId, orderDate, currentOrderNum, totalOrders) {
  const response = await fetch(orderUrl, {
    method: 'GET',
    headers: {
      'Accept': 'text/html',
    }
  });

  if (response.status !== 200) {
    console.warn(`Failed to fetch order page: ${orderUrl}, status code: ${response.status}`);
    return null;
  }

  const pageText = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(pageText, 'text/html');

  // get all product URLs from the library page
  const productRows = doc.querySelectorAll('.woocommerce-order-downloads table tbody tr');
  totalDownloads += productRows.length;
  const currentAssets = {};

  for (const productRow of productRows) {
    if (!allowedToParse) { break; }
    const productDetailsUrl = productRow.querySelector('td.download-product a').href;
    const { title, publisher, category, tags, imgUrl } = await parseProductPage(productDetailsUrl);
    const product = {'url':productDetailsUrl, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':tags, 'orderId':orderId, 'purchaseDate':orderDate, 'assetStore':store};
    currentAssets[productDetailsUrl] = product;
  }

  const percentDone = Math.min( Math.floor((currentOrderNum / totalOrders) * 100), 99 ); // cap at 99%

  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
    percentDone: percentDone,
    assets: currentAssets
  } });
}


async function parseProductPage(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'text/html',
    }
  });

  if (response.status !== 200) {
    console.warn(`Failed to fetch product page: ${url}, status code: ${response.status}`);
    return null;
  }

  const pageText = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(pageText, 'text/html');

  const title = doc.querySelector('h1.product_title').textContent.trim();
  // const description = doc.querySelector('.woocommerce-Tabs-panel--description').textContent.trim();
  const category = Array.from(doc.querySelectorAll('nav.woocommerce-breadcrumb a')).map(crumb => crumb.textContent.trim()).join(' > ').replace('Home > Shop > ', '');
  const publisher = doc.querySelector('.vendor_store_details_title h5 a').textContent.trim();
  const tagItems = doc.querySelectorAll('.product_meta .posted_in a');
  const tags = [];

  for (const tagItem of tagItems) {
    const tag = tagItem.textContent.trim().toLowerCase();
    if (tag && tag.length > 1 && !tagFilterList.includes(tag)) {
        tags.push(tag);
    }
  }

  const thumbnailSrcElem = doc.querySelector('.woocommerce-product-gallery__wrapper div');
  let imgUrl = thumbnailSrcElem.getAttribute('data-thumb');
  const img300Srcset = thumbnailSrcElem.getAttribute('data-thumb-srcset').split(', ').filter(src => src.endsWith(' 300w'))[0];
  if (img300Srcset) {
    imgUrl = img300Srcset.split(' ')[0];
  }

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return { title, publisher, category, tags, imgUrl };
}
