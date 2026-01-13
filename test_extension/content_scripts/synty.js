const browserAPI = chrome || browser;
const store = 'Synty';
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



// https://account.syntystore.com/orders
async function mainParsing() {
  if (! document.getElementById('web-pixels-manager-setup')) {
    sendTestResultMessage("mainParsing(): validate presence of auth token script tag", false, `Auth token script tag not found on orders page.`);
    return;
  }
  else {
    sendTestResultMessage("mainParsing(): validate presence of auth token script tag", true, `Auth token script tag found on orders page.`);
  }

  const scriptTagStr = document.getElementById('web-pixels-manager-setup').textContent;
  const customerIdStartIdx = scriptTagStr.indexOf('"customer":{"id":"') + 18;
  const customerIdEndIdx = scriptTagStr.indexOf('"', customerIdStartIdx);

  if (customerIdStartIdx === -1 || customerIdEndIdx === -1) {
    sendTestResultMessage("mainParsing(): extract customer ID from script tag", false, `Could not extract customer ID from auth token script tag.`);
    return;
  } else {
    sendTestResultMessage("mainParsing(): extract customer ID from script tag", true, `Customer ID extracted from auth token script tag.`);
  }

  const customerId = scriptTagStr.substring(customerIdStartIdx, customerIdEndIdx);

  if (! localStorage.getItem(`app:css-key:__CUSTOMER_ACCOUNT_EXCHANGE_TOKEN__-sid:22316843-cid:${customerId}`)) {
    sendTestResultMessage("mainParsing(): validate presence of auth token in local storage", false, `Auth token not found in local storage for customer ID ${customerId}.`);
    return;
  }
  else {
    sendTestResultMessage("mainParsing(): validate presence of auth token in local storage", true, `Auth token found in local storage for customer ID ${customerId}.`);
  }

  const authTokenData = JSON.parse( localStorage.getItem(`app:css-key:__CUSTOMER_ACCOUNT_EXCHANGE_TOKEN__-sid:22316843-cid:${customerId}`) );
  const accessToken = authTokenData ? authTokenData['accessToken'] : null;
  const orderUrls = [];

  if (!accessToken) {
    sendTestResultMessage("mainParsing(): validate extraction of access token", false, `Could not extract access token from local storage data for customer ID ${customerId}.`);
    return;
  } else {
    sendTestResultMessage("mainParsing(): validate extraction of access token", true, `Access token extracted from local storage data for customer ID ${customerId}.`);
  }

  let i = 1;
  let cursor = 'SKIP';

  while (cursor) {
    if (!allowedToParse) { break; }
    const [newCursor, orderUrlsPartial] = await graphQlRequestOrders(cursor, accessToken);
    cursor = newCursor;
    orderUrls.push(...orderUrlsPartial);

    i += 1;

    if (i > iterationLimitPerTest) {
      break;
    }
  }

  const totalPages = orderUrls.length;
  let pageNumber = 1;

  if (totalPages === 0) {
    sendTestResultMessage("mainParsing(): validate presence of orders", false, `No orders found for the user.`);
    return;
  } else {
    sendTestResultMessage("mainParsing(): validate presence of orders", true, `Found ${totalPages} orders for the user.`);
  }

  for (const orderUrl of orderUrls) {
    if (!allowedToParse) { break; }
    await graphQlRequestOrderDetails(orderUrl, accessToken, pageNumber, totalPages);
    pageNumber += 1;

    if (pageNumber > iterationLimitPerTest) {
      break;
    }
  }
}


async function graphQlRequestOrders(cursor, accessToken) {
  const graphQlPayload = '{"operationName":"Orders","variables":{"isBusinessCustomer":false,"first":50,"businessAccountSortKey":"PROCESSED_AT","personalAccountSortKey":"PROCESSED_AT","reverse":true,"companyId":"gid://shopify/Company/0","query":"(purchasing_entity:Customer)"},"query":"query Orders($isBusinessCustomer: Boolean!, $companyId: ID!, $before: String, $after: String, $first: Int, $last: Int, $query: String, $businessAccountSortKey: OrderByContactSortKeys, $personalAccountSortKey: OrderSortKeys, $reverse: Boolean!) {customer @skip(if: $isBusinessCustomer) {id orders(first: $first last: $last before: $before after: $after sortKey: $personalAccountSortKey reverse: $reverse query: $query ) {nodes {id ...OrderNode __typename } pageInfo {...PageInfo __typename } __typename } __typename } company(id: $companyId) @include(if: $isBusinessCustomer) {id profile {id hasPermissionOnLocations(permissions: [VIEW], scope: ANY, resource: ORDER) orders(first: $first last: $last before: $before after: $after sortKey: $businessAccountSortKey reverse: $reverse query: $query ) {nodes {id ...OrderNode poNumber __typename } pageInfo {...PageInfo __typename } __typename } __typename } __typename } } fragment OrderNode on Order {id name customerFulfillmentStatus processedAt } fragment PageInfo on PageInfo {hasNextPage hasPreviousPage startCursor endCursor __typename }"}';

  let ordersUrl = 'https://account.syntystore.com/customer/api/unstable/graphql?operation=Orders';
  if (cursor && cursor != 'SKIP') {
    ordersUrl += '&cursor=' + cursor;
  }

  const response = await fetch(ordersUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': '*/*',
      'Authorization': accessToken
    },
    body: graphQlPayload,
  });

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}`);
    sendTestResultMessage("graphQlRequestOrders(): fetch orders", false, `Failed to fetch orders from ${ordersUrl}. HTTP status: ${response.status}.`);
    return [null, []];
  }
  else {
    sendTestResultMessage("graphQlRequestOrders(): fetch orders", true, `Successfully fetched orders from ${ordersUrl}. HTTP status: ${response.status}.`);
  }

  const result = await response.json();

  if (!('data' in result) || !('customer' in result['data']) || !('orders' in result['data']['customer'])) {
    sendTestResultMessage("graphQlRequestOrders(): validate orders data structure", false, `Invalid orders data structure from ${ordersUrl}.`);
    return [null, []];
  }
  else {
    sendTestResultMessage("graphQlRequestOrders(): validate orders data structure", true, `Valid orders data structure from ${ordersUrl}.`);
  }

  const orderNodes = result['data']['customer']['orders']['nodes'];
  const orderUrls = [];
  let i = 1;

  if (orderNodes.length === 0) {
    sendTestResultMessage("graphQlRequestOrders(): validate presence of order nodes", false, `No order nodes found in orders data from ${ordersUrl}.`);
    return [null, []];
  }
  else {
    sendTestResultMessage("graphQlRequestOrders(): validate presence of order nodes", true, `Found ${orderNodes.length} order nodes in orders data from ${ordersUrl}.`);
  }

  for (const item of orderNodes) {
    if (!('id' in item) || !('name' in item) || !('processedAt' in item) || !('customerFulfillmentStatus' in item)) {
      sendTestResultMessage("graphQlRequestOrders(): validate order node structure", false, `Invalid order node structure: ${JSON.stringify(item)}`);
      continue;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("graphQlRequestOrders(): validate order node structure", true, `Valid order node structure for order ID ${item['id']}, row ${i}.`);
    }

    const id = item['id'];
    const name = item['name'];
    const processedAt = item['processedAt'];
    const status = item['customerFulfillmentStatus'];

    if (status == 'COMPLETE') {
      const urlOrderId = id.split('/').pop(); // "65106149820"
      orderUrls.push(urlOrderId);
    }

    i += 1;
  }

  if (orderUrls.length === 0) {
    sendTestResultMessage("graphQlRequestOrders(): validate presence of completed orders", false, `No completed orders found in orders data from ${ordersUrl}.`);
  }
  else {
    sendTestResultMessage("graphQlRequestOrders(): validate presence of completed orders", true, `Found ${orderUrls.length} completed orders in orders data from ${ordersUrl}.`);
  }

  if (!('pageInfo' in result['data']['customer']['orders'])) {
    sendTestResultMessage("graphQlRequestOrders(): validate pagination pageInfo", false, `Invalid pagination pageInfo data from ${ordersUrl}.`);
    return [null, orderUrls];
  }
  else {
    sendTestResultMessage("graphQlRequestOrders(): validate pagination pageInfo", true, `Valid pagination pageInfo data from ${ordersUrl}.`);
  }

  const pageInfo = result['data']['customer']['orders']['pageInfo'];
  const nextCursor = pageInfo['hasNextPage'] ? pageInfo['nextCursor'] : null;

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return [nextCursor, orderUrls];
}


async function graphQlRequestOrderDetails(urlOrderId, accessToken, pageNumber, totalPages) {
  const graphQlPayload = {"operationName":"OrderDetails","variables":{"redacted":false,"isReturnFeesEnabled":true,"isPreAuth":false,"isRedactedOrBusinessCustomer":false,"extensionIds":["gid://shopify/UiExtension/b0a92126-5db7-4adc-9628-40477cd337eb","gid://shopify/UiExtension/b0a92126-5db7-4adc-9628-40477cd337eb","gid://shopify/UiExtension/12c7e0b9-cc0a-4f92-b91e-d6922690d789","gid://shopify/UiExtension/a6f8ff0e-a6c9-45b1-bf5b-71db856708af"],"extensionHandles":[],"orderId":"gid://shopify/Order/"+urlOrderId,"isBusinessCustomer":false},"query":"query OrderDetails($orderId: ID!, $redacted: Boolean = false, $extensionIds: [ID!] = [], $extensionHandles: [ExtensionHandleInput!] = []) {order(id: $orderId) {id ...OrderFragment __typename } uiExtensionMetafields(orderId: $orderId extensionIds: $extensionIds extensionHandles: $extensionHandles ) @skip(if: $redacted) {id ownerId key namespace type value valueType __typename } } fragment OrderFragment on Order {id name processedAt fulfillments(first: 20 sortKey: CREATED_AT reverse: true query: \"NOT status:CANCELLED\" ) {edges {node {id ...Fulfillment __typename } __typename } __typename } fulfillmentStatus __typename } fragment Fulfillment on Fulfillment {id status createdAt fulfillmentLineItems(first: 20) {nodes {id quantity lineItem {id name title presentmentTitle sku image {...ImageThumbnail __typename } __typename } __typename } __typename } __typename } fragment ImageThumbnail on Image {id url(transform: {maxWidth: 128, maxHeight: 128}) altText __typename } "};
  let ordersUrl = 'https://account.syntystore.com/customer/api/unstable/graphql?operation=OrderDetails';

  const response = await fetch(ordersUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': '*/*',
      'Authorization': accessToken
    },
    body: JSON.stringify(graphQlPayload)
  });

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}`);
    sendTestResultMessage("graphQlRequestOrderDetails(): validate HTTP response", false, `HTTP error! status: ${response.status}`);
    return;
  }
  else {
    sendTestResultMessage("graphQlRequestOrderDetails(): validate HTTP response", true, `Successfully fetched order details. HTTP status: ${response.status}`);
  }

  const result = await response.json();
  const order = result['data']['order'];

  if (order['fulfillmentStatus'] != 'FULFILLED') {
    console.warn(`Order ${urlOrderId} is not fulfilled yet.`);
    sendTestResultMessage("graphQlRequestOrderDetails(): validate fulfillment status", false, `Order ${urlOrderId} is not fulfilled yet.`);
    return;
  }
  else {
    sendTestResultMessage("graphQlRequestOrderDetails(): validate fulfillment status", true, `Order ${urlOrderId} is fulfilled.`);
  }

  if (!('name' in order) || !('processedAt' in order) || !('fulfillments' in order) || !('edges' in order['fulfillments'])) {
    console.error(`${store} Invalid order details data structure.`, order);
    sendTestResultMessage("graphQlRequestOrderDetails(): validate order details", false, `Invalid order details data from ${ordersUrl}.`);
    return;
  }
  else {
    sendTestResultMessage("graphQlRequestOrderDetails(): validate order details", true, `Valid order details data from ${ordersUrl}.`);
  }

  const orderId = order['name'].substring(1); // "#SS-340939" -> "SS-340939"
  const publisher = store;
  const purchaseDate = order['processedAt'];
  const orderEdges = result['data']['order']['fulfillments']['edges'];
  const currentAssets = {};
  let i = 1;

  if (orderEdges.length === 0) {
    sendTestResultMessage("graphQlRequestOrderDetails(): validate presence of fulfillment edges", false, `No fulfillment edges found in order details data from ${ordersUrl}.`);
    return;
  }
  else {
    sendTestResultMessage("graphQlRequestOrderDetails(): validate presence of fulfillment edges", true, `Found ${orderEdges.length} fulfillment edges in order details data from ${ordersUrl}.`);
  }

  for (const edge of orderEdges) {
    let j = 1;

    if (!('node' in edge) || !('fulfillmentLineItems' in edge['node']) || !('nodes' in edge['node']['fulfillmentLineItems'])) {
      sendTestResultMessage("graphQlRequestOrderDetails(): validate fulfillment line items structure", false, `Invalid fulfillment line items structure: ${JSON.stringify(edge)}`);
      continue;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("graphQlRequestOrderDetails(): validate fulfillment line items structure", true, `Valid fulfillment line items structure for fulfillment ID ${edge['node']['id']}, row ${i}.`);
    }

    for (const item of edge['node']['fulfillmentLineItems']['nodes']) {
      const lineItem = item['lineItem'];

      if (!lineItem) {
        sendTestResultMessage("graphQlRequestOrderDetails(): validate line item presence", false, `No line item found in fulfillment line item: ${JSON.stringify(item)}`);
        continue;
      }
      else if (j <= iterationLimitPerTest) {
        sendTestResultMessage("graphQlRequestOrderDetails(): validate line item presence", true, `Line item found in fulfillment line item for line item ID ${item['id']}, row ${j}.`);
      }

      let url = '', canGetTags = false;
      if (lineItem['sku'] && lineItem['sku'].length > 0) {
        url = `https://www.syntystore.com/products/${lineItem['sku']}`;
        canGetTags = true;
      } else {
        url = `https://www.syntystore.com/search?q=${encodeURIComponent(lineItem['title'])}&options%5Bprefix%5D=last`; // search URL as fallback
      }

      if (!('image' in lineItem) || !lineItem['image'] || !('url' in lineItem['image'])) {
        sendTestResultMessage("graphQlRequestOrderDetails(): validate line item image presence", false, `No image found for line item ID ${lineItem['id']}, row ${j}.`);
      }
      else if (j <= iterationLimitPerTest) {
        sendTestResultMessage("graphQlRequestOrderDetails(): validate line item image presence", true, `Image found for line item ID ${lineItem['id']}, row ${j}.`);
      }

      // const tags = canGetTags ? await getTagsFromProductPage(url, accessToken) : null;
      const imgUrl = lineItem['image'] ? lineItem['image']['url'] : '';
      const title = lineItem['name'];

      if (!title) {
        sendTestResultMessage("graphQlRequestOrderDetails(): validate line item title presence", false, `No title found for line item ID ${lineItem['id']}, row ${j}.`);
      }
      else if (j <= iterationLimitPerTest) {
        sendTestResultMessage("graphQlRequestOrderDetails(): validate line item title presence", true, `Title found for line item ID ${lineItem['id']}, row ${j}.`);
      }

      const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':null, 'tags':null, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
      currentAssets[url] = product;

      j += 1;
    }

    i += 1;
  }

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
}


/*
// Cannot fetch category due to CORS restrictions on subdomains of product URLs.
// It can be done via background script, but that requires more effort than it's worth right now.
async function getTagsFromProductPage(productUrl, accessToken) {
  const jsUrl = productUrl + '.js';
  const response = await fetch(jsUrl, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': accessToken
    }
  });

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}`);
    return [];
  }

  const result = await response.json();
  const removeTagsFilter = ["fbx", "full-price", "polygon", "hideallaccessbanner", "modern", "free"];
  const tags = result['tags'] || [];

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return tags.filter(tag => !removeTagsFilter.includes(tag.toLowerCase()));
}
*/