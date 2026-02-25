const browserAPI = chrome || browser;
const store = 'Daz3D';
const sleepMilliseconds = 500;
let allowedToParse = false;
const orderUrls = [];
let totalOrders = 0;


browserAPI.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    // console.log(`(${store}) Message from the background script:`, request.command);

    if (request.command === "PARSE_GAME_ASSETS") {
        console.log(`(${store}) Start parsing`);
        allowedToParse = true;
        iterateOrderHistoryPages();
    }
    else if (request.command === "STOP_PARSING") {
        console.log(`(${store}) Stopping parsing as per request.`);
        allowedToParse = false;
    }
});


async function getProductUrls(productId) {
  const ajaxUrl = 'https://www.daz3d.com/dazApi/slab/' + productId;
  const response = await fetch(ajaxUrl);

  if (!response.ok) {
    console.error(`Daz3D HTTP error! status: ${response.status}, ` + ajaxUrl);
    return null;
  }

  const jsonData = await response.json();
  const url = 'https://www.daz3d.com' + jsonData['url'];
  const imgUrl = jsonData['imageUrl'].substring(jsonData['imageUrl'].indexOf('https:'));
  const tags = jsonData['categoriesData'] ? jsonData['categoriesData'].map(cat => cat['category'].toLowerCase()) : null; // it says categoriesData, but it's actually tags

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return [url, imgUrl, tags];
}


async function iterateOrderHistoryPages() {
  let pageQuery = '?limit=10';
  let apiUrl = 'https://www.daz3d.com/sales/order/history' + pageQuery;
  let orderNumber = 1;

  // assemble Order Page URLs
  if (orderUrls.length == 0) {
    while (apiUrl) {
      if (!allowedToParse) { break; }
      const response = await fetch(apiUrl);

      if (!response.ok) {
        console.error(`(${store}) Daz3D HTTP error! status: ${response.status}, ` + apiUrl);
        return null;
      }

      const htmlString = await response.text();
      const domParser = new DOMParser();
      const doc = domParser.parseFromString(htmlString, 'text/html');
      apiUrl = parseOrderHistory(doc, orderUrls);

      if (totalOrders === 0) {
        totalOrders = parsePagerTotalOrders(doc);
        // console.log(`(${store}) iterateOrderHistoryPages Total orders to process: ${totalOrders}`);
      }

      const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
      await sleepPromise;
    }
  }


  // recover from stopped parsing
  orderNumber = totalOrders - orderUrls.length + 1;
  // console.log(`(${store}) iterateOrderHistoryPages Resuming from order number: ${orderNumber}`);
  
  // process each Order Page URL
  while (orderUrls.length > 0) {
    if (!allowedToParse) { break; }
    const orderUrl = orderUrls.shift();
    const response = await fetch(orderUrl);

    if (!response.ok) {
      console.error(`Daz3D HTTP error! status: ${response.status}, ` + orderUrl);
      return null;
    }

    const htmlString = await response.text();
    const domParser = new DOMParser();
    const doc = domParser.parseFromString(htmlString, 'text/html');

    const currentAssets = await parseLibraryAssets(doc);
    // console.log(`(${store}) iterateOrderHistoryPages Parsed order ${orderNumber}/${totalOrders}:`, currentAssets);
    let percentDone = Math.min( Math.round( (orderNumber / totalOrders) * 100 ), 99 );
    if (orderNumber === totalOrders) {
      percentDone = 100;
    }

    browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
        percentDone: percentDone,
        assets: currentAssets
    } });

    orderNumber += 1;
  }

  browserAPI.runtime.sendMessage({ source:"CONTENT", action:"SENDING_CONTENT", data: {
      percentDone: 100,
      assets: {}
  } });
}


function parseOrderHistory(doc, orderUrls) {
  const orderRows = doc.querySelectorAll('#my-orders-table tbody tr');

  for (const row of orderRows) {
    const cells = row.querySelectorAll('td');
    const lastCell = cells[ cells.length - 1];
    const url = lastCell.querySelector('a').href;
    orderUrls.push(url);
  }

  const unFilteredPaginationLinks = doc.querySelectorAll('#my-orders-table + .pager .pages-list a'); // pagination after the orders table
  if (unFilteredPaginationLinks.length == 0) {
    return null;
  }

  const paginationLinks = Array.from(unFilteredPaginationLinks).filter((a) => !a.classList.contains('next')); // filter out the previous & next links
  const currentPageIdx = paginationLinks.findIndex(a => a.classList.contains('blue')); // current link is colored blue
  if (currentPageIdx == paginationLinks.length-1) {
    return null;
  }
  return paginationLinks[currentPageIdx+1]; // returns pagination link (page query)
}




async function parseLibraryAssets(doc) {
  const ogUrlTagUrl = doc.querySelector("meta[property='og:url']").content; // https://www.daz3d.com/sales/order/view/order_id/ORDER-ID
  const orderId = ogUrlTagUrl.substring( ogUrlTagUrl.lastIndexOf('/')+1 );
  const purchaseDate = doc.querySelector('.order-date').textContent.substring(-10); // Order Date: 2025-12-29

  const productRows = doc.querySelectorAll('#my-orders-table tbody tr');
  const currentAssets = {};

  for (const item of productRows) {
    if (!allowedToParse) { break; }
    const link = item.querySelector('a.product-name');
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
  }

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
  return currentAssets;
}



function parsePagerTotalOrders(doc) {
  const pagerText = doc.querySelector('.pager .amount').textContent; // "Items 1 to 10 of 23 total" or "31 Item(s)"
  const pagerTokens = pagerText.split(' ');
  let largestNumber = 0;

  for (const token of pagerTokens) {
    const num = parseInt(token);
    if (!isNaN(num) && num > largestNumber) {
      largestNumber = num;
    }
  }

  return largestNumber;
}
