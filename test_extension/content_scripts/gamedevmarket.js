const browserAPI = chrome || browser;
const store = 'GameDev Market';
const sleepMilliseconds = 500;
let allowedToParse = false;
const tagFilterList = ['fbx', 'jpg', 'adobe', 'illustator', 'general', 'cs', 'graphic', 'and', 'png', 'ai', 'svg', 'coreldraw', 'age', 'cdr', 'eps', 'psd', 'photoshop', 'ui', 'x', 'psds', 'pngs', 'cc', 'item', 'obj', 'blender', 'model', 'art', 'wav', 'massive', 'various', 'game', 'big', 'multi', 'genre', 'audition', 'ogg', 'pro', 'complete', 'minimalist', 'interface', 'top', 'down', 'inkscape', 'super', 'eps', 'volume', 'mtl', 'max', 'tga', 'set', 'zbrush', 'substance', 'unitypackage', 'post', 'painter', 'maya', 'the', 'lsdj', 'sid', 'game'];
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
        await externalPurchasesParsing();

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



// https://www.gamedevmarket.net/user/orders
async function orderParsing() {
  // get all order URLs from the library page
  const orderRows = document.querySelectorAll('div.w-full.border-1.border-gray-300.px-4.py-2.my-2:not(.flex)');
  totalDownloads += document.querySelectorAll('form[action="/user/products/download"]').length;
  if (orderRows.length === 0) {
    sendTestResultMessage("orderParsing(): find order rows", false, `No order rows found on the orders page.`);
    return;
  }
  else {
    sendTestResultMessage("orderParsing(): find order rows", true, `Found ${orderRows.length} order rows on the orders page.`);
  }
  if (totalDownloads === 0) {
    sendTestResultMessage("orderParsing(): get total download number", false, `No downloads forms were found on the orders page.`);
    return;
  }
  else {
    sendTestResultMessage("orderParsing(): get total download number", true, `Found ${totalDownloads} download forms on the orders page.`);
  }

  let i = 1;

  for (const order of orderRows) {
    if (!allowedToParse) { break; }
    const orderIdElem = order.querySelector('h1');
    if (!orderIdElem) {
      sendTestResultMessage("orderParsing(): find order ID", false, `Order row missing ID element.`);
      continue;
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("orderParsing(): find order ID", true, `Order row contains ID element.`);
    }

    const orderIdText = orderIdElem.textContent.trim();
    const orderId = orderIdText.split('#')[1].trim();
    const productRows = order.querySelectorAll('div.w-full.border-1.border-gray-300.px-4.py-2.my-2');
    const currentAssets = {};
    if (productRows.length === 0) {
      sendTestResultMessage("orderParsing(): find product rows", false, `No product rows found in the order, row ${i}.`);
      return;
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("orderParsing(): find product rows", true, `Found ${productRows.length} product rows in the order, row ${i}.`);
    }

    let j = 1;

    for (const item of productRows) {
      if (!allowedToParse) { break; }
      if (!item.querySelector('img')) {
        sendTestResultMessage("orderParsing(): find product image", false, `Product row missing image element in row ${i}, ${j}.`);
        continue;
      }
      else if (j < iterationLimitPerTest) {
        sendTestResultMessage("orderParsing(): find product image", true, `Product row contains image element in row ${i}, ${j}.`);
      }

      const imgUrl = item.querySelector('img').src;
      const titleLink = item.querySelector('div.w-full:nth-of-type(2) a');
      if (!titleLink) {
        sendTestResultMessage("orderParsing(): find product link", false, `Product row missing link element in row ${i}, ${j}.`);
        continue;
      }
      else if (j < iterationLimitPerTest) {
        sendTestResultMessage("orderParsing(): find product link", true, `Product row contains link element in row ${i}, ${j}.`);
      }

      const title = titleLink.textContent.trim();
      const url = titleLink.href;
      const { publisher, category, tags } = (j < iterationLimitPerTest) ? await parseProductPage(url) : { publisher: null, category: null, tags: null };
      const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':tags, 'orderId':orderId, 'purchaseDate':null, 'assetStore':store};
      currentAssets[url] = product;
      productCount += 1;
      j += 1;
    }

    i += 1;
  }
}


async function externalPurchasesParsing() {
  const externalPurchasesUrl = 'https://www.gamedevmarket.net/user/external/purchases';
  const response = await fetch(externalPurchasesUrl, {
    method: 'GET',
    headers: {
      'Accept': 'text/html',
    }
  });

  if (response.status !== 200) {
    console.warn(`Failed to fetch product page: ${url}, status code: ${response.status}`);
    return null;
  }

  const pageText = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(pageText, 'text/html');

  // get all order URLs from the library page
  const orderRows = doc.querySelectorAll('div.bg-gradient-to-r + div.container > div.w-full');
  totalDownloads += doc.querySelectorAll('form[action="/user/products/download"]').length;
  const orderId = null;
  if (orderRows.length === 0) {
    sendTestResultMessage("externalPurchasesParsing(): find order rows", false, `No order rows found on the orders page.`);
    return;
  }
  else {
    sendTestResultMessage("externalPurchasesParsing(): find order rows", true, `Found ${orderRows.length} order rows on the orders page.`);
  }
  if (totalDownloads === 0) {
    sendTestResultMessage("externalPurchasesParsing(): get total download number", false, `No downloads forms were found on the orders page.`);
    return;
  }
  else {
    sendTestResultMessage("externalPurchasesParsing(): get total download number", true, `Found ${totalDownloads} download forms on the orders page.`);
  }

  let i = 1;

  for (const order of orderRows) {
    if (!allowedToParse) { break; }
    const productRows = order.querySelectorAll('div.flex.border-1');
    const currentAssets = {};
    if (productRows.length === 0) {
      sendTestResultMessage("externalPurchasesParsing(): find product rows", false, `No product rows found in the order, row ${i}.`);
      return;
    }
    else if (i < iterationLimitPerTest) {
      sendTestResultMessage("externalPurchasesParsing(): find product rows", true, `Found ${productRows.length} product rows in the order, row ${i}.`);
    }

    let j = 1;

    for (const item of productRows) {
      if (!allowedToParse) { break; }
      if (!item.querySelector('img')) {
        sendTestResultMessage("externalPurchasesParsing(): find product image", false, `Product row missing image element in row ${i}, ${j}.`);
        continue;
      }
      else if (j < iterationLimitPerTest) {
        sendTestResultMessage("externalPurchasesParsing(): find product image", true, `Product row contains image element in row ${i}, ${j}.`);
      }

      const imgUrl = item.querySelector('img').src;
      const titleLink = item.querySelector('div.w-full:nth-of-type(2) a');
      if (!titleLink) {
        sendTestResultMessage("externalPurchasesParsing(): find product link", false, `Product row missing link element in row ${i}, ${j}.`);
        continue;
      }
      else if (j < iterationLimitPerTest) {
        sendTestResultMessage("externalPurchasesParsing(): find product link", true, `Product row contains link element in row ${i}, ${j}.`);
      }

      const title = titleLink.textContent.trim();
      const url = titleLink.href;
      const { publisher, category, tags } = (j < iterationLimitPerTest) ? await parseProductPage(url) : { publisher: null, category: null, tags: null };
      const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':tags, 'orderId':orderId, 'purchaseDate':null, 'assetStore':store};
      currentAssets[url] = product;
      productCount += 1;
      j += 1;
    }
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
      sendTestResultMessage("parseProductPage(): fetch product details page", false, `Failed to fetch product from ${url} . HTTP status: ${response.status}`);
      return null;
    }
    else {
      sendTestResultMessage("parseProductPage(): fetch product details page", true, `Successfully fetched product from ${url} . HTTP status: ${response.status}`);
    }

  const pageText = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(pageText, 'text/html');

  if (!doc.querySelector('header.main-nav + script + div')) {
    sendTestResultMessage("parseProductPage(): find breadcrumbs category", false, `Product row missing breadcrumbs category.`);
  }
  else {
    sendTestResultMessage("parseProductPage(): find breadcrumbs category", true, `Product row contains breadcrumbs category.`);
  }
  if (!doc.querySelector('form[action="/user/follow"] input[name="username"]')) {
    sendTestResultMessage("parseProductPage(): find publisher", false, `Product row missing publisher.`);
  }
  else {
    sendTestResultMessage("parseProductPage(): find publisher", true, `Product row contains publisher.`);
  }


  const category = doc.querySelector('header.main-nav + script + div').textContent.trim();
  const publisher = doc.querySelector('form[action="/user/follow"] input[name="username"]').value;
  const tagItems = doc.querySelectorAll('div.product-tags li');
  const tags = [];
  if (tagItems.length === 0) {
    sendTestResultMessage("parseProductPage(): find tags", false, `No tags found on the product page.`);
    return;
  }
  else {
    sendTestResultMessage("parseProductPage(): find tags", true, `Found ${tagItems.length} tags on the product page.`);
  }

  for (const tagItem of tagItems) {
    const tag = tagItem.textContent.trim().toLowerCase();
    if (tag && tag.length > 1 && !tagFilterList.includes(tag)) {
        tags.push(tag);
    }
  }

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return { publisher, category, tags };
}
