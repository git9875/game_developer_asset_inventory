const browserAPI = chrome || browser;
const store = 'TurboSquid';
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

// https://www.turbosquid.com/Order/Index.cfm
async function mainParsing() {
  const orderDivs = document.querySelectorAll('div.ItemContainerBox');
  let orderId = null;
  let purchaseDate = null;
  const currentAssets = {};

  for (const order of orderDivs) {
    if (!allowedToParse) { break; }
    const orderNumberTdContainer = order.querySelector('.orderNumberTdContainer');
    if (orderNumberTdContainer && orderNumberTdContainer.querySelector('.orderNo')) {
      orderId = orderNumberTdContainer.querySelector('.orderNo').textContent.substring(7);
      purchaseDate = orderNumberTdContainer.querySelector('.orderItemLabel + span').textContent;
      continue;
    }

    const itemDownloads = order.querySelectorAll('.ItemDownloads');
    if (!itemDownloads) {
      continue;
    }

    for (const downloadItem of itemDownloads) {
      const thumbnailLargeDiv = downloadItem.querySelector('.thumbnailLarge');
      const url = thumbnailLargeDiv.querySelector('a').href;
      const imgUrl = thumbnailLargeDiv.querySelector('img').src;
      const title = downloadItem.querySelector('.name').textContent;
      const publisher = '';
      const productPageData = await parseProductPage(url);
      const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':productPageData.categoryCombined, 'tags':productPageData.tags, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
      currentAssets[url] = product;
    }
  }

  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
      percentDone: 100,
      assets: currentAssets
  } });

  // TODO: I don't have enough purchases to enable the pagination links, so there is no HTML code for me to inspect.
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

  // Example: extract categories and tags if available
  const categories = [];
  const tags = [];

  // using breadcrumbs for categories instead of Categories because breadcrumb seems more reliable and hierarchical
  const categoryElements = doc.querySelectorAll('#breadcrumb li a');
  categoryElements.forEach(elem => {
    const category = elem.textContent.trim().toLocaleLowerCase();
    categories.push(category);
  });

  const tagElements = doc.querySelectorAll('div[data-testid="tag-container"] a');
  // the Categories list of tags is like tags and may be a good replacement, but it didn't have a useful DOM query selector for it
  const filterOutTags = ['figure', 'blender', '3ds', 'low', 'high', 'poly', 'skin', 'and', 'chest', 'base', 'shape', 'blendshape', 'mesh', 'blends', 'real', 'time', 'vray', 'unity', 'unreal', '3d', 'c4d', 'model', 'maya', 'max', 'pbr', 'archviz', 'collection', 'render', 'zbrush', 'specification'];
  tagElements.forEach(elem => {
    const tag = elem.textContent.trim().toLocaleLowerCase();
    if (tag && !filterOutTags.includes(tag)) {
      tags.push(tag);
    }
  });

  const categoryCombined = categories.join(' / ');

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return { categoryCombined, tags };
}
