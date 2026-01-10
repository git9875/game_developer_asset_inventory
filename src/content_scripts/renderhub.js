const browserAPI = chrome || browser;
const store = 'RenderHub';
let allowedToParse = false;
const sleepMilliseconds = 2000;


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

// used for dividing up send message batches
const chunkArray = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, index) =>
    arr.slice(index * size, index * size + size)
  );


async function mainParsing() {
  const orderId = '';
  const itemDivs = document.querySelectorAll('div.itemBox > div');
  const currentAssets = {};

  for (const item of itemDivs) {
    if (! item.id) {
      continue;
    }

    const aElement = item.querySelector('a');
    if (! aElement) {
      console.warn('missing a href for item: ', item);
      return;
    }

    const url = item.querySelector('a').href;
    const imgElement = item.querySelector('img');
    if (! imgElement) {
      console.warn('missing image src for item: ', url, item);
      return;
    }

    const imgUrl = imgElement ? imgElement.src : null;
    const firstChildDiv = item.querySelector('div');
    const titleDiv = firstChildDiv.querySelector('div');

    if (! titleDiv) {
      console.warn('missing title div for item, could be a bundle instead of a singular item', item);

      const subItems = Array.from(item.childNodes).slice(1); // skip first child div
      for (const subItem of subItems) {
        const subItemLink = subItem.querySelector('a');
        if (! subItemLink) {
          console.warn('missing link for subItem, could be a bundle instead of a singular item', subItem);
          continue;
        }

        const subItemUrl = subItemLink.href;
        const subItemImgUrl = subItem.querySelector('img').src;
        const subFirstItem = subItem.querySelector('div')
        const subItemTitle = subFirstItem.querySelector('div').textContent;
        const publisher = subFirstItem.querySelector('span a').textContent;
        const purchaseDate = '';
        const product = {'url':subItemUrl, 'imgUrl':subItemImgUrl, 'title':subItemTitle, 'publisher':publisher, 'category':null, 'tags':null, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
        currentAssets[subItemUrl] = product;
      }

      continue;
    }

    const title = firstChildDiv.querySelector('div').textContent;
    const publisher = firstChildDiv.querySelector('span a').textContent;
    const purchaseDate = '';
    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':null, 'tags':null, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[url] = product;
  }

  await chunkFillTaxonomyAndSend(currentAssets);

  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
      percentDone: 100,
      assets: currentAssets
  } });
}


// process in chunks to send message content updates intermittently
async function chunkFillTaxonomyAndSend(currentAssets) {
  const allUrls = Object.keys(currentAssets);
  const urlChunks = chunkArray(allUrls, 10); // process 10 at a time

  for (let i = 0; i < urlChunks.length; i++) {
    if (! allowedToParse) {
      // console.log(`(${store}) Parsing stopped as per request.`);
      return;
    }

    const chunk = urlChunks[i];
    // console.log(`(${store}) Processing chunk ${i+1} of ${urlChunks.length} with ${chunk.length} items.`);
    const chunkAssets = {};

    for (let i = 0; i < chunk.length; i++) {
      const url = chunk[i];
      const result = await parseProductPageTaxonomy(url);
      const [category, tags] = result;
      currentAssets[url].category = category;
      currentAssets[url].tags = tags;
      chunkAssets[url] = currentAssets[url];
    }

    const percentDone = Math.round(((i + 1) / urlChunks.length) * 100);
    browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
        percentDone: percentDone,
        assets: chunkAssets
    } });
  }
}


async function parseProductPageTaxonomy(url) {
  const response = await fetch(url);
  const pageText = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(pageText, 'text/html');

  const categoryElements = doc.getElementsByClassName('tagLink');
  const categories = Array.from(categoryElements)
    .filter(el => el.parentElement.attributes.length==0)
    .map(el => el.textContent.trim());

  const tags = Array.from(categoryElements)
    .filter(el => el.parentElement.attributes.length>0) // this div includes style attribute
    .map(el => el.textContent.trim());

  const category = categories.join(' / ');

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return [category, tags];
}