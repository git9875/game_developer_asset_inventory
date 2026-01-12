const browserAPI = chrome || browser;
const currentUrl = window.location.href.toLowerCase();
const store = "Fab Quixel Megascans";
const sleepMilliseconds = 700;
let allowedToParse = false;
let itemCount = 0;
let itemTotal = 100; // set by getAggregateCount() or getQuixelAggregateCount()
let categoryDocTotal = 0;
let lastCategorySlug = null;

const groupTimestamp = createLocalDateISO();
const iterationLimitPerTest = 3;
let totalTestsRun = 0;
let totalTestsPassed = 0;



browserAPI.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    // console.log(`(${store}) Message from the background script:`, request.command, lastFabCursor);

    if (request.command === "PARSE_GAME_ASSETS") {
        console.log(`(${store}) Start parsing`);
        allowedToParse = true;

        await setQuixelTotalCount(); // not worried about race condition when reporting percentDone since it will be set after the next round
        await mainFabQuixelParsing();

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



async function mainFabQuixelParsing() {
    const mergedCategoryData = await mergeCategoryData();
    // console.log(`(${store}) Merged category data`, mergedCategoryData);

    // iterate over categories; resume from lastCategorySlug if set because of stop command or Fab rate limiting
    const categorySlugs = Object.keys(mergedCategoryData);
    let categorySlugCount = categorySlugs.length;
    let i = (lastCategorySlug) ? categorySlugs.indexOf(lastCategorySlug) : 0;
    let j = 1;

    for (; i < categorySlugCount && i < iterationLimitPerTest; i++) {
      if (!allowedToParse) { break; }
      const categorySlug = categorySlugs[i];

      if (!(categorySlug in mergedCategoryData)) {
        sendTestResultMessage("mainFabQuixelParsing(): get categoryInfo from mergedCategoryData", false, `Missing categorySlug in mergedCategoryData ${categorySlug}`);
      }
      else {
        sendTestResultMessage("mainFabQuixelParsing(): get categoryInfo from mergedCategoryData", true, `Found categorySlug in mergedCategoryData ${categorySlug}`);
      }

      const categoryInfo = mergedCategoryData[categorySlug];
      // console.log(`(${store}) Starting category parsing`, categorySlug, categoryInfo);

      let nextCursor = await parseQuixelAssetsFromFetchJson(categoryInfo['listingType'], categorySlug, null);

      while (nextCursor) {
        if (!allowedToParse) { break; }
        const nextCursor2 = await parseQuixelAssetsFromFetchJson(categoryInfo['listingType'], categorySlug, nextCursor);
        nextCursor = (nextCursor2 != nextCursor) ? nextCursor2 : null; // if it repeats, then we are done

        if (j >= iterationLimitPerTest) {
          break; // limit number of pages parsed for testing
        }
        j += 1;
      }
      
      lastCategorySlug = categorySlug;
    }
}


function getCategoryUids() {
  if (!document.getElementById('js-json-data-prefetched-data')) {
    sendTestResultMessage("getCategoryUids(): find JSON data in script tag", false, `Missing JSON data in script tag.`);
    return {};
  }
  else {
    sendTestResultMessage("getCategoryUids(): find JSON data in script tag", true, `Found JSON data in script tag.`);
  }

  const jsonStr = document.getElementById('js-json-data-prefetched-data').innerHTML;
  const data = JSON.parse(jsonStr);

  if (!('/i/taxonomy/categories/tree' in data) || !data['/i/taxonomy/categories/tree']['results']) {
    sendTestResultMessage("getCategoryUids(): find categories in category tree", false, `Missing categories in category tree.`);
    return {};
  }
  else {
    sendTestResultMessage("getCategoryUids(): find categories in category tree", true, `Found categories in category tree.`);
  }

  const categoryTree = data['/i/taxonomy/categories/tree']['results'];
  const categoryUids = {};

  for (const mainKey in categoryTree) {
    traverseCategoryUids(categoryTree[mainKey], categoryUids);
  }

  return categoryUids;
}


function traverseCategoryUids(categoryBranch, categoryUids) {
  for (const category of categoryBranch) {
    if (!('uid' in category) || !('slug' in category)) {
      sendTestResultMessage("traverseCategoryUids(): find uid or slug", false, `Missing uid or slug in category`);
      return;
    }
    if (!('children' in category)) {
      sendTestResultMessage("traverseCategoryUids(): find children", false, `Missing children in category`);
      return;
    }
    // not showing positive test result for every category to avoid flooding the test results

    categoryUids[category['uid']] = category['slug'];
    if (category['children'] && category['children'].length > 0) {
      traverseCategoryUids(category['children'], categoryUids);
    }
  }
}



async function getCategoryAggregations() {
  const apiUrl = 'https://www.fab.com/i/listings/search?aggregate_on=category_per_listing_type&count=0&seller=Quixel+Megascans';
  const response = await fetch(apiUrl);

  if (!response.ok) {
    console.error(`(${store}) HTTP error! status: ${response.status}`);
    sendTestResultMessage("getCategoryAggregations(): fetch category aggregations", false, `Failed to fetch category aggregations from ${apiUrl}. HTTP status: ${response.status}`);
    return null;
  }
  else {
    sendTestResultMessage("getCategoryAggregations(): fetch category aggregations", true, `Successfully fetched category aggregations from ${apiUrl}`);
  }

  const data = await response.json();
  if (!data['aggregations'] || !data['aggregations']['categoryPerListingType'] || !data['aggregations']['categoryPerListingType']['buckets']) {
    sendTestResultMessage("getCategoryAggregations(): validate aggregation data", false, `Invalid aggregation data structure.`);
    return null;
  }
  else {
    sendTestResultMessage("getCategoryAggregations(): validate aggregation data", true, `Aggregation data structure is valid.`);
  }

  const buckets = data['aggregations']['categoryPerListingType']['buckets'];
  const categoryAggregations = {};
  let singleTestUid = true;

  for (const bucketKey in buckets) {
    if (!('category' in buckets[bucketKey]) || !buckets[bucketKey]['category']['buckets']) {
      sendTestResultMessage("getCategoryAggregations(): validate category bucket data for uids", false, `Invalid category bucket data structure for listingType ${bucketKey}.`);
      continue;
    }
    else if (singleTestUid) {
      sendTestResultMessage("getCategoryAggregations(): validate category bucket data for uids", true, `Category bucket data structure is valid for listingType ${bucketKey}.`);
    }

    const uids = buckets[bucketKey]['category']['buckets'];

    for (const uidKey in uids) {
      if (!('docCount' in uids[uidKey])) {
        sendTestResultMessage("getCategoryAggregations(): validate docCount for uid", false, `Missing docCount for uid ${uidKey} in listingType ${bucketKey}.`);
        continue;
      }
      else if (singleTestUid) {
        sendTestResultMessage("getCategoryAggregations(): validate docCount for uid", true, `Found docCount for uid ${uidKey} in listingType ${bucketKey}.`);
        singleTestUid = false;
      }

      const docCount = uids[uidKey]['docCount'];
      categoryAggregations[uidKey] = { "listingType":bucketKey, "docCount":docCount };
      categoryDocTotal += docCount;
    }
  }

  // console.log(`(${store}) Category doc total compared to itemTotal:`, categoryDocTotal, itemTotal);
  return categoryAggregations;
}



async function mergeCategoryData() {
  const categoryUids = getCategoryUids();
  const categoryAggregations = await getCategoryAggregations();
  const mergedCategoryData = {};
  let singleTestMerge = true;

  // less keys to iterate over with categoryAggregations than categoryUids
  for (const uidKey in categoryAggregations) {
    const uidInfo = categoryAggregations[uidKey];

    if (uidKey in categoryUids) {
      if (singleTestMerge) {
        if (!('listingType' in uidInfo) || !('docCount' in uidInfo)) {
          sendTestResultMessage("mergeCategoryData(): validate uidInfo structure", false, `Missing listingType or docCount for UID ${uidKey} with slug ${categoryUids[uidKey]}.`);
          continue;
        }
        else {
          sendTestResultMessage("mergeCategoryData(): validate uidInfo structure", true, `Found listingType and docCount for UID ${uidKey} with slug ${categoryUids[uidKey]}.`);
          singleTestMerge = false;
        }
      }

      mergedCategoryData[categoryUids[uidKey]] = { // use slug as key
        "uid": uidKey,
        "listingType": uidInfo['listingType'],
        "docCount": uidInfo['docCount']
      };
    }
    else {
      sendTestResultMessage("mergeCategoryData(): find category slug for uid", false, `Missing uidKey ${uidKey} in categoryUids.`);
    }
  }

  return mergedCategoryData;
}


async function parseQuixelAssetsFromHtml() {
  if (!document.getElementById('js-json-data-prefetched-data')) {
    sendTestResultMessage("parseQuixelAssetsFromHtml(): find JSON data in script tag", false, `Missing JSON data in script tag.`);
    return 0;
  }
  else {
    sendTestResultMessage("parseQuixelAssetsFromHtml(): find JSON data in script tag", true, `Found JSON data in script tag.`);
  }

  const jsonStr = document.getElementById('js-json-data-prefetched-data').innerHTML;
  const data = JSON.parse(jsonStr);

  if (!("/i/listings/search?seller=Quixel%20Megascans&sort_by=listingTypeWeight" in data)) {
    sendTestResultMessage("parseQuixelAssetsFromHtml(): find Quixel listings in JSON data", false, `Missing Quixel listings in JSON data.`);
    return 0;
  }
  else {
    sendTestResultMessage("parseQuixelAssetsFromHtml(): find Quixel listings in JSON data", true, `Found Quixel listings in JSON data.`);
  }

  const mainListings = data["/i/listings/search?seller=Quixel%20Megascans&sort_by=listingTypeWeight"]; // from HTML only
  const nextCursor = parseQuixelRelevantDataFromFabJson(mainListings);
  return nextCursor;
}


async function parseQuixelAssetsFromFetchJson(listingType, categorySlug, thisCursor) {
  // https://www.fab.com/i/listings/search?categories=building-human-made--debris&listing_types=material&seller=Quixel+Megascans&sort_by=listingTypeWeight&cursor=bz0yNA%3D%3D
  const apiUrl = `https://www.fab.com/i/listings/search?categories=${categorySlug}&listing_types=${listingType}&seller=Quixel+Megascans&sort_by=listingTypeWeight` + (thisCursor ? '&cursor=' + thisCursor : '');
  // console.log("Quixel fetch URL:", apiUrl);
  const response = await fetch(apiUrl);

  if (!response.ok) {
    console.error(`Fab HTTP error! status: ${response.status}`);
    sendTestResultMessage("parseQuixelAssetsFromFetchJson(): fetch Quixel listings", false, `HTTP error! status: ${response.status}`);

    if (response.status == 429) {
      console.warn(`(${store}) Rate limited by Fab API. Stopping parsing.`);
      allowedToParse = false;

      browserAPI.runtime.sendMessage({ source:"CONTENT", action:"ERROR", data: {
          message: 'Rate limited by Fab API. Resume at a later time.'
      } });
    }
    
    return null;
  }
  else {
    sendTestResultMessage("parseQuixelAssetsFromFetchJson(): fetch Quixel listings", true, `Successfully fetched Quixel listings from ${apiUrl}`);
  }

  const mainListings = await response.json();
  const nextCursor = await parseQuixelRelevantDataFromFabJson(mainListings);
  return nextCursor;
}


async function parseQuixelRelevantDataFromFabJson(mainListings) {
  if (!'cursors' in mainListings || !('next' in mainListings['cursors']) || !'results' in mainListings) {
    sendTestResultMessage("parseQuixelRelevantDataFromFabJson(): validate mainListings structure", false, `Missing cursors or results in mainListings.`);
    return null;
  }
  else {
    sendTestResultMessage("parseQuixelRelevantDataFromFabJson(): validate mainListings structure", true, `found cursors and results in mainListings.`);
  }

  console.log("Quixel cursor next", mainListings['cursors']['next']);
  const nextCursor = mainListings['cursors']['next'];
  const results = mainListings['results'];
  const currentAssets = {};
  let i = 1;

  for (const item of results) {
    if (!('thumbnails' in item)) {
      sendTestResultMessage("parseQuixelRelevantDataFromFabJson(): validate item thumbnails", false, `Missing thumbnails in item.`);
      continue;
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("parseQuixelRelevantDataFromFabJson(): validate item thumbnails", true, `Found thumbnails in item.`);
    }

    // get thumbnail image
    const mediaThumbnailPackage = item['thumbnails'].filter(m => m.type == 'thumbnail');
    let imgUrl = null;

    if (mediaThumbnailPackage) {
      if (i < iterationLimitPerTest) {
        sendTestResultMessage("parseQuixelRelevantDataFromFabJson(): find mediaThumbnailPackage", true, `Found mediaThumbnailPackage in item.`);
      }

      if (!('images' in mediaThumbnailPackage[0])) {
        sendTestResultMessage("parseQuixelRelevantDataFromFabJson(): validate mediaThumbnailPackage images", false, `Missing images in mediaThumbnailPackage.`);
        continue;
      }
      else if (i < iterationLimitPerTest) {
        sendTestResultMessage("parseQuixelRelevantDataFromFabJson(): validate mediaThumbnailPackage images", true, `Found images in mediaThumbnailPackage.`);
      }

      const mediaThumbnails = mediaThumbnailPackage[0]['images'].filter(m => m.width == 320);
      if (mediaThumbnails && mediaThumbnails.length > 0) {
        imgUrl = mediaThumbnails[0].url;
      }
      else if (mediaThumbnailPackage[0]['images'].length > 0) {
        imgUrl = mediaThumbnailPackage[0]['images'][0].url; // use the first image if there isn't a 320 width image
      }

      if (!imgUrl) {
        sendTestResultMessage("parseQuixelRelevantDataFromFabJson(): find imgUrl", false, `Missing imgUrl in mediaThumbnails.`);
      }
      else if (i < iterationLimitPerTest) {
        sendTestResultMessage("parseQuixelRelevantDataFromFabJson(): find imgUrl", true, `Found imgUrl in mediaThumbnails.`);
      }
    }
    else {
      sendTestResultMessage("parseQuixelRelevantDataFromFabJson(): find mediaThumbnailPackage", false, `Missing mediaThumbnailPackage in item.`);
    }

    if (!('tags' in item) || !Array.isArray(item['tags'])) {
      sendTestResultMessage("parseQuixelRelevantDataFromFabJson(): validate item tags", false, `Missing tags in item.`);
      continue;
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("parseQuixelRelevantDataFromFabJson(): validate item tags", true, `Found tags in item.`);
    }

    if (!('category' in item) || !('name' in item['category'])) {
      sendTestResultMessage("parseQuixelRelevantDataFromFabJson(): validate item category", false, `Missing category name in item.`);
      continue;
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("parseQuixelRelevantDataFromFabJson(): validate item category", true, `Found category name in item.`);
    }

    if (!('title' in item)) {
      sendTestResultMessage("parseQuixelRelevantDataFromFabJson(): validate item title", false, `Missing title in item.`);
      continue;
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("parseQuixelRelevantDataFromFabJson(): validate item title", true, `Found title in item.`);
    }

    const tags = item['tags'].map((t) => t.slug);
    const category = item['category']['name'];
    const title = item['title'];
    const url = 'https://www.fab.com/listings/' + item['uid'];
    const publisher = "Quixel Megascans"; // item['user']['sellerName'];
    const purchaseDate = '';
    const orderId = '';
    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':tags, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[url] = product;

    i += 1;
  }

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return nextCursor;
}


async function setQuixelTotalCount() {
  const apiUrl = 'https://www.fab.com/i/listings/search?aggregate_on=category_per_listing_type&count=0&seller=Quixel+Megascans';
  const response = await fetch(apiUrl);

  if (!response.ok) {
    console.error(`Fab HTTP error! status: ${response.status}`);
    sendTestResultMessage("setQuixelTotalCount(): fetch category aggregations", false, `Failed to fetch category aggregations from ${apiUrl}. HTTP status: ${response.status}`);
    return null;
  }
  else {
    sendTestResultMessage("setQuixelTotalCount(): fetch category aggregations", true, `Successfully fetched category aggregations from ${apiUrl}`);
  }

  const data = await response.json();

  if (!data['aggregations'] || !data['aggregations']['categoryPerListingType'] || !data['aggregations']['categoryPerListingType']['buckets']) {
    sendTestResultMessage("setQuixelTotalCount(): validate aggregation data", false, `Invalid aggregation data structure.`);
    return null;
  }
  else {
    sendTestResultMessage("setQuixelTotalCount(): validate aggregation data", true, `Aggregation data structure is valid.`);
  }

  const buckets = data['aggregations']['categoryPerListingType']['buckets'];
  let totalCount = 0, singleTestDocCount = true;

  for (const bucketKey in buckets) {
    if (!('docCount' in buckets[bucketKey])) {
      sendTestResultMessage("setQuixelTotalCount(): validate docCount in bucket", false, `Missing docCount in bucket ${bucketKey}.`);
      continue;
    }
    else if (singleTestDocCount) {
      sendTestResultMessage("setQuixelTotalCount(): validate docCount in bucket", true, `Found docCount in bucket ${bucketKey}.`);
      singleTestDocCount = false;
    }

    totalCount += buckets[bucketKey]['docCount'];
  }

  if (!('aggregations' in data) || !('categoryPerListingType' in data['aggregations']) || !('othersCount' in data['aggregations']['categoryPerListingType'])) {
    sendTestResultMessage("setQuixelTotalCount(): validate othersCount in aggregations", false, `Missing othersCount in aggregations.`);
    return null;
  }
  else {
    sendTestResultMessage("setQuixelTotalCount(): validate othersCount in aggregations", true, `Found othersCount in aggregations.`);
  }

  totalCount += data['aggregations']['categoryPerListingType']['othersCount'];
  itemTotal = totalCount;
}
