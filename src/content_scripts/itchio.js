const browserAPI = chrome || browser;
const store = 'Itch.io';
let allowedToParse = false;
const sleepMilliseconds = 2000;


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


// https://itch.io/my-collections
async function mainParsing() {
  const orderId = '';
  const itemDivs = document.querySelectorAll('section.game_collection .game_list .game_cell');
  const currentAssets = {};

  for (const item of itemDivs) {
    if (! item.id) {
      continue;
    }

    const aElement = item.querySelector('a');
    if (! aElement) {
      console.warn('missing a href for item: ', item);
      return;
    }

    const url = item.querySelector('a').href;
    const imgElement = item.querySelector('.game_thumb img');
    if (! imgElement) {
      console.warn('missing image src for item: ', url, item);
      return;
    }

    const imgUrl = imgElement ? imgElement.dataset.lazy_src : null;
    const titleDiv = item.querySelector('.game_title a.title');
    const title = titleDiv ? titleDiv.textContent.trim() : '';
    const publisher = item.querySelector('.game_author a').textContent.trim();
    const purchaseDate = '';
    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':null, 'tags':null, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[url] = product;
  }

  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
      percentDone: 100,
      assets: currentAssets
  } });
}
