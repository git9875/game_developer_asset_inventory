const browserAPI = chrome || browser;
const store = 'Blender';
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


// https://superhivemarket.com/account/orders
async function mainParsing() {
  const orderRows = document.querySelectorAll('.orders-table tbody tr');
  const totalPages = orderRows.length;
  let pageNum = 1;

  if (totalPages === 0) {
    sendTestResultMessage("mainParsing(): validate order rows presence", false, `No order rows found on orders page.`);
    return;
  } else {
    sendTestResultMessage("mainParsing(): validate order rows presence", true, `Found ${totalPages} order rows on orders page.`);
  }

  for (const orderRow of orderRows) {
    if (!allowedToParse) { break; }
    const link = orderRow.querySelector('td:nth-child(5) a');

    if (!link) {
      sendTestResultMessage("mainParsing(): validate order download link presence", false, `No download link found in order row ${pageNum}.`);
      continue;
    } else {
      sendTestResultMessage("mainParsing(): validate order download link presence", true, `Download link found in order row ${pageNum}.`);
    }

    const url = link.href;

    if (! orderRow.querySelector('td:first-child')) {
      sendTestResultMessage("mainParsing(): validate order purchase date presence", false, `No purchase date found in order row ${pageNum}.`);
      continue;
    } else {
      sendTestResultMessage("mainParsing(): validate order purchase date presence", true, `Purchase date found in order row ${pageNum}.`);
    }

    const purchaseDate = orderRow.querySelector('td:first-child').textContent.trim();
    await parseOrders(url, pageNum, totalPages, purchaseDate);

    if (pageNum > iterationLimitPerTest) {
      break;
    }

    pageNum += 1;
  }
}


async function parseOrders(downloadsUrl, pageNum, totalPages, purchaseDate) {
  const response = await fetch(downloadsUrl);

  if (!response.ok) {
    console.error(`${store} HTTP error! status: ${response.status}, ` + downloadsUrl);
    sendTestResultMessage("parseOrders(): fetch order download page", false, `Failed to fetch order download page ${downloadsUrl}. HTTP status: ${response.status}`);
    return null;
  }
  else {
    sendTestResultMessage("parseOrders(): fetch order download page", true, `Successfully fetched order download page ${downloadsUrl}`);
  }

  const htmlString = await response.text();
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(htmlString, 'text/html');
  const h1 = doc.querySelector('h1');

  if (!h1) {
    sendTestResultMessage("parseOrders(): validate order ID presence", false, `No order ID found on order download page ${downloadsUrl}.`);
    return;
  }
  else {
    sendTestResultMessage("parseOrders(): validate order ID presence", true, `Order ID found on order download page ${downloadsUrl}.`);
  }

  const orderId = h1.textContent.substring( h1.textContent.indexOf('#')+1, h1.textContent.length-1 );

  if (!orderId) {
    sendTestResultMessage("parseOrders(): validate extracted order ID", false, `Failed to extract order ID from order download page ${downloadsUrl}.`);
    return;
  }
  else {
    sendTestResultMessage("parseOrders(): validate extracted order ID", true, `Extracted order ID ${orderId} from order download page ${downloadsUrl}.`);
  }

  const downloadList = doc.querySelectorAll('ul.list-unstyled li.cart-item');
  const currentAssets = {};
  let i = 1;

  if (downloadList.length === 0) {
    sendTestResultMessage("parseOrders(): validate download items presence", false, `No download items found on order download page ${downloadsUrl}.`);
    return;
  } else {
    sendTestResultMessage("parseOrders(): validate download items presence", true, `Found ${downloadList.length} download items on order download page ${downloadsUrl}.`);
  }

  for (const item of downloadList) {
    const link = item.querySelector('h5 a');

    if (!link) {
      sendTestResultMessage("parseOrders(): validate download item link presence", false, `No download item link found on order download page ${downloadsUrl}, row ${i}.`);
      continue;
    } else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("parseOrders(): validate download item link presence", true, `Download item link found on order download page ${downloadsUrl}, row ${i}.`);
    }

    const url = link.href;
    const title = link.textContent;

    if (!item.querySelector('p a')) {
      sendTestResultMessage("parseOrders(): validate download item publisher", false, `No publisher found for download item "${title}" on order download page ${downloadsUrl}, row ${i}.`);
      continue;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("parseOrders(): validate download item publisher", true, `Publisher found for download item "${title}" on order download page ${downloadsUrl}, row ${i}.`);
    }

    const publisher = item.querySelector('p a').textContent;

    if (!item.querySelector('p a:nth-of-type(2)')) {
      sendTestResultMessage("parseOrders(): validate download item category", false, `No category found for download item "${title}" on order download page ${downloadsUrl}, row ${i}.`);
      continue;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("parseOrders(): validate download item category", true, `Category found for download item "${title}" on order download page ${downloadsUrl}, row ${i}.`);
    }

    const category = item.querySelector('p a:nth-of-type(2)').textContent;

    if (!item.querySelector('img')) {
      sendTestResultMessage("parseOrders(): validate download item image", false, `No image found for download item "${title}" on order download page ${downloadsUrl}, row ${i}.`);
      continue;
    }
    else if (i <= iterationLimitPerTest) {
      sendTestResultMessage("parseOrders(): validate download item image", true, `Image found for download item "${title}" on order download page ${downloadsUrl}, row ${i}.`);
    }

    const imgUrl = item.querySelector('img').src;
    // tags are available on each product page, but skipping for now
    const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':null, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':store};
    currentAssets[url] = product;

    i += 1;
  }

  const sleepPromise = new Promise(resolve => setTimeout(resolve, sleepMilliseconds));
  await sleepPromise;
}
// what to do if there are only download zip files and no titles or images?
