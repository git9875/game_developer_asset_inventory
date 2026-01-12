const browserAPI = chrome || browser;
const store = 'Daz3D';
const sleepMilliseconds = 500;
let allowedToParse = false;
const orderUrls = [];
let totalOrders = 0;

const groupTimestamp = createLocalDateISO();
const iterationLimitPerTest = 3;
let totalTestsRun = 0;
let totalTestsPassed = 0;



browserAPI.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    // console.log(`(${store}) Message from the background script:`, request.command);

    if (request.command === "PARSE_GAME_ASSETS") {
        console.log(`(${store}) Start parsing`);
        allowedToParse = true;
        await iterateOrderHistoryPages();

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



async function getProductUrls(productId) {
  const ajaxUrl = 'https://www.daz3d.com/dazApi/slab/' + productId;
  const response = await fetch(ajaxUrl);

  if (!response.ok) {
    console.error(`Daz3D HTTP error! status: ${response.status}, ` + ajaxUrl);
    sendTestResultMessage("getProductUrls(): fetch Product URLs", false, `Failed to fetch product URLs from ${ajaxUrl}. HTTP status: ${response.status}`);
    return null;
  }
  else {
    sendTestResultMessage("getProductUrls(): fetch Product URLs", true, `Successfully fetched product URLs from ${ajaxUrl}`);
  }

  const jsonData = await response.json();

  if (!('url' in jsonData) || !('imageUrl' in jsonData) || !('categoriesData' in jsonData)) {
    sendTestResultMessage("getProductUrls(): validate Product URL JSON data", false, `Invalid product URL JSON data for product ID ${productId}`);
  }
  else {
    sendTestResultMessage("getProductUrls(): validate Product URL JSON data", true, `Valid product URL JSON data for product ID ${productId}`);
  }

  const url = 'https://www.daz3d.com' + jsonData['url'];
  const imgUrl = jsonData['imageUrl'].substring(jsonData['imageUrl'].indexOf('https:'));
  const tags = jsonData['categoriesData'] ? jsonData['categoriesData'].map(cat => cat['category'].toLowerCase()) : null; // it says categoriesData, but it's actually tags

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return [url, imgUrl, tags];
}


async function iterateOrderHistoryPages() {
  let pageQuery = '?limit=10';
  let orderNumber = 1, i = 0;

  // assemble Order Page URLs
  if (orderUrls.length == 0) {
    while (pageQuery) {
      if (!allowedToParse) { break; }
      const apiUrl = 'https://www.daz3d.com/sales/order/history';
      const response = await fetch(apiUrl + pageQuery);

      if (!response.ok) {
        console.error(`(${store}) HTTP error! status: ${response.status}, ` + apiUrl);
        sendTestResultMessage("iterateOrderHistoryPages(): fetch Order History page", false, `Failed to fetch order history from ${apiUrl}. HTTP status: ${response.status}`);
        return null;
      }
      else {
        sendTestResultMessage("iterateOrderHistoryPages(): fetch Order History page", true, `Successfully fetched order history from ${apiUrl}`);
      }

      const htmlString = await response.text();
      const domParser = new DOMParser();
      const doc = domParser.parseFromString(htmlString, 'text/html');
      pageQuery = parseOrderHistory(doc, orderUrls);

      if (totalOrders === 0) {
        totalOrders = parsePagerTotalOrders(doc);
        // console.log(`(${store}) iterateOrderHistoryPages Total orders to process: ${totalOrders}`);
      }

      const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
      await sleepPromise;

      i += 1;
      if (i >= iterationLimitPerTest) {
        break; // limit number of pages parsed for testing
      }
    }
  }


  // recover from stopped parsing
  orderNumber = totalOrders - orderUrls.length + 1;
  // console.log(`(${store}) iterateOrderHistoryPages Resuming from order number: ${orderNumber}`);
  i = 1;
  
  // process each Order Page URL
  while (orderUrls.length > 0) {
    if (!allowedToParse) { break; }
    const orderUrl = orderUrls.shift();
    const response = await fetch(orderUrl);

    if (!response.ok) {
      console.error(`(${store}) HTTP error! status: ${response.status}, ` + orderUrl);
      sendTestResultMessage("iterateOrderHistoryPages(): fetch Order Page", false, `Failed to fetch order page from ${orderUrl}. HTTP status: ${response.status}`);
      return null;
    }
    else {
      sendTestResultMessage("iterateOrderHistoryPages(): fetch Order Page", true, `Successfully fetched order page from ${orderUrl}`);
    }

    const htmlString = await response.text();
    const domParser = new DOMParser();
    const doc = domParser.parseFromString(htmlString, 'text/html');

    const currentAssets = await parseLibraryAssets(doc);
    // console.log(`(${store}) iterateOrderHistoryPages Parsed order ${orderNumber}/${totalOrders}:`, currentAssets);

    orderNumber += 1;
    i += 1;
    if (i >= iterationLimitPerTest) {
      break; // limit number of orders processed for testing
    }
  }
}


function parseOrderHistory(doc, orderUrls) {
  const orderRows = doc.querySelectorAll('#my-orders-table tbody tr');
  if (orderRows.length === 0) {
    sendTestResultMessage("parseOrderHistory(): DOM query order history table rows", false, "No rows found on order history page.");
    return;
  }
  else {
    sendTestResultMessage("parseOrderHistory(): DOM query order history table rows", true, `Found ${orderRows.length} rows on order history page.`);
  }

  let i = 1, singleTestFindOrderUrlLink = true;

  for (const row of orderRows) {
    const cells = row.querySelectorAll('td');
    if (cells.length === 0) {
      sendTestResultMessage("parseOrderHistory(): DOM query table cells", false, "No cells found in order history row.");
      return;
    }
    else {
      sendTestResultMessage("parseOrderHistory(): DOM query table cells", true, `Found ${cells.length} cells in order history row.`);
    }

    const lastCell = cells[ cells.length - 1];
    if (!lastCell.querySelector('a')) {
      sendTestResultMessage("parseOrderHistory(): find order URL link", false, `Missing order URL link in order history row ${i}.`);
      return 0;
    }
    else if (singleTestFindOrderUrlLink) {
      sendTestResultMessage("parseOrderHistory(): find order URL link", true, `Found order URL link in order history row ${i}.`);
      singleTestFindOrderUrlLink = false;
    }

    const url = lastCell.querySelector('a').href;
    orderUrls.push(url);

    if (i >= iterationLimitPerTest) {
      break; // limit number of orders parsed for testing
    }
    i += 1;
  }

  const unFilteredPaginationLinks = doc.querySelectorAll('.pages-list a');
  if (unFilteredPaginationLinks.length == 0) {
    sendTestResultMessage("parseOrderHistory(): DOM query unfiltered pagination links", false, "No pagination links found on order history page.");
    return null;
  }
  else {
    sendTestResultMessage("parseOrderHistory(): DOM query unfiltered pagination links", true, `Found ${unFilteredPaginationLinks.length} pagination links on order history page.`);
  }

  const paginationLinks = Array.from(unFilteredPaginationLinks).filter((a) => !a.classList.contains('next')); // filter out the previous & next links
  const currentPageIdx = paginationLinks.findIndex(a => a.classList.contains('blue')); // current link is colored blue
  if (currentPageIdx == paginationLinks.length-1) {
    return null;
  }
  return paginationLinks[currentPageIdx+1]; // returns pagination link (page query)
}




async function parseLibraryAssets(doc) {
  if (!doc.querySelector("meta[property='og:url']")) {
    sendTestResultMessage("parseLibraryAssets(): find meta og:url", false, `Missing meta og:url in head.`);
    return 0;
  }
  else {
    sendTestResultMessage("parseLibraryAssets(): find meta og:url", true, `Found meta og:url in head.`);
  }
  if (!doc.querySelector(".order-date")) {
    sendTestResultMessage("parseLibraryAssets(): find order date", false, `Missing order date.`);
    return 0;
  }
  else {
    sendTestResultMessage("parseLibraryAssets(): find order date", true, `Found order date.`);
  }

  const ogUrlTagUrl = doc.querySelector("meta[property='og:url']").content; // https://www.daz3d.com/sales/order/view/order_id/ORDER-ID
  const orderId = ogUrlTagUrl.substring( ogUrlTagUrl.lastIndexOf('/')+1 );
  const purchaseDate = doc.querySelector('.order-date').textContent.substring(-10); // Order Date: 2025-12-29

  const productRows = doc.querySelectorAll('#my-orders-table tbody tr');
  if (productRows.length === 0) {
    sendTestResultMessage("parseLibraryAssets(): DOM query order product rows", false, "No rows found.");
    return 0;
  }
  else {
    sendTestResultMessage("parseLibraryAssets(): DOM query order product rows", true, `Found ${productRows.length} rows.`);
  }

  const currentAssets = {};
  let i = 1;

  for (const item of productRows) {
    if (!allowedToParse) { break; }

    const link = item.querySelector('a.product-name');
    if (!link) {
      sendTestResultMessage("parseLibraryAssets(): find product link", false, `Missing product link in order row ${i}.`);
      return 0;
    }
    else {
      sendTestResultMessage("parseLibraryAssets(): find product link", true, `Found product link in order row ${i}.`);
    }

    const productUrl = link.href; // /downloader/customer/files#prod_90569/
    const productId = productUrl.substring(productUrl.lastIndexOf('#')+6, productUrl.length-1);
    const [url, imgUrl, tags] = await getProductUrls(productId);

    // avoid duplicates
    if (url in currentAssets) {
      continue;
    }

    const title = link.textContent;
    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'category':null, 'tags':tags, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[url] = product;

    if (i >= iterationLimitPerTest) {
      break; // limit number of products parsed per order for testing
    }
    i += 1;
  }

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return currentAssets;
}



function parsePagerTotalOrders(doc) {
  if (!doc.querySelector(".pager .amount")) {
    sendTestResultMessage("parsePagerTotalOrders(): find pagination text", false, `Missing pagination text.`);
    return 0;
  }
  else {
    sendTestResultMessage("parsePagerTotalOrders(): find pagination text", true, `Found pagination text.`);
  }

  const pagerText = doc.querySelector('.pager .amount').textContent; // "Items 1 to 10 of 23 total" or "31 Item(s)"
  const pagerTokens = pagerText.split(' ');
  let largestNumber = 0;

  for (const token of pagerTokens) {
    const num = parseInt(token);
    if (!isNaN(num) && num > largestNumber) {
      largestNumber = num;
    }
  }

  if (!largestNumber) {
    sendTestResultMessage("parsePagerTotalOrders(): find largestNumber (total orders)", false, `Missing largest number.`);
    return 0;
  }
  else {
    sendTestResultMessage("parsePagerTotalOrders(): find largestNumber (total orders)", true, `Found largest number: ${largestNumber}.`);
  }

  return largestNumber;
}
