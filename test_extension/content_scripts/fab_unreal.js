const browserAPI = chrome || browser;
const currentUrl = window.location.href.toLowerCase();
const store = "Fab Unreal";
const sleepMilliseconds = 700;
let allowedToParse = false;
let itemCount = 0;
let itemTotal = 100; // set by getAggregateCount() or getQuixelAggregateCount()
let lastFabCursor = null;
let lastQuixelCursor = null;

const groupTimestamp = createLocalDateISO();
const iterationLimitPerTest = 3;
let totalTestsRun = 0;
let totalTestsPassed = 0;



browserAPI.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    // console.log(`(${store}) Message from the background script:`, request.command, lastFabCursor);

    if (request.command === "PARSE_GAME_ASSETS") {
        console.log(`(${store}) Start parsing`);
        allowedToParse = true;

        await setUnrealTotalCount(); // not worried about race condition when reporting percentDone since it will be set after the next round
        await mainFabUnrealParsing();

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



async function mainFabUnrealParsing() {
    let nextCursor = lastFabCursor || await parseFabAssetsFromHtml();
    let i = 1;

    while (nextCursor) {
      if (!allowedToParse) { break; }
      const nextCursor2 = await parseFabAssetsFromFetchJson(nextCursor);
      lastFabCursor = nextCursor2;
      nextCursor = (nextCursor2 != nextCursor) ? nextCursor2 : null; // if it repeats, then we are done

      if (i > iterationLimitPerTest) {
        // avoid too many tests being sent
        break;
      }
      i += 1;
    }
}



async function parseFabAssetsFromHtml() {
  if (!document.getElementById('js-json-data-prefetched-data')) {
    sendTestResultMessage("parseFabAssetsFromHtml(): find JSON data in script tag", false, `Missing JSON data in script tag.`);
    return 0;
  }
  else {
    sendTestResultMessage("parseFabAssetsFromHtml(): find JSON data in script tag", true, `Found JSON data in script tag.`);
  }

  const jsonStr = document.getElementById('js-json-data-prefetched-data').innerHTML;
  const data = JSON.parse(jsonStr);

  if (!("/i/library/entitlements/search?sort_by=-createdAt" in data)) {
    sendTestResultMessage("parseFabAssetsFromHtml(): validate JSON data structure", false, `Missing expected key in JSON data.`);
    return 0;
  }
  else {
    sendTestResultMessage("parseFabAssetsFromHtml(): validate JSON data structure", true, `Found expected key in JSON data.`);
  }

  const mainListings = data["/i/library/entitlements/search?sort_by=-createdAt"]; // from HTML only
  const nextCursor = parseFabRelevantDataFromFabJson(mainListings);
  return nextCursor;
}


async function parseFabAssetsFromFetchJson(thisCursor) {
  const apiUrl = 'https://www.fab.com/i/library/entitlements/search?sort_by=-createdAt&cursor=' + thisCursor;
  const response = await fetch(apiUrl);

  if (!response.ok) {
    console.error(`Fab HTTP error! status: ${response.status}`);
    sendTestResultMessage("parseFabAssetsFromFetchJson(): fetch JSON data", false, `Failed to fetch JSON data from ${apiUrl}. HTTP status: ${response.status}`);
    return null;
  }
  else {
    sendTestResultMessage("parseFabAssetsFromFetchJson(): fetch JSON data", true, `Successfully fetched JSON data from ${apiUrl}`);
  }

  const mainListings = await response.json();
  const nextCursor = parseFabRelevantDataFromFabJson(mainListings);
  return nextCursor;
}


async function parseFabRelevantDataFromFabJson(mainListings) {
  if (!('cursors' in mainListings) || !('next' in mainListings['cursors']) || !('results' in mainListings)) {
    sendTestResultMessage("parseFabRelevantDataFromFabJson(): validate mainListings structure", false, `Missing cursors or results in mainListings.`);
    return null;
  }
  else {
    sendTestResultMessage("parseFabRelevantDataFromFabJson(): validate mainListings structure", true, `found cursors and results in mainListings.`);
  }

  const nextCursor = mainListings['cursors']['next'];
  const results = mainListings['results'];
  const currentAssets = {};
  let i = 1;

  for (const item of results) {
    if (!('listing' in item) || !('medias' in item['listing'])) {
      sendTestResultMessage("parseFabRelevantDataFromFabJson(): validate item media", false, `Missing media in item.`);
      continue;
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("parseFabRelevantDataFromFabJson(): validate item media", true, `Found media in item.`);
    }

    // get thumbnail image
    const mediaThumbnailPackage = item['listing']['medias'].filter(m => m.type == 'image');
    let imgUrl = null;

    if (mediaThumbnailPackage && mediaThumbnailPackage.length > 0) {
      if (!('images' in mediaThumbnailPackage[0])) {
        sendTestResultMessage("parseFabRelevantDataFromFabJson(): validate mediaThumbnailPackage images", false, `Missing images in mediaThumbnailPackage.`);
        continue;
      }
      else if (i < iterationLimitPerTest) {
        sendTestResultMessage("parseFabRelevantDataFromFabJson(): validate mediaThumbnailPackage images", true, `Found images in mediaThumbnailPackage.`);
      }

      const mediaThumbnails = mediaThumbnailPackage[0]['images'].filter(m => m.width == 320);
      if (mediaThumbnails && mediaThumbnails.length > 0) {
        imgUrl = mediaThumbnails[0].url;
      }
    }

    if (!imgUrl) {
      if (!('listing' in item) || !('thumbnails' in item['listing'])) {
        sendTestResultMessage("parseFabRelevantDataFromFabJson(): validate item thumbnails", false, `Missing thumbnails in item.`);
      }
      else if (i < iterationLimitPerTest) {
        sendTestResultMessage("parseFabRelevantDataFromFabJson(): validate item thumbnails", true, `Found thumbnails in item.`);
      }
    }

    if (!imgUrl && item['listing']['thumbnails'] && item['listing']['thumbnails'].length > 0) {
      imgUrl = item['listing']['thumbnails'][0]['mediaUrl']; // use the default image if there isn't a better image
    }

    if (!imgUrl) {
      sendTestResultMessage("parseFabRelevantDataFromFabJson(): find imgUrl", false, `Missing imgUrl in mediaThumbnails.`);
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("parseFabRelevantDataFromFabJson(): find imgUrl", true, `Found imgUrl in mediaThumbnails.`);
    }

    if (!('listing' in item) || !(('tags' in item['listing']) && ('title' in item['listing']) && ('uid' in item['listing']) && ('user' in item['listing']) && ('sellerName' in item['listing']['user']) && ('createdAt' in item))) {
      console.warn(`(${store}) Incomplete item data:`, item);
      sendTestResultMessage("parseFabRelevantDataFromFabJson(): validate item structure", false, `Missing data in item.`);
      continue;
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("parseFabRelevantDataFromFabJson(): validate item structure", true, `Valid item structure.`);
    }

    const tags = item['listing']['tags'].map((t) => t.slug);
    const title = item['listing']['title'];
    const url = 'https://www.fab.com/listings/' + item['listing']['uid'];
    const publisher = item['listing']['user']['sellerName'];
    const purchaseDate = item['createdAt'].substring(0,10); // only get the date from the timestamp
    const orderId = '';
    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':null, 'tags':tags, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[url] = product;

    i += 1;
  }

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;

  return nextCursor;
}

async function setUnrealTotalCount() {
  const apiUrl = 'https://www.fab.com/i/library/entitlements/search?aggregate_on=category_per_listing_type&count=0&sort_by=-createdAt';
  const response = await fetch(apiUrl);

  if (!response.ok) {
    sendTestResultMessage("setUnrealTotalCount(): fetch aggregate count", false, `Failed to fetch aggregate count from ${apiUrl}. HTTP status: ${response.status}`);
    console.error(`Fab HTTP error! status: ${response.status}`);
    return null;
  }
  else {
    sendTestResultMessage("setUnrealTotalCount(): fetch aggregate count", true, `Successfully fetched aggregate count from ${apiUrl}`);
  }

  const data = await response.json();

  if (!data['aggregations'] || !data['aggregations']['categoryPerListingType'] || !data['aggregations']['categoryPerListingType']['buckets']) {
    sendTestResultMessage("setUnrealTotalCount(): validate aggregation data", false, `Invalid aggregation data structure.`);
    return null;
  }
  else {
    sendTestResultMessage("setUnrealTotalCount(): validate aggregation data", true, `Aggregation data structure is valid.`);
  }

  const buckets = data['aggregations']['categoryPerListingType']['buckets'];
  let totalCount = 0, singleTestDocCount = true;

  for (const bucketKey in buckets) {
    if (!('docCount' in buckets[bucketKey])) {
      sendTestResultMessage("setUnrealTotalCount(): validate docCount in bucket", false, `Missing docCount in bucket ${bucketKey}.`);
      continue;
    }
    else if (singleTestDocCount) {
      sendTestResultMessage("setUnrealTotalCount(): validate docCount in bucket", true, `Found docCount in bucket ${bucketKey}.`);
      singleTestDocCount = false;
    }

    totalCount += buckets[bucketKey]['docCount'];
  }

  if (!('aggregations' in data) || !('categoryPerListingType' in data['aggregations']) || !('othersCount' in data['aggregations']['categoryPerListingType'])) {
    sendTestResultMessage("setUnrealTotalCount(): validate othersCount in aggregations", false, `Missing othersCount in aggregations.`);
    return null;
  }
  else {
    sendTestResultMessage("setUnrealTotalCount(): validate othersCount in aggregations", true, `Found othersCount in aggregations.`);
  }

  totalCount += data['aggregations']['categoryPerListingType']['othersCount'];
  itemTotal = totalCount;
}
