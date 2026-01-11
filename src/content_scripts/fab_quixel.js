const browserAPI = chrome || browser;
const currentUrl = window.location.href.toLowerCase();
const store = "Fab Quixel Megascans";
const sleepMilliseconds = 700;
let allowedToParse = false;
let itemCount = 0;
let itemTotal = 100; // set by getAggregateCount() or getQuixelAggregateCount()
let categoryDocTotal = 0;
let lastCategorySlug = null;


browserAPI.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    // console.log(`(${store}) Message from the background script:`, request.command, lastFabCursor);

    if (request.command === "PARSE_GAME_ASSETS") {
        console.log(`(${store}) Start parsing`);
        allowedToParse = true;

        setQuixelTotalCount(); // not worried about race condition when reporting percentDone since it will be set after the next round
        mainFabQuixelParsing();
    }
    else if (request.command === "STOP_PARSING") {
        console.log(`(${store}) Stopping parsing as per request.`);
        allowedToParse = false;
    }
});


async function mainFabQuixelParsing() {
    const mergedCategoryData = await mergeCategoryData();
    // console.log(`(${store}) Merged category data`, mergedCategoryData);

    // iterate over categories; resume from lastCategorySlug if set because of stop command or Fab rate limiting
    const categorySlugs = Object.keys(mergedCategoryData);
    let categorySlugCount = categorySlugs.length;
    let i = (lastCategorySlug) ? categorySlugs.indexOf(lastCategorySlug) : 0;

    for (; i < categorySlugCount; i++) {
      if (!allowedToParse) { break; }
      const categorySlug = categorySlugs[i];
      const categoryInfo = mergedCategoryData[categorySlug];
      // console.log(`(${store}) Starting category parsing`, categorySlug, categoryInfo);

      let nextCursor = await parseQuixelAssetsFromFetchJson(categoryInfo['listingType'], categorySlug, null);

      while (nextCursor) {
        if (!allowedToParse) { break; }
        const nextCursor2 = await parseQuixelAssetsFromFetchJson(categoryInfo['listingType'], categorySlug, nextCursor);
        nextCursor = (nextCursor2 != nextCursor) ? nextCursor2 : null; // if it repeats, then we are done
      }
      
      lastCategorySlug = categorySlug;
    }

  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
      percentDone: 100,
      assets: {}
  } });
}


function getCategoryUids() {
  const jsonStr = document.getElementById('js-json-data-prefetched-data').innerHTML;
  const data = JSON.parse(jsonStr);
  const categoryTree = data['/i/taxonomy/categories/tree']['results'];
  const categoryUids = {};
  for (const mainKey in categoryTree) {
    traverseCategoryUids(categoryTree[mainKey], categoryUids);
  }
  return categoryUids;
}

function traverseCategoryUids(categoryBranch, categoryUids) {
  for (const category of categoryBranch) {
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
    console.error(`Fab HTTP error! status: ${response.status}`);
    return null;
  }

  const data = await response.json();
  const buckets = data['aggregations']['categoryPerListingType']['buckets'];
  const categoryAggregations = {};

  for (const bucketKey in buckets) {
    const uids = buckets[bucketKey]['category']['buckets'];
    for (const uidKey in uids) {
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

  // less keys to iterate over with categoryAggregations than categoryUids
  for (const uidKey in categoryAggregations) {
    const uidInfo = categoryAggregations[uidKey];

    if (categoryUids[uidKey]) {
      mergedCategoryData[categoryUids[uidKey]] = { // use slug as key
        "uid": uidKey,
        "listingType": uidInfo['listingType'],
        "docCount": uidInfo['docCount']
      };
    }
  }

  return mergedCategoryData;
}


async function parseQuixelAssetsFromHtml() {
  const jsonStr = document.getElementById('js-json-data-prefetched-data').innerHTML;
  const data = JSON.parse(jsonStr);
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

    if (response.status == 429) {
      console.warn(`(${store}) Rate limited by Fab API. Stopping parsing.`);
      allowedToParse = false;

      browserAPI.runtime.sendMessage({ source:"CONTENT", action:"ERROR", data: {
          message: 'Rate limited by Fab API. Resume at a later time.'
      } });
    }
    
    return null;
  }

  const mainListings = await response.json();
  const nextCursor = await parseQuixelRelevantDataFromFabJson(mainListings);
  return nextCursor;
}


async function parseQuixelRelevantDataFromFabJson(mainListings) {
  // console.log("Quixel cursor next", mainListings['cursors']['next']);
  const nextCursor = mainListings['cursors']['next'];
  const results = mainListings['results'];
  const currentAssets = {};

  for (const item of results) {
    // get thumbnail image
    const mediaThumbnailPackage = item['thumbnails'].filter(m => m.type == 'thumbnail');
    let imgUrl = null;

    if (mediaThumbnailPackage) {
      const mediaThumbnails = mediaThumbnailPackage[0]['images'].filter(m => m.width == 320);
      if (mediaThumbnails && mediaThumbnails.length > 0) {
        imgUrl = mediaThumbnails[0].url;
      }
      else if (mediaThumbnailPackage[0]['images'].length > 0) {
        imgUrl = mediaThumbnailPackage[0]['images'][0].url; // use the first image if there isn't a 320 width image
      }
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
  }

  itemCount += Object.keys(results).length;
  let percentDone = (itemCount == itemTotal) ? 100 : Math.min( Math.round( (itemCount / itemTotal) * 100 ), 99 );

  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
      percentDone: percentDone,
      assets: currentAssets
  } });

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return nextCursor;
}


async function setQuixelTotalCount() {
  const apiUrl = 'https://www.fab.com/i/listings/search?aggregate_on=category_per_listing_type&count=0&seller=Quixel+Megascans';
  const response = await fetch(apiUrl);

  if (!response.ok) {
    console.error(`Fab HTTP error! status: ${response.status}`);
    return null;
  }

  const data = await response.json();
  const buckets = data['aggregations']['categoryPerListingType']['buckets'];
  let totalCount = 0;

  for (const bucketKey in buckets) {
    totalCount += buckets[bucketKey]['docCount'];
  }

  totalCount += data['aggregations']['categoryPerListingType']['othersCount'];
  itemTotal = totalCount;
}
