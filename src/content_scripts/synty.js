const browserAPI = chrome || browser;
const store = 'Synty';
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


// https://account.syntystore.com/orders
async function mainParsing() {
  const scriptTagStr = document.getElementById('web-pixels-manager-setup').textContent;
  const customerIdStartIdx = scriptTagStr.indexOf('"customer":{"id":"') + 18;
  const customerIdEndIdx = scriptTagStr.indexOf('"', customerIdStartIdx);
  const customerId = scriptTagStr.substring(customerIdStartIdx, customerIdEndIdx);

  const authTokenData = JSON.parse( localStorage.getItem(`app:css-key:__CUSTOMER_ACCOUNT_EXCHANGE_TOKEN__-sid:22316843-cid:${customerId}`) );
  const accessToken = authTokenData ? authTokenData['accessToken'] : null;
  const orderUrls = [];

  let cursor = 'SKIP';
  while (cursor) {
    if (!allowedToParse) { break; }
    const [newCursor, orderUrlsPartial] = await graphQlRequestOrders(cursor, accessToken);
    cursor = newCursor;
    orderUrls.push(...orderUrlsPartial);
  }

  const totalPages = orderUrls.length;
  let pageNumber = 1;

  for (const orderUrl of orderUrls) {
    if (!allowedToParse) { break; }
    await graphQlRequestOrderDetails(orderUrl, accessToken, pageNumber, totalPages);
    pageNumber += 1;
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
    return [];
  }

  const result = await response.json();
  const orderNodes = result['data']['customer']['orders']['nodes'];
  const orderUrls = [];

  for (const item of orderNodes) {
    const id = item['id'];
    const name = item['name'];
    const processedAt = item['processedAt'];
    const status = item['customerFulfillmentStatus'];

    if (status == 'COMPLETE') {
      const urlOrderId = id.split('/').pop(); // "65106149820"
      orderUrls.push(urlOrderId);
    }
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
    return;
  }

  const result = await response.json();
  const order = result['data']['order'];

  if (order['fulfillmentStatus'] != 'FULFILLED') {
    console.warn(`Order ${urlOrderId} is not fulfilled yet.`);
    return;
  }

  const orderId = order['name'].substring(1); // "#SS-340939" -> "SS-340939"
  const publisher = store;
  const purchaseDate = order['processedAt'];
  const orderEdges = result['data']['order']['fulfillments']['edges'];
  const currentAssets = {};

  for (const edge of orderEdges) {
    for (const item of edge['node']['fulfillmentLineItems']['nodes']) {
      const lineItem = item['lineItem'];

      let url = '', canGetTags = false;
      if (lineItem['sku'] && lineItem['sku'].length > 0) {
        url = `https://www.syntystore.com/products/${lineItem['sku']}`;
        canGetTags = true;
      } else {
        url = `https://www.syntystore.com/search?q=${encodeURIComponent(lineItem['title'])}&options%5Bprefix%5D=last`; // search URL as fallback
      }

      // const tags = canGetTags ? await getTagsFromProductPage(url, accessToken) : null;
      const imgUrl = lineItem['image'] ? lineItem['image']['url'] : '';
      const title = lineItem['name'];
      const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':null, 'tags':null, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
      currentAssets[url] = product;
    }
  }

  const percentDone = Math.round( (pageNumber / totalPages) * 100 );

  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
      percentDone: percentDone,
      assets: currentAssets
  } });

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