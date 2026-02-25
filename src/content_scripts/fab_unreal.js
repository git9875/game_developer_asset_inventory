const browserAPI = chrome || browser;
const currentUrl = window.location.href.toLowerCase();
const store = "Fab Unreal";
const sleepMilliseconds = 700;
let allowedToParse = false;
let itemCount = 0;
let itemTotal = 100; // set by getAggregateCount() or getQuixelAggregateCount()
let lastFabCursor = null;
let lastQuixelCursor = null;


browserAPI.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    // console.log(`(${store}) Message from the background script:`, request.command, lastFabCursor);

    if (request.command === "PARSE_GAME_ASSETS") {
        console.log(`(${store}) Start parsing`);
        allowedToParse = true;

        setUnrealTotalCount(); // not worried about race condition when reporting percentDone since it will be set after the next round
        mainFabUnrealParsing();
    }
    else if (request.command === "STOP_PARSING") {
        console.log(`(${store}) Stopping parsing as per request.`);
        allowedToParse = false;
    }
});

async function mainFabUnrealParsing() {
    let nextCursor = lastFabCursor || await parseFabAssetsFromHtml();

    while (nextCursor) {
      if (!allowedToParse) { break; }
      const nextCursor2 = await parseFabAssetsFromFetchJson(nextCursor);
      lastFabCursor = nextCursor2;
      nextCursor = (nextCursor2 != nextCursor) ? nextCursor2 : null; // if it repeats, then we are done
    }
}



async function parseFabAssetsFromHtml() {
  const jsonStr = document.getElementById('js-json-data-prefetched-data').innerHTML;
  const data = JSON.parse(jsonStr);
  const mainListings = data["/i/library/search?sort_by=-createdAt&source=acquired"]; // from HTML only
  const nextCursor = parseFabRelevantDataFromFabJson(mainListings);
  return nextCursor;
}

async function parseFabAssetsFromFetchJson(thisCursor) {
  const apiUrl = 'https://www.fab.com/i/library/search?sort_by=-createdAt&source=acquired&cursor=' + thisCursor;
  const response = await fetch(apiUrl);

  if (!response.ok) {
    console.error(`Fab HTTP error! status: ${response.status}`);
    return null;
  }

  const mainListings = await response.json();
  const nextCursor = parseFabRelevantDataFromFabJson(mainListings);
  return nextCursor;
}

async function parseFabRelevantDataFromFabJson(mainListings) {
  const nextCursor = mainListings['cursors']['next'];
  const results = mainListings['results'];
  const currentAssets = {};

  for (const item of results) {
    // get thumbnail image
    let imgUrl = null;

    if (item['listing']['thumbnails'] && item['listing']['thumbnails'].length > 0) {
      const thumbnailMedia = item['listing']['thumbnails'][0];
      if (thumbnailMedia['type'] == 'thumbnail' && thumbnailMedia['images']) {
        const thumbnailImages = thumbnailMedia['images'].filter(m => m.width == 320);
        if (thumbnailImages && thumbnailImages.length > 0) {
          imgUrl = thumbnailImages[0].url;
        }
      }
      if (!imgUrl) {
        imgUrl = thumbnailMedia['mediaUrl']; // use the default image if there isn't a better image
      }
    }

    const title = item['listing']['title'];
    const url = 'https://www.fab.com/listings/' + item['listing']['uid'];
    const publisher = item['listing']['publisher']['sellerName'];
    const purchaseDate = item['createdAt'].substring(0,10); // only get the date from the timestamp
    const orderId = '';
    const { tags, category } = await getTagsAndCategory(item['listing']['uid']);
    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':tags, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[url] = product;
  }

  itemCount += Object.keys(results).length;
  let percentDone = (itemCount == itemTotal) ? 100 : Math.min( Math.round( (itemCount / itemTotal) * 100 ), 99 );
  // avoid sending 100% until the very end
  if (!nextCursor) {
    percentDone = 100;
  }

  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
      percentDone: percentDone,
      assets: currentAssets
  } });

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;

  return nextCursor;
}

async function setUnrealTotalCount() {
  const apiUrl = 'https://www.fab.com/i/library/entitlements/search?aggregate_on=category_per_listing_type&count=0&sort_by=-createdAt';
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

async function getTagsAndCategory(listingId) {
  const apiUrl = 'https://www.fab.com/i/listings/' + listingId;
  const response = await fetch(apiUrl);

  if (!response.ok) {
    console.error(`Fab HTTP error! status: ${response.status}`);
    return null;
  }

  const data = await response.json();
  const tags = data['tags'].map((t) => t.slug);
  const category = data['category'] ? data['category'].slug : null;
  return { tags, category };
}
