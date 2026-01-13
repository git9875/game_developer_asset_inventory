const browserAPI = chrome || browser;
const store = 'TurboSquid';
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



// https://www.turbosquid.com/Order/Index.cfm
async function mainParsing() {
  const orderDivs = document.querySelectorAll('div.ItemContainerBox');

  if (orderDivs.length === 0) {
    sendTestResultMessage("mainParsing(): validate order presence", false, "No orders found on the page.");
    return;
  } else if (orderDivs.length <= iterationLimitPerTest) {
    sendTestResultMessage("mainParsing(): validate order presence", true, `Found ${orderDivs.length} orders on the page.`);
  }

  let orderId = null;
  let purchaseDate = null;
  const currentAssets = {};
  let i = 1;

  for (const order of orderDivs) {
    if (!allowedToParse) { break; }
    const orderNumberTdContainer = order.querySelector('.orderNumberTdContainer');
    if (orderNumberTdContainer && orderNumberTdContainer.querySelector('.orderNo')) {
      orderId = orderNumberTdContainer.querySelector('.orderNo').textContent.substring(7);
      purchaseDate = orderNumberTdContainer.querySelector('.orderItemLabel + span').textContent;
      continue;
    }

    const itemDownloads = order.querySelectorAll('.ItemDownloads');
    if (!itemDownloads) {
      sendTestResultMessage("mainParsing(): validate item downloads presence", false, `No item downloads found in order ${i}.`);
      continue;
    }
    else {
      sendTestResultMessage("mainParsing(): validate item downloads presence", true, `Found item downloads in order ${i}.`);
    }

    let j = 1;

    for (const downloadItem of itemDownloads) {
      const thumbnailLargeDiv = downloadItem.querySelector('.thumbnailLarge');

      if (!thumbnailLargeDiv || !thumbnailLargeDiv.querySelector('a') || !thumbnailLargeDiv.querySelector('img') || !downloadItem.querySelector('.name')) {
        console.warn(`(${store}) Missing elements in download item ${j} of order ${i}.`, downloadItem);
        sendTestResultMessage("mainParsing(): validate download item presence", false, `Missing elements in download item ${j} of order ${i}.`);
        continue;
      }
      else {
        sendTestResultMessage("mainParsing(): validate download item presence", true, `All elements present in download item ${j} of order ${i}.`);
      }

      const url = thumbnailLargeDiv.querySelector('a').href;
      const imgUrl = thumbnailLargeDiv.querySelector('img').src;
      const title = downloadItem.querySelector('.name').textContent;
      const publisher = '';
      const productPageData = await parseProductPage(url);
      const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':productPageData.categoryCombined, 'tags':productPageData.tags, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
      currentAssets[url] = product;
      j += 1;

      if (j > iterationLimitPerTest) {
        break; // limit number of products parsed per order for testing
      }
    }

    i += 1;

    if (i > iterationLimitPerTest) {
      break; // limit number of orders parsed for testing
    }
  }

  // TODO: I don't have enough purchases to enable the pagination links, so there is no HTML code for me to inspect.
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
    sendTestResultMessage("parseProductPage(): fetch product page", false, `Failed to fetch product page: ${url}, status code: ${response.status}`);
    return null;
  }
  else {
    sendTestResultMessage("parseProductPage(): fetch product page", true, `Successfully fetched product page: ${url}`);
  }

  const pageText = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(pageText, 'text/html');

  // Example: extract categories and tags if available
  const categories = [];
  const tags = [];

  // using breadcrumbs for categories instead of Categories because breadcrumb seems more reliable and hierarchical
  const categoryElements = doc.querySelectorAll('#breadcrumb li a');

  if (categoryElements.length === 0) {
    sendTestResultMessage("parseProductPage(): validate category presence", false, `No categories found on product page: ${url}.`);
  } else {
    sendTestResultMessage("parseProductPage(): validate category presence", true, `Found ${categoryElements.length} categories on product page: ${url}.`);
  }

  categoryElements.forEach(elem => {
    const category = elem.textContent.trim().toLocaleLowerCase();
    categories.push(category);
  });

  const tagElements = doc.querySelectorAll('div[data-testid="tag-container"] a');

  if (tagElements.length === 0) {
    sendTestResultMessage("parseProductPage(): validate tag presence", false, `No tags found on product page: ${url}.`);
  } else {
    sendTestResultMessage("parseProductPage(): validate tag presence", true, `Found ${tagElements.length} tags on product page: ${url}.`);
  }

  // the Categories list of tags is like tags and may be a good replacement, but it didn't have a useful DOM query selector for it
  const filterOutTags = ['figure', 'blender', '3ds', 'low', 'high', 'poly', 'skin', 'and', 'chest', 'base', 'shape', 'blendshape', 'mesh', 'blends', 'real', 'time', 'vray', 'unity', 'unreal', '3d', 'c4d', 'model', 'maya', 'max', 'pbr', 'archviz', 'collection', 'render', 'zbrush', 'specification'];
  tagElements.forEach(elem => {
    const tag = elem.textContent.trim().toLocaleLowerCase();
    if (tag && !filterOutTags.includes(tag)) {
      tags.push(tag);
    }
  });

  const categoryCombined = categories.join(' / ');

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return { categoryCombined, tags };
}
