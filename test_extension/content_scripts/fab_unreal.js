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

  if (!("/i/library/search?sort_by=-createdAt&source=acquired" in data)) {
    sendTestResultMessage("parseFabAssetsFromHtml(): validate JSON data structure", false, `Missing expected key in JSON data.`);
    return 0;
  }
  else {
    sendTestResultMessage("parseFabAssetsFromHtml(): validate JSON data structure", true, `Found expected key in JSON data.`);
  }

  const mainListings = data["/i/library/search?sort_by=-createdAt&source=acquired"]; // from HTML only
  const nextCursor = parseFabRelevantDataFromFabJson(mainListings);
  return nextCursor;
}


async function parseFabAssetsFromFetchJson(thisCursor) {
  const apiUrl = 'https://www.fab.com/i/library/search?sort_by=-createdAt&source=acquired&cursor=' + thisCursor;
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
    if (!('listing' in item) || !('thumbnails' in item['listing'])) {
      sendTestResultMessage("parseFabRelevantDataFromFabJson(): validate item thumbnails", false, `Missing thumbnails in item.`);
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("parseFabRelevantDataFromFabJson(): validate item thumbnails", true, `Found thumbnails in item.`);
    }

    // get thumbnail image
    let imgUrl = null;

    const thumbnailMedia = item['listing']['thumbnails'][0];
    if (thumbnailMedia['type'] == 'thumbnail' && thumbnailMedia['images']) {
      const thumbnailImages = thumbnailMedia['images'].filter(m => m.width == 320);
      if (thumbnailImages && thumbnailImages.length > 0) {
        imgUrl = thumbnailImages[0].url;
      }
    }
    if (!imgUrl) {
      // imgUrl = thumbnailMedia['mediaUrl']; // use the default image if there isn't a better image
      sendTestResultMessage("parseFabRelevantDataFromFabJson(): validate thumbnail image width=320", false, `Missing thumbnail image with width=320 in item.`);
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("parseFabRelevantDataFromFabJson(): validate thumbnail image width=320", true, `Found thumbnail image with width=320 in item.`);
    }

    if (!('listing' in item) || !('title' in item['listing']) || !('uid' in item['listing']) || !('publisher' in item['listing']) || !('sellerName' in item['listing']['publisher']) || !('createdAt' in item)) {
      console.warn(`(${store}) Incomplete item data:`, item);
      sendTestResultMessage("parseFabRelevantDataFromFabJson(): validate item structure", false, `Missing data in item.`);
      continue;
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("parseFabRelevantDataFromFabJson(): validate item structure", true, `Valid item structure.`);
    }

    const title = item['listing']['title'];
    const url = 'https://www.fab.com/listings/' + item['listing']['uid'];
    const publisher = item['listing']['publisher']['sellerName'];
    const purchaseDate = item['createdAt'].substring(0,10); // only get the date from the timestamp
    const orderId = '';

    let tags = null;
    let category = null;

    if (i < iterationLimitPerTest) {
      const tagsAndCategory = await getTagsAndCategory(item['listing']['uid']);
      tags = tagsAndCategory.tags;
      category = tagsAndCategory.category;
    }

    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':tags, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
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


async function getTagsAndCategory(listingId) {
  const apiUrl = 'https://www.fab.com/i/listings/' + listingId;
  const response = await fetch(apiUrl);

  if (!response.ok) {
    sendTestResultMessage("getTagsAndCategory(): fetch listing tags and category", false, `Failed to fetch tags and category data from ${apiUrl}. HTTP status: ${response.status}`);
    console.error(`Fab HTTP error! status: ${response.status}`);
    return null;
  }

  const data = await response.json();
  if (!data['tags']) {
    sendTestResultMessage("getTagsAndCategory(): validate listing tags", false, `Missing tags in listing data from ${apiUrl}.`);
    return null;
  }
  else {
    sendTestResultMessage("getTagsAndCategory(): validate listing tags", true, `Found tags in listing data from ${apiUrl}.`);
  }

  if (!data['category']) {
    sendTestResultMessage("getTagsAndCategory(): validate listing category", false, `Missing category in listing data from ${apiUrl}.`);
    return null;
  }
  else {
    sendTestResultMessage("getTagsAndCategory(): validate listing category", true, `Found category in listing data from ${apiUrl}.`);
  }

  const tags = data['tags'].map((t) => t.slug);
  const category = data['category'] ? data['category'].slug : null;
  sendTestResultMessage("getTagsAndCategory(): fetch listing tags and category", true, `Successfully fetched tags and category data from ${apiUrl}`);
  return { tags, category };
}
