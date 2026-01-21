const browserAPI = chrome || browser;
const store = 'GameDev Market';
const sleepMilliseconds = 500;
let allowedToParse = false;
const tagFilterList = ['fbx', 'jpg', 'adobe', 'illustator', 'general', 'cs', 'graphic', 'and', 'png', 'ai', 'svg', 'coreldraw', 'age', 'cdr', 'eps', 'psd', 'photoshop', 'ui', 'x', 'psds', 'pngs', 'cc', 'item', 'obj', 'blender', 'model', 'art', 'wav', 'massive', 'various', 'game', 'big', 'multi', 'genre', 'audition', 'ogg', 'pro', 'complete', 'minimalist', 'interface', 'top', 'down', 'inkscape', 'super', 'eps', 'volume', 'mtl', 'max', 'tga', 'set', 'zbrush', 'substance', 'unitypackage', 'post', 'painter', 'maya', 'the', 'lsdj', 'sid', 'game'];
let totalDownloads = 0;
let productCount = 0;


browserAPI.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    // console.log(`(${store}) Message from the background script:`, request.command);

    if (request.command === "PARSE_GAME_ASSETS") {
        console.log(`(${store}) Start parsing`);
        allowedToParse = true;
        await orderParsing();
        await externalPurchasesParsing();

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


// https://www.gamedevmarket.net/user/orders
async function orderParsing() {
  // get all order URLs from the library page
  const orderRows = document.querySelectorAll('div.w-full.border-1.border-gray-300.px-4.py-2.my-2:not(.flex)');
  totalDownloads += document.querySelectorAll('form[action="/user/products/download"]').length;

  for (const order of orderRows) {
    if (!allowedToParse) { break; }
    const orderIdElem = order.querySelector('h1');
    const orderIdText = orderIdElem.textContent.trim();
    const orderId = orderIdText.split('#')[1].trim();
    const productRows = order.querySelectorAll('div.w-full.border-1.border-gray-300.px-4.py-2.my-2');
    const currentAssets = {};

    for (const item of productRows) {
      if (!allowedToParse) { break; }
      const imgUrl = item.querySelector('img').src;
      const titleLink = item.querySelector('div.w-full:nth-of-type(2) a');
      const title = titleLink.textContent.trim();
      const url = titleLink.href;
      const { publisher, category, tags } = await parseProductPage(url);
      const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':tags, 'orderId':orderId, 'purchaseDate':null, 'assetStore':store};
      currentAssets[url] = product;
      productCount += 1;
      const percentDone = Math.min( Math.floor((productCount / totalDownloads) * 100), 99 ); // cap at 99%

      browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
        percentDone: percentDone,
        assets: currentAssets
      } });
    }
  }
}


async function externalPurchasesParsing() {
  const externalPurchasesUrl = 'https://www.gamedevmarket.net/user/external/purchases';
  const response = await fetch(externalPurchasesUrl, {
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

  // get all order URLs from the library page
  const orderRows = doc.querySelectorAll('div.bg-gradient-to-r + div.container > div.w-full');
  totalDownloads += doc.querySelectorAll('form[action="/user/products/download"]').length;
  const orderId = null;

  for (const order of orderRows) {
    if (!allowedToParse) { break; }
    const productRows = order.querySelectorAll('div.flex.border-1');
    const currentAssets = {};

    for (const item of productRows) {
      if (!allowedToParse) { break; }
      const imgUrl = item.querySelector('img').src;
      const titleLink = item.querySelector('div.w-full:nth-of-type(2) a');
      const title = titleLink.textContent.trim();
      const url = titleLink.href;
      const { publisher, category, tags } = await parseProductPage(url);
      const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':tags, 'orderId':orderId, 'purchaseDate':null, 'assetStore':store};
      currentAssets[url] = product;
      productCount += 1;
      const percentDone = Math.min( Math.floor((productCount / totalDownloads) * 100), 99 ); // cap at 99%

      browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
        percentDone: percentDone,
        assets: currentAssets
      } });
    }
  }
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

  const category = doc.querySelector('header.main-nav + script + div').textContent.trim();
  const publisher = doc.querySelector('form[action="/user/follow"] input[name="username"]').value;
  const tagItems = doc.querySelectorAll('div.product-tags li');
  const tags = [];

  for (const tagItem of tagItems) {
    const tag = tagItem.textContent.trim().toLowerCase();
    if (tag && tag.length > 1 && !tagFilterList.includes(tag)) {
        tags.push(tag);
    }
  }

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return { publisher, category, tags };
}
