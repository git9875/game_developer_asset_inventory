const browserAPI = chrome || browser;
const store = 'RenderHub';
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


// used for dividing up send message batches
const chunkArray = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, index) =>
    arr.slice(index * size, index * size + size)
  );


async function mainParsing() {
  const orderId = '';
  const itemDivs = document.querySelectorAll('div.itemBox > div');
  const currentAssets = {};
  let i = 1;

  if (itemDivs.length == 0) {
    sendTestResultMessage("mainParsing(): validate presence of asset items", false, `No asset items found on page.`);
    return;
  } else {
    sendTestResultMessage("mainParsing(): validate presence of asset items", true, `Found ${itemDivs.length} asset items on page.`);
  }

  for (const item of itemDivs) {
    if (! item.id) {
      continue;
    }

    const aElement = item.querySelector('a');
    if (! aElement) {
      console.warn('missing a href for item: ', item);
      sendTestResultMessage("mainParsing(): validate asset item link", false, `No link found for asset item id ${item.id}, row ${i}.`);
      return;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("mainParsing(): validate asset item link", true, `Link found for asset item id ${item.id}, row ${i}.`);
    }

    const url = item.querySelector('a').href;
    const imgElement = item.querySelector('img');
    if (! imgElement) {
      console.warn('missing image src for item: ', url, item);
      sendTestResultMessage("mainParsing(): validate asset item image", false, `No image found for asset item id ${item.id}, row ${i}.`);
      return;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("mainParsing(): validate asset item image", true, `Image found for asset item id ${item.id}, row ${i}.`);
    }

    const imgUrl = imgElement ? imgElement.src : null;
    const firstChildDiv = item.querySelector('div');

    if (! firstChildDiv) {
      console.warn('missing first child div for item: ', item);
      sendTestResultMessage("mainParsing(): validate asset item title firstChildDiv", false, `No title wrapper found for asset item id ${item.id}, row ${i}.`);
      return;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("mainParsing(): validate asset item title firstChildDiv", true, `Title wrapper found for asset item id ${item.id}, row ${i}.`);
    }

    const titleDiv = firstChildDiv.querySelector('div');

    if (! titleDiv) {
      console.warn('missing title div for item, could be a bundle instead of a singular item', item);
      // sendTestResultMessage("mainParsing(): validate asset item title", false, `No title found for asset item id ${item.id}, row ${i}.`);

      if (item.childNodes.length < 2) {
        sendTestResultMessage("mainParsing(): validate bundle contents", false, `No bundle contents found for asset item id ${item.id}, row ${i}.`);
        continue;
      }
      else if (i <= iterationLimitPerTest) {
        sendTestResultMessage("mainParsing(): validate bundle contents", true, `Bundle contents found for asset item id ${item.id}, row ${i}.`);
      }

      const subItems = Array.from(item.childNodes).slice(1); // skip first child div
      let j = 1;

      for (const subItem of subItems) {
        const subItemLink = subItem.querySelector('a');
        if (! subItemLink) {
          console.warn('missing link for subItem, could be a bundle instead of a singular item', subItem);
          continue;
        }

        if (! subItem.querySelector('img')) {
          console.warn('missing image for subItem, could be a bundle instead of a singular item', subItem);
          continue;
        }
        else if (j <= iterationLimitPerTest) {
          sendTestResultMessage("mainParsing(): validate bundle sub-item image", true, `Image found for bundle sub-item under asset item id ${item.id}, row ${i}.`);
        }

        const subItemUrl = subItemLink.href;
        const subItemImgUrl = subItem.querySelector('img').src;
        const subFirstItem = subItem.querySelector('div');

        if (! subFirstItem) {
          sendTestResultMessage("mainParsing(): validate bundle sub-item title firstChildDiv", false, `No title wrapper found for bundle sub-item under asset item id ${item.id}, row ${i}.`);
          continue;
        }
        else if (j <= iterationLimitPerTest) {
          sendTestResultMessage("mainParsing(): validate bundle sub-item title firstChildDiv", true, `Title wrapper found for bundle sub-item under asset item id ${item.id}, row ${i}.`);
        }

        const subItemTitle = subFirstItem.querySelector('div').textContent;

        if (! subFirstItem.querySelector('span a')) {
          sendTestResultMessage("mainParsing(): validate bundle sub-item publisher", false, `No publisher found for bundle sub-item under asset item id ${item.id}, row ${i}.`);
          continue;
        }
        else if (j <= iterationLimitPerTest) {
          sendTestResultMessage("mainParsing(): validate bundle sub-item publisher", true, `Publisher found for bundle sub-item under asset item id ${item.id}, row ${i}.`);
        }

        const publisher = subFirstItem.querySelector('span a').textContent;
        const purchaseDate = '';
        const product = {'url':subItemUrl, 'imgUrl':subItemImgUrl, 'title':subItemTitle, 'publisher':publisher, 'category':null, 'tags':null, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
        currentAssets[subItemUrl] = product;

        j += 1;
      }

      continue;
    }

    if (! firstChildDiv.querySelector('span a')) {
      sendTestResultMessage("mainParsing(): validate asset item publisher", false, `No publisher found for asset item id ${item.id}, row ${i}.`);
      return;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("mainParsing(): validate asset item publisher", true, `Publisher found for asset item id ${item.id}, row ${i}.`);
    }

    const title = firstChildDiv.querySelector('div').textContent;

    if (! firstChildDiv.querySelector('span a')) {
      sendTestResultMessage("mainParsing(): validate asset item publisher", false, `No publisher found for asset item id ${item.id}, row ${i}.`);
      return;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("mainParsing(): validate asset item publisher", true, `Publisher found for asset item id ${item.id}, row ${i}.`);
    }

    const publisher = firstChildDiv.querySelector('span a').textContent;
    const purchaseDate = '';
    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':null, 'tags':null, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[url] = product;

    i += 1;
    if (i > iterationLimitPerTest) {
      break; // limit number of products parsed for testing
    }
  }

  await chunkFillTaxonomyAndSend(currentAssets);
}


// process in chunks to send message content updates intermittently
async function chunkFillTaxonomyAndSend(currentAssets) {
  const allUrls = Object.keys(currentAssets);
  const urlChunks = chunkArray(allUrls, 10); // process 10 at a time

  for (let i = 0; i < urlChunks.length; i++) {
    if (! allowedToParse) {
      // console.log(`(${store}) Parsing stopped as per request.`);
      return;
    }

    const chunk = urlChunks[i];
    // console.log(`(${store}) Processing chunk ${i+1} of ${urlChunks.length} with ${chunk.length} items.`);
    const chunkAssets = {};

    for (let i = 0; i < chunk.length && i < iterationLimitPerTest; i++) {
      const url = chunk[i];
      const result = await parseProductPageTaxonomy(url);
      const [category, tags] = result;
      currentAssets[url].category = category;
      currentAssets[url].tags = tags;
      chunkAssets[url] = currentAssets[url];
    }

  }
}


async function parseProductPageTaxonomy(url) {
  const response = await fetch(url);

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status} for URL: ${url}`);
    sendTestResultMessage("parseProductPageTaxonomy(): fetch product page", false, `Failed to fetch product page ${url} . HTTP status: ${response.status}`);
    return [null, null];
  }
  else {
    sendTestResultMessage("parseProductPageTaxonomy(): fetch product page", true, `Successfully fetched product page ${url} . HTTP status: ${response.status}`);
  }

  const pageText = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(pageText, 'text/html');

  const categoryElements = doc.getElementsByClassName('tagLink');

  if (!categoryElements || categoryElements.length == 0) {
    sendTestResultMessage("parseProductPageTaxonomy(): validate category and tags", false, `No category or tags found on product page ${url}`);
    return [null, null];
  }
  else {
    sendTestResultMessage("parseProductPageTaxonomy(): validate category and tags", true, `Found ${categoryElements.length} category/tag elements on product page ${url}`);
  }

  const categories = Array.from(categoryElements)
    .filter(el => el.parentElement.attributes.length==0)
    .map(el => el.textContent.trim());

  const tags = Array.from(categoryElements)
    .filter(el => el.parentElement.attributes.length>0) // this div includes style attribute
    .map(el => el.textContent.trim());

  const category = categories.join(' / ');

  if (categories.length == 0) {
    sendTestResultMessage("parseProductPageTaxonomy(): validate category", false, `No category found on product page ${url}`);
  }
  else if (categories.length > 0 && categories[0]) {
    sendTestResultMessage("parseProductPageTaxonomy(): validate category", true, `Category found on product page ${url}: ${categories[0]}`);
  }

  if (tags.length == 0) {
    // sendTestResultMessage("parseProductPageTaxonomy(): validate tags", false, `No tags found on product page ${url}.`);
    console.warn(`${store} No tags found on product page ${url}`);
  }
  else {
    sendTestResultMessage("parseProductPageTaxonomy(): validate tags", true, `Found ${tags.length} tags on product page ${url}`);
  }

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return [category, tags];
}