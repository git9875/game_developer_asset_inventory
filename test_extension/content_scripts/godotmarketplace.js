const browserAPI = chrome || browser;
const store = 'Godot Marketplace';
const sleepMilliseconds = 500;
let allowedToParse = false;
const tagFilterList = ['all', 'free', 'fbx', 'jpg', 'adobe', 'illustator', 'general', 'cs', 'graphic', 'and', 'png', 'ai', 'svg', 'coreldraw', 'age', 'cdr', 'eps', 'psd', 'photoshop', 'ui', 'x', 'psds', 'pngs', 'cc', 'item', 'obj', 'blender', 'model', 'art', 'wav', 'massive', 'various', 'game', 'big', 'multi', 'genre', 'audition', 'ogg', 'pro', 'complete', 'minimalist', 'interface', 'top', 'down', 'inkscape', 'super', 'eps', 'volume', 'mtl', 'max', 'tga', 'set', 'zbrush', 'substance', 'unitypackage', 'post', 'painter', 'maya', 'the', 'lsdj', 'sid', 'game'];
let totalDownloads = 0;
let productCount = 0;

const groupTimestamp = createLocalDateISO();
const iterationLimitPerTest = 3;
let totalTestsRun = 0;
let totalTestsPassed = 0;



browserAPI.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    // console.log(`(${store}) Message from the background script:`, request.command);

    if (request.command === "PARSE_GAME_ASSETS") {
        console.log(`(${store}) Start parsing`);
        allowedToParse = true;
        await orderParsing();

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



// https://godotmarketplace.com/my-account/orders/
async function orderParsing() {
  // get all order URLs from the library page
  const orderRows = document.querySelectorAll('.woocommerce-orders-table tbody tr');
  const totalOrders = orderRows.length;
  let currentOrderNum = 1;

  if (orderRows.length === 0) {
    sendTestResultMessage("orderParsing(): find order rows", false, `No order rows found on the orders page.`);
    return;
  }
  else {
    sendTestResultMessage("orderParsing(): find order rows", true, `Found ${orderRows.length} order rows on the orders page.`);
  }

  for (const order of orderRows) {
    if (!allowedToParse) { console.warn(`(${store}) Stopping parsing as per request.`); break; }
    const orderIdElem = order.querySelector('th a');
    if (!orderIdElem) {
      sendTestResultMessage("orderParsing(): find order ID", false, `Order row missing ID element.`);
      continue;
    }
    else if (currentOrderNum < iterationLimitPerTest+1) {
      sendTestResultMessage("orderParsing(): find order ID", true, `Order row contains ID element.`);
    }

    const orderId = orderIdElem.textContent.trim().replace('#', '');
    const orderUrl = orderIdElem.href;

    const orderDateElem = order.querySelector('td.woocommerce-orders-table__cell-order-date');
    if (!orderDateElem) {
      sendTestResultMessage("orderParsing(): find order date", false, `Order row missing order date element in row ${currentOrderNum}.`);
      continue;
    }
    else if (currentOrderNum < iterationLimitPerTest+1) {
      sendTestResultMessage("orderParsing(): find order date", true, `Order row contains order date element in row ${currentOrderNum}.`);
    }
    const orderDate = orderDateElem.textContent.trim();
    
    if (currentOrderNum < iterationLimitPerTest+1) {
      await parseOrderPage(orderUrl, orderId, orderDate, currentOrderNum, totalOrders);
    }
    currentOrderNum += 1;
  }

  console.log(`(${store}) Parsing complete. Total downloads: ${totalDownloads}`);
}


async function parseOrderPage(orderUrl, orderId, orderDate, currentOrderNum, totalOrders) {
  const response = await fetch(orderUrl, {
    method: 'GET',
    headers: {
      'Accept': 'text/html',
    }
  });

  if (response.status !== 200) {
    console.warn(`Failed to fetch order page: ${orderUrl}, status code: ${response.status}`);
    sendTestResultMessage("parseOrderPage(): fetch order page", false, `Failed to fetch order page from ${orderUrl} . HTTP status: ${response.status}`);
    return null;
  }
  else {
    sendTestResultMessage("parseOrderPage(): fetch order page", true, `Successfully fetched order page from ${orderUrl}`);
  }

  const pageText = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(pageText, 'text/html');

  // get all product URLs from the library page
  const productRows = (doc.querySelectorAll('.woocommerce-order-downloads table tbody tr'));
  totalDownloads += productRows.length;
  const currentAssets = {};
  let i = 1;

  if (productRows.length === 0) {
    sendTestResultMessage("parseOrderPage(): find product rows", false, `No product rows found on the orders page.`);
    return;
  }
  else {
    sendTestResultMessage("parseOrderPage(): find product rows", true, `Found ${productRows.length} product rows on the orders page.`);
  }
  if (totalDownloads === 0) {
    sendTestResultMessage("parseOrderPage(): get total download number", false, `No downloads forms were found on the orders page.`);
    return;
  }
  else {
    sendTestResultMessage("parseOrderPage(): get total download number", true, `Found ${totalDownloads} download forms on the orders page.`);
  }

  for (const productRow of productRows) {
    if (!allowedToParse) { break; }
    const productDetailsElem = productRow.querySelector('td.download-product a');
    if (!productDetailsElem) {
      sendTestResultMessage("parseOrderPage(): find product details link", false, `Order row missing product details link element.`);
      continue;
    }
    else if (i < iterationLimitPerTest+1) {
      sendTestResultMessage("parseOrderPage(): find product details link", true, `Order row contains product details link element.`);
    }

    const productDetailsUrl = productDetailsElem.href;
    const { title, publisher, category, tags, imgUrl } = (i < iterationLimitPerTest) ? await parseProductPage(productDetailsUrl) : { title:null, publisher:null, category:null, tags:null, imgUrl: null };
    const product = {'url':productDetailsUrl, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':tags, 'orderId':orderId, 'purchaseDate':orderDate, 'assetStore':store};
    currentAssets[productDetailsUrl] = product;
    i += 1;
  }
}


async function parseProductPage(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'text/html',
    }
  });

  if (response.status !== 200) {
    console.warn(`Failed to fetch product page: ${url}, status code: ${response.status}`);
    sendTestResultMessage("parseProductPage(): fetch product page", false, `Failed to fetch product page from ${url} . HTTP status: ${response.status}`);
    return null;
  }
  else {
    sendTestResultMessage("parseProductPage(): fetch product page", true, `Successfully fetched product page from ${url}`);
  }

  const pageText = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(pageText, 'text/html');

  if (!doc.querySelector('h1.product_title')) {
    sendTestResultMessage("parseProductPage(): find title", false, `Product details missing title.`);
  }
  else {
    sendTestResultMessage("parseProductPage(): find title", true, `Product details contains title.`);
  }
  const title = doc.querySelector('h1.product_title').textContent.trim();

  // const description = doc.querySelector('.woocommerce-Tabs-panel--description').textContent.trim();

  if (doc.querySelectorAll('nav.woocommerce-breadcrumb a').length === 0) {
    sendTestResultMessage("parseProductPage(): find breadcrumb links", false, `No breadcrumb links found in the order.`);
    return;
  }
  else {
    sendTestResultMessage("parseProductPage(): find breadcrumb links", true, `Found breadcrumb links in the order.`);
  }
  const category = Array.from(doc.querySelectorAll('nav.woocommerce-breadcrumb a')).map(crumb => crumb.textContent.trim()).join(' > ').replace('Home > Shop > ', '');

  if (!doc.querySelector('.vendor_store_details_title h5 a')) {
    sendTestResultMessage("parseProductPage(): find publisher", false, `Product details missing publisher.`);
  }
  else {
    sendTestResultMessage("parseProductPage(): find publisher", true, `Product details contains publisher.`);
  }
  const publisher = doc.querySelector('.vendor_store_details_title h5 a').textContent.trim();

  const tagItems = doc.querySelectorAll('.product_meta .posted_in a');
  const tags = [];
  if (tagItems.length === 0) {
    sendTestResultMessage("parseProductPage(): find tags", false, `No tags found on the product details page.`);
    return;
  }
  else {
    sendTestResultMessage("parseProductPage(): find tags", true, `Found ${tagItems.length} tags on the product details page.`);
  }

  for (const tagItem of tagItems) {
    const tag = tagItem.textContent.trim().toLowerCase();
    if (tag && tag.length > 1 && !tagFilterList.includes(tag)) {
        tags.push(tag);
    }
  }

  const thumbnailSrcElem = doc.querySelector('.woocommerce-product-gallery__wrapper div');
  if (!thumbnailSrcElem) {
    sendTestResultMessage("parseProductPage(): find thumbnail", false, `Product details missing thumbnail.`);
  }
  else {
    sendTestResultMessage("parseProductPage(): find thumbnail", true, `Product details contains thumbnail.`);
  }

  let imgUrl = thumbnailSrcElem.getAttribute('data-thumb');
  const img300Srcset = thumbnailSrcElem.getAttribute('data-thumb-srcset').split(', ').filter(src => src.endsWith(' 300w'))[0];
  if (img300Srcset) {
    imgUrl = img300Srcset.split(' ')[0];
  }
  if (!imgUrl) {
    sendTestResultMessage("parseProductPage(): parse imgUrl", false, `Missing thumbnail URL.`);
  }
  else {
    sendTestResultMessage("parseProductPage(): parse imgUrl", true, `Parsed thumbnail URL.`);
  }

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return { title, publisher, category, tags, imgUrl };
}
