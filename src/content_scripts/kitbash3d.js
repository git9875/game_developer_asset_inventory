const browserAPI = chrome || browser;
const store = 'KitBash3d';
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

// https://cargo-app.kitbash3d.com/account/my-assets
async function mainParsing() {
  const bodyHTML = document.body.innerHTML;
  const purchaseProductsStartIdx = bodyHTML.indexOf('purchasedProducts') + 20;
  const purchaseProductsEndIdx = bodyHTML.indexOf('"cargoKits', purchaseProductsStartIdx) - 2;
  const purchaseProductsStr = bodyHTML.substring(purchaseProductsStartIdx, purchaseProductsEndIdx).replaceAll('\\"', '"').replaceAll('\\\\', '\\');
  const purchaseProductsJson = JSON.parse(purchaseProductsStr);
  const currentAssets = {};

  for (const item of purchaseProductsJson) {
    const id = item['id'];
    const title = item['title'];
    const url = 'https://kitbash3d.com/products/' + item['handle'];
    // const description = item['description'];
    const imgUrlFirst = item['images'][0]['url']; // this image is too large, resizing it to a smaller one
    const imgUrl = imgUrlFirst.substring(0, imgUrlFirst.lastIndexOf('.')) + '_300x300' + imgUrlFirst.substring(imgUrlFirst.lastIndexOf('.'));
    const publisher = store;
    const purchaseDate = ''; // not available on this page
    const category = item['genre']['value'];
    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':null, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[url] = product;
  }
  
  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
      percentDone: 100,
      assets: currentAssets
  } });
}

// TODO: Is there pagination for more orders?