const browserAPI = chrome || browser;
const store = 'Itch.io';
let allowedToParse = false;
const sleepMilliseconds = 2000;

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


// https://itch.io/my-collections
async function mainParsing() {
  const orderId = '';
  const itemDivs = document.querySelectorAll('section.game_collection .game_list .game_cell');
  const currentAssets = {};
  let i = 1;

  if (itemDivs.length == 0) {
    sendTestResultMessage("mainParsing(): validate presence of asset items", false, `No asset items found on page.`);
    return;
  } else {
    sendTestResultMessage("mainParsing(): validate presence of asset items", true, `Found ${itemDivs.length} asset items on page.`);
  }

  for (const item of itemDivs) {
    const aElement = item.querySelector('a');
    if (! aElement) {
      console.warn('missing a href for item: ', item);
      sendTestResultMessage("mainParsing(): validate asset item link", false, `No link found for asset row ${i}.`);
      return;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("mainParsing(): validate asset item link", true, `Link found for asset row ${i}.`);
    }

    const url = item.querySelector('a').href;
    const imgElement = item.querySelector('.game_thumb img');
    if (! imgElement) {
      console.warn('missing image src for item: ', url, item);
      sendTestResultMessage("mainParsing(): validate asset item image", false, `No image found for asset row ${i}.`);
      return;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("mainParsing(): validate asset item image", true, `Image found for asset row ${i}.`);
    }

    const imgUrl = imgElement ? imgElement.dataset.lazy_src : null;
    const titleDiv = item.querySelector('.game_title a.title');

    if (! titleDiv) {
      console.warn('missing title div for item, could be a bundle instead of a singular item', item);
      sendTestResultMessage("mainParsing(): validate asset item title", false, `No title found for asset row ${i}.`);
      continue;
    }
    const title = titleDiv.textContent.trim();
    const publisher = item.querySelector('.game_author a').textContent.trim();
    const purchaseDate = '';
    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':null, 'tags':null, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[url] = product;

    i += 1;
    if (i > iterationLimitPerTest) {
      break; // limit number of products parsed for testing
    }
  }

}

