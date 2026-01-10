const browserAPI = chrome || browser;

export async function format(currentAssets) {
  // const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':tags, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':'Unity'};
  // currentAssets[url] = product;
  const lines = [ 'title,publisher,store,url,imgUrl,purchaseDate,orderId,category,tags' ];

  for (const url in currentAssets) {
    const p = currentAssets[url];
    // const line = `"${p['title']}","${p['publisher']}",${p['assetStore']},"${p['url']}","${p['imgUrl']}",${p['purchaseDate']},${p['orderId']}`;
    const tagsJoined = p['tags'] ? p['tags'].join(', ') : '';
    const line = processRow([p['title'], p['publisher'], p['assetStore'], p['url'], p['imgUrl'], p['purchaseDate'], p['orderId'], p['category'], tagsJoined]);
    lines.push(line);
  }

  return lines.join('\n');
}

export function download(text, filename) {
  var blob = new Blob([text], {type: 'text/csv'});
  var url = URL.createObjectURL(blob);
  browserAPI.downloads.download({
    url: url,
    filename: filename,
    saveAs: true // Prompts the user to choose the save location and filename
  });
}

// using solution from  https://stackoverflow.com/questions/14964035/how-to-export-javascript-array-info-to-csv-on-client-side
function processRow(row) {
    let finalVal = '';
    for (let j = 0; j < row.length; j++) {
        let innerValue = !row[j] ? '' : row[j].toString();
        if (row[j] instanceof Date) {
            innerValue = row[j].toLocaleString();
        };
        let result = innerValue.replace(/"/g, '""');
        if (result.search(/("|,|\n)/g) >= 0)
            result = '"' + result + '"';
        if (j > 0)
            finalVal += ',';
        finalVal += result;
    }
    return finalVal;
};
