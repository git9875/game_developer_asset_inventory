const browserAPI = chrome || browser;
const store = 'Unity';
const sleepMilliseconds = 500;
let allowedToParse = false;
let productIndex = 0;
const tagFilterList = ['fbx', 'jpg', 'adobe', 'illustator', 'general', 'cs', 'graphic', 'and', 'png', 'ai', 'svg', 'coreldraw', 'age', 'cdr', 'eps', 'psd', 'photoshop', 'ui', 'x', 'psds', 'pngs', 'cc', 'item', 'obj', 'blender', 'model', 'art', 'wav', 'massive', 'various', 'game', 'big', 'multi', 'genre', 'audition', 'ogg', 'pro', 'complete', 'minimalist', 'interface', 'top', 'down', 'inkscape', 'super', 'eps', 'volume', 'mtl', 'max', 'tga', 'set', 'zbrush', 'substance', 'unitypackage', 'post', 'painter', 'maya', 'the', 'lsdj', 'sid', 'game'];


browserAPI.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    // console.log(`(${store}) Message from the background script:`, request.command);

    if (request.command === "PARSE_GAME_ASSETS") {
        console.log(`(${store}) Start parsing`);
        allowedToParse = true;
        mainParsing();
    }
    else if (request.command === "STOP_PARSING") {
        console.log(`(${store}) Stopping parsing as per background script request.`);
        allowedToParse = false;
        productIndex -= 1; // step back one to retry on next start
    }
});

async function mainParsing() {
    let countOfAssets = 0;

    while (productIndex != -1) {
      if (!allowedToParse) { break; }
      const [nextIdx, currentAssetCount] = await parseLibraryAssets(productIndex, countOfAssets);
      if (!nextIdx) { break; }

      productIndex = nextIdx;
      countOfAssets = currentAssetCount;
    }
}


// https://assetstore.unity.com/account/assets
async function parseLibraryAssets(startIdx, oldAssetCount) {
  const csrfToken = parseCookies();
  const orgId = getOrgIdFromHeadScript();
  const itemsPerPage = 100;
  const assetProductIdsJson = localStorage.getItem(`myAssets-${orgId}`);

  if (!assetProductIdsJson) {
    console.warn(`(${store}) No asset product IDs found in localStorage for orgId ${orgId}`);
    browserAPI.runtime.sendMessage({ source:"CONTENT", action:"ERROR", data: {
        message: 'Could not find product IDs.'
    } });

    return [-1, 0];
  }

  const assetProductIds = JSON.parse(assetProductIdsJson);
  const moreToGo = assetProductIds.length - startIdx;
  let endIdx = startIdx + Math.min(itemsPerPage, moreToGo);
  const assetProductIdsSlice = assetProductIds.slice(startIdx, endIdx);
  const totalItems = assetProductIds.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  if (moreToGo < itemsPerPage) {
    endIdx = -1; // end outer loop
  }

  const graphQlQueries = [];

  for (const productId of assetProductIdsSlice) {
    const query = {"query":"query Product($id: ID!) {  product(id: $id) { ...product  }  }   fragment product on Product {id productId itemId slug name description currentVersion {id name publishedDate } downloadSize assetCount publisher {id name url supportUrl supportEmail gaAccount gaPrefix } mainImage {big small icon icon75 } category {id name slug longName __typename } }","variables":{ "id":productId.toString() },"operationName":"Product"};
    const tagsQuery = {"query":"query ProductTags($id: ID!) {product(id: $id) {id productId popularTags {name } } }","variables":{"id":productId.toString() },"operationName":"ProductTags"};
    graphQlQueries.push(query, tagsQuery);
  }

  const batchUrl = 'https://assetstore.unity.com/api/graphql/batch';
  const response = await fetch(batchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Accept': 'application/json, text/plain, */*',
      'x-csrf-token': csrfToken,
      'x-requested-with': 'XMLHttpRequest',
      'x-source': 'storefront'
    },
    body: JSON.stringify(graphQlQueries),
  });

  if (!response.ok) {
    console.error(`HTTP error! status: ${response.status}`);

    browserAPI.runtime.sendMessage({ source:"CONTENT", action:"ERROR", data: {
        message: 'Bad HTTP response when querying for assets.'
    } });

    return [];
  }

  const result = await response.json();


  // result array will alternate between product info (1st) and tags info (2nd), so we need to merge them
  const products = {};
  const currentAssets = {};

  for (const item of result) {
    const resultProduct = item['data']['product'];
    const productId = resultProduct['productId']+'s'; // to ensure string key

    if ("publisher" in resultProduct) {
      // this is a product info response
      const url = `https://assetstore.unity.com/packages/${resultProduct['category']['slug']}/${resultProduct['slug']}`;
      const imgUrl = 'https:' + resultProduct['mainImage']['small'];
      const title = resultProduct['name'];
      const publisher = resultProduct['publisher']['name'];
      const orderId = '';
      const purchaseDate = '';
      const category = resultProduct['category']['slug'];
      const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':null, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
      products[productId] = product;
    }
    else {
      // this is a tags info response
      const tagsArray = resultProduct['popularTags'];
      products[productId]['tags'] = tagsArray.map(tagObj => tagObj['name'].toLowerCase()).filter(tag => !tagFilterList.includes(tag) && tag.length > 1);
      currentAssets[ products[productId]['url'] ] = products[productId];
    }
  }


  const currentAssetCount = oldAssetCount + Object.keys(currentAssets).length;
  // console.log(`(${store}) Parsed assets totalItems= ${totalItems} ; currentAssetCount= ${currentAssetCount} ; totalPages= ${totalPages} ; oldAssetCount= ${oldAssetCount} ; currentAssets.length=`, Object.keys(currentAssets).length);
  const percentDone = (endIdx === -1) ? 100 : Math.min( Math.round( (currentAssetCount / totalItems) * 100 ), 99 );
  // avoid sending 100% until the very end

  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
      percentDone: percentDone,
      assets: currentAssets
  } });

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;

  return [endIdx, currentAssetCount];
}



function parseCookies() {
  // let orgId = '';
  let csrfToken = '';
  const cookieTokens = document.cookie.split('; ');

  for (const cookie of cookieTokens) {
    if (cookie.startsWith('_csrf=')) {
      csrfToken = cookie.substring(6);
      break;
    }
  }

  return csrfToken;
}

function getOrgIdFromHeadScript() {
  const headInnerHtml = document.head.innerHTML;
  const orgIdStartIdx = headInnerHtml.indexOf("GlobalData.user.user_org_id = '") + 31;
  const orgIdEndIdx = headInnerHtml.indexOf("'", orgIdStartIdx);
  return headInnerHtml.substring(orgIdStartIdx, orgIdEndIdx);
}