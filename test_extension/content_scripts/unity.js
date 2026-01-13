const browserAPI = chrome || browser;
const store = 'Unity';
const sleepMilliseconds = 500;
let allowedToParse = false;
let productIndex = 0;

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
        console.log(`(${store}) Stopping parsing as per background script request.`);
        allowedToParse = false;
        productIndex -= 1; // step back one to retry on next start
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
    let countOfAssets = 0, i = 1;

    while (productIndex != -1) {
      if (!allowedToParse) { break; }
      const [nextIdx, currentAssetCount] = await parseLibraryAssets(productIndex, countOfAssets);
      if (!nextIdx) { break; }

      productIndex = nextIdx;
      countOfAssets = currentAssetCount;
      
      i += 1;
      if (i > iterationLimitPerTest) {
        break; // limit number of iterations for testing
      }
    }
}


// https://assetstore.unity.com/account/assets
async function parseLibraryAssets(startIdx, oldAssetCount) {
  const csrfToken = parseCookiesForCsrfToken();
  const orgId = getOrgIdFromHeadScript();
  const itemsPerPage = 100;
  const assetProductIdsJson = localStorage.getItem(`myAssets-${orgId}`);

  if (!assetProductIdsJson) {
    console.warn(`(${store}) No asset product IDs found in localStorage for orgId ${orgId}`);
    sendTestResultMessage("parseLibraryAssets(): validate asset product IDs presence", false, `No asset product IDs found in localStorage for orgId ${orgId}`);

    return [-1, 0];
  }
  else {
    sendTestResultMessage("parseLibraryAssets(): validate asset product IDs presence", true, `Asset product IDs found in localStorage for orgId ${orgId}`);
  }

  const assetProductIds = JSON.parse(assetProductIdsJson);

  if (assetProductIds.length === 0) {
    console.warn(`(${store}) Asset product IDs list is empty for orgId ${orgId}`);
    sendTestResultMessage("parseLibraryAssets(): validate asset product IDs non-empty", false, `Asset product IDs list is empty for orgId ${orgId}`);

    return [-1, 0];
  }
  else {
    sendTestResultMessage("parseLibraryAssets(): validate asset product IDs non-empty", true, `Asset product IDs list has ${assetProductIds.length} items for orgId ${orgId}`);
  }

  const moreToGo = assetProductIds.length - startIdx;
  let endIdx = startIdx + Math.min(itemsPerPage, moreToGo);
  const assetProductIdsSlice = assetProductIds.slice(startIdx, endIdx);
  const totalItems = assetProductIds.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  if (moreToGo < itemsPerPage) {
    endIdx = -1; // end outer loop
  }

  const graphQlQueries = [];
  let i = 1;

  for (const productId of assetProductIdsSlice) {
    const query = {"query":"query Product($id: ID!) {  product(id: $id) { ...product  }  }   fragment product on Product {id productId itemId slug name description currentVersion {id name publishedDate } downloadSize assetCount publisher {id name url supportUrl supportEmail gaAccount gaPrefix } mainImage {big small icon icon75 } category {id name slug longName __typename } }","variables":{ "id":productId.toString() },"operationName":"Product"};
    const tagsQuery = {"query":"query ProductTags($id: ID!) {product(id: $id) {id productId popularTags {name } } }","variables":{"id":productId.toString() },"operationName":"ProductTags"};
    graphQlQueries.push(query, tagsQuery);

    if (i >= iterationLimitPerTest) {
      break; // limit number of products queried per page for testing
    }
    i += 1;
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
    sendTestResultMessage("parseLibraryAssets(): fetch graphql asset product data", false, `Failed to fetch asset product data from ${batchUrl}. HTTP status: ${response.status}`);
    return [];
  }
  else {
    sendTestResultMessage("parseLibraryAssets(): fetch graphql asset product data", true, `Successfully fetched asset product data from ${batchUrl}`);
  }

  const result = await response.json();

  if (!Array.isArray(result) || result.length === 0) {
    sendTestResultMessage("parseLibraryAssets(): validate graphql response", false, `Invalid or empty graphql response from ${batchUrl}`);
    return [];
  }
  else {
    sendTestResultMessage("parseLibraryAssets(): validate graphql response", true, `Valid graphql response received from ${batchUrl}`);
  }

  // result array will alternate between product info (1st) and tags info (2nd), so we need to merge them
  const products = {};
  const currentAssets = {};
  i = 1;

  for (const item of result) {
    if (!('data' in item) || !('product' in item['data'])) {
      sendTestResultMessage("mainParsing(): validate graphql item structure", false, `Invalid graphql item structure: ${JSON.stringify(item)}`);
      continue;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("mainParsing(): validate graphql item structure", true, `Valid graphql item structure for item index ${i}.`);
    }

    const resultProduct = item['data']['product'];
    const productId = resultProduct['productId']+'s'; // to ensure string key

    if ("publisher" in resultProduct) {
      if (!('category' in resultProduct) || !('slug' in resultProduct['category'])) {
        sendTestResultMessage("mainParsing(): validate product category presence", false, `No category found for product ID ${productId}, index ${i}.`);
        continue;
      }
      else if (i <= iterationLimitPerTest) {
        sendTestResultMessage("mainParsing(): validate product category presence", true, `Category found for product ID ${productId}, index ${i}.`);
      }

      // this is a product info response
      const url = `https://assetstore.unity.com/packages/${resultProduct['category']['slug']}/${resultProduct['slug']}`;

      if (!('mainImage' in resultProduct) || !('small' in resultProduct['mainImage'])) {
        sendTestResultMessage("mainParsing(): validate product image presence", false, `No main image found for product ID ${productId}, index ${i}.`);
        continue;
      }
      else if (i <= iterationLimitPerTest) {
        sendTestResultMessage("mainParsing(): validate product image presence", true, `Main image found for product ID ${productId}, index ${i}.`);
      }

      const imgUrl = 'https:' + resultProduct['mainImage']['small'];

      if (!('name' in resultProduct)) {
        sendTestResultMessage("mainParsing(): validate product title presence", false, `No title found for product ID ${productId}, index ${i}.`);
        continue;
      }
      else if (i <= iterationLimitPerTest) {
        sendTestResultMessage("mainParsing(): validate product title presence", true, `Title found for product ID ${productId}, index ${i}.`);
      }

      const title = resultProduct['name'];

      if (!('publisher' in resultProduct) || !('name' in resultProduct['publisher'])) {
        sendTestResultMessage("mainParsing(): validate product publisher presence", false, `No publisher found for product ID ${productId}, index ${i}.`);
        continue;
      }
      else if (i <= iterationLimitPerTest) {
        sendTestResultMessage("mainParsing(): validate product publisher presence", true, `Publisher found for product ID ${productId}, index ${i}.`);
      }

      const publisher = resultProduct['publisher']['name'];
      const orderId = '';
      const purchaseDate = '';
      const category = resultProduct['category']['slug'];
      const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':null, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
      products[productId] = product;
    }
    else {
      if (!('popularTags' in resultProduct) || !Array.isArray(resultProduct['popularTags']) || resultProduct['popularTags'].length === 0) {
        sendTestResultMessage("mainParsing(): validate popularTags presence", false, `No popular tags found for product ID ${productId}, index ${i}.`);
        continue;
      }
      else if (i <= iterationLimitPerTest) {
        sendTestResultMessage("mainParsing(): validate popularTags presence", true, `Popular tags found for product ID ${productId}, index ${i}.`);
      }

      // this is a tags info response
      const tagsArray = resultProduct['popularTags'];
      products[productId]['tags'] = tagsArray.map(tagObj => tagObj['name'].toLowerCase());
      currentAssets[ products[productId]['url'] ] = products[productId];
    }

    i += 1;
  }

  const currentAssetCount = oldAssetCount + Object.keys(currentAssets).length;

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;

  return [endIdx, currentAssetCount];
}



function parseCookiesForCsrfToken() {
  // let orgId = '';
  let csrfToken = '';
  const cookieTokens = document.cookie.split('; ');

  for (const cookie of cookieTokens) {
    if (cookie.startsWith('_csrf=')) {
      csrfToken = cookie.substring(6);
      break;
    }
  }

  if (!csrfToken) {
    console.warn(`(${store}) CSRF token not found in cookies.`);
    sendTestResultMessage("parseCookiesForCsrfToken(): validate CSRF token presence", false, `CSRF token not found in cookies.`);
  } else {
    sendTestResultMessage("parseCookiesForCsrfToken(): validate CSRF token presence", true, `CSRF token found in cookies.`);
  }

  return csrfToken;
}

function getOrgIdFromHeadScript() {
  const headInnerHtml = document.head.innerHTML;
  const orgIdStartIdx = headInnerHtml.indexOf("GlobalData.user.user_org_id = '") + 31;
  const orgIdEndIdx = headInnerHtml.indexOf("'", orgIdStartIdx);

  if (orgIdStartIdx === -1 || orgIdEndIdx === -1) {
    console.warn(`(${store}) Organization ID not found in head script.`);
    sendTestResultMessage("getOrgIdFromHeadScript(): validate organization ID presence", false, `Organization ID not found in head script.`);
    return '';
  } else {
    sendTestResultMessage("getOrgIdFromHeadScript(): validate organization ID presence", true, `Organization ID found in head script.`);
  }

  return headInnerHtml.substring(orgIdStartIdx, orgIdEndIdx);
}