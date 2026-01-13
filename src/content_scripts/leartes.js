const browserAPI = chrome || browser;
// Leartes Studios Game Asset Library    https://cosmos.leartesstudios.com/inventory
const store = 'Leartes Studios';
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
  const authToken = localStorage.getItem('token');

  let page = 1;
  while (page) {
    if (!allowedToParse) { break; }
    page = await inventoryApi(page, authToken);
  }
}

async function inventoryApi(page, authToken) {
  const apiUrl = 'https://api.cosmos.leartesstudios.com/inventory?page=' + page;
  const response = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'Authorization': `Bearer ${authToken}`
    }
  });
  
  if (!response.ok) {
    console.error(`(${store}) HTTP error! status: ${response.status}`);
    return null;
  }
  
  const jsonData = await response.json();
  // console.log('game_asset_extractor jsonData', jsonData);
  const currentAssets = {};
  const items = jsonData['data'];

  for (const item of items) {
    const environmentTypeUrlPart = (item['type'] === 'vfx') ? 'vfx' : item['type']+'s';
    const url = 'https://cosmos.leartesstudios.com/' + environmentTypeUrlPart + '/' + item['slug'];
    const imgUrl = item['cover_image']['url'];
    const title = item['title'];
    const tags = ('tags' in item) ? item['tags'] : null;
    const category = item['type'];
    const publisher = store;
    const orderId = '';
    const purchaseDate = '';
    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'tags':tags, 'category':category, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store };
    currentAssets[url] = product;
  }
  
  // const totalItems = jsonData['meta']['total'];
  const totalPages = jsonData['meta']['last_page'];
  const currentPage = jsonData['meta']['current_page'];

  const percentDone = Math.round( (currentPage / totalPages) * 100 );

  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
      percentDone: percentDone,
      assets: currentAssets
  } });

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  
  if (page == totalPages) {
    return null;
  }
  return page + 1;
}
// meta provides: current_page, first_page, last_page, per_page, total
