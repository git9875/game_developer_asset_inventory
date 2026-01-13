const browserAPI = chrome || browser;
// Leartes Studios Game Asset Library    https://cosmos.leartesstudios.com/inventory
const store = 'Leartes Studios';
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



async function mainParsing() {
  const authToken = localStorage.getItem('token');

  let page = 1;
  while (page) {
    if (!allowedToParse) { break; }
    page = await inventoryApi(page, authToken);

    if (page && page > iterationLimitPerTest) {
      break;
    }
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
    sendTestResultMessage("inventoryApi(): fetch inventory page", false, `Failed to fetch inventory from ${apiUrl}. HTTP status: ${response.status}`);
    return null;
  }
  else {
    sendTestResultMessage("inventoryApi(): fetch inventory page", true, `Successfully fetched inventory from ${apiUrl}. HTTP status: ${response.status}`);
  }
  
  const jsonData = await response.json();

  if (!('data' in jsonData) || !(Array.isArray(jsonData['data'])) || (jsonData['data'].length === 0)) {
    sendTestResultMessage("inventoryApi(): validate inventory data", false, `Invalid inventory data structure from ${apiUrl}.`);
    return null;
  }
  else {
    sendTestResultMessage("inventoryApi(): validate inventory data", true, `Valid inventory data structure from ${apiUrl}.`);
  }

  // console.log('game_asset_extractor jsonData', jsonData);
  const currentAssets = {};
  const items = jsonData['data'];
  let i = 1;

  for (const item of items) {
    if (!('type' in item) || !('slug' in item) || !('cover_image' in item) || !('url' in item['cover_image']) || !('title' in item)) {
      console.warn(`(${store}) Invalid inventory item structure:`, item);
      sendTestResultMessage("inventoryApi(): validate inventory item", false, `Invalid inventory item structure in row ${i}`);
      continue;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("inventoryApi(): validate inventory item", true, `Valid inventory item structure for item slug ${item['slug']}, row ${i}.`);
    }

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

    i += 1;
  }
  
  if (!('meta' in jsonData) || !('last_page' in jsonData['meta']) || !('current_page' in jsonData['meta']) || !('total' in jsonData['meta'])) {
    sendTestResultMessage("inventoryApi(): validate pagination meta", false, `Invalid pagination meta data from ${apiUrl}.`);
    return null;
  }
  else {
    sendTestResultMessage("inventoryApi(): validate pagination meta", true, `Valid pagination meta data from ${apiUrl}.`);
  }

  // const totalItems = jsonData['meta']['total'];
  const totalPages = jsonData['meta']['last_page'];
  const currentPage = jsonData['meta']['current_page'];

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  
  if (page == totalPages) {
    return null;
  }
  return page + 1;
}
// meta provides: current_page, first_page, last_page, per_page, total
