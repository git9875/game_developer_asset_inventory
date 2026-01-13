const browserAPI = chrome || browser;
const store = 'KitBash3d';
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


// https://cargo-app.kitbash3d.com/account/my-assets
async function mainParsing() {
  const bodyHTML = document.body.innerHTML;
  const purchaseProductsStartIdx = bodyHTML.indexOf('purchasedProducts') + 20;
  const purchaseProductsEndIdx = bodyHTML.indexOf('"cargoKits', purchaseProductsStartIdx) - 2;

  if (purchaseProductsStartIdx === -1 || purchaseProductsEndIdx === -1) {
    sendTestResultMessage("mainParsing(): locate purchased products data", false, `Could not find purchased products data on the page.`);
    return;
  } else {
    sendTestResultMessage("mainParsing(): locate purchased products data", true, `Purchased products data found on the page.`);
  }


  const purchaseProductsStr = bodyHTML.substring(purchaseProductsStartIdx, purchaseProductsEndIdx).replaceAll('\\"', '"').replaceAll('\\\\', '\\');
  const purchaseProductsJson = JSON.parse(purchaseProductsStr);
  const currentAssets = {};
  let i = 1;

  if (purchaseProductsJson.length === 0) {
    sendTestResultMessage("mainParsing(): validate purchased products data", false, `No purchased products found in the data.`);
    return;
  } else {
    sendTestResultMessage("mainParsing(): validate purchased products data", true, `Found ${purchaseProductsJson.length} purchased products in the data.`);
  }

  for (const item of purchaseProductsJson) {
    if (!('id' in item) || !('title' in item) || !('handle' in item) || !('images' in item) || !('genre' in item)) {
      sendTestResultMessage("mainParsing(): validate purchased product item", false, `Invalid purchased product item structure: ${JSON.stringify(item)}`);
      continue;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("mainParsing(): validate purchased product item", true, `Valid purchased product item structure for item ID ${item['id']}, row ${i}.`);
    }

    const id = item['id'];
    const title = item['title'];
    const url = 'https://kitbash3d.com/products/' + item['handle'];
    // const description = item['description'];

    if ((item['images'].length === 0) || !('url' in item['images'][0])) {
      sendTestResultMessage("mainParsing(): validate purchased product image", false, `No images found for purchased product ID ${id}, row ${i}.`);
      continue;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("mainParsing(): validate purchased product image", true, `Image found for purchased product ID ${id}, row ${i}.`);
    }

    const imgUrlFirst = item['images'][0]['url']; // this image is too large, resizing it to a smaller one
    const imgUrl = imgUrlFirst.substring(0, imgUrlFirst.lastIndexOf('.')) + '_300x300' + imgUrlFirst.substring(imgUrlFirst.lastIndexOf('.'));
    const publisher = store;
    const purchaseDate = ''; // not available on this page

    if (!('value' in item['genre'])) {
      sendTestResultMessage("mainParsing(): validate purchased product category", false, `No genre value found for purchased product ID ${id}, row ${i}.`);
      continue;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("mainParsing(): validate purchased product category", true, `Genre value found for purchased product ID ${id}, row ${i}.`);
    }

    const category = item['genre']['value'];
    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':null, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[url] = product;

    i += 1;
  }
}

// TODO: Is there pagination for more orders?