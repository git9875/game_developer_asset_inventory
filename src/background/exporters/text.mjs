const browserAPI = chrome || browser;

export async function format(currentAssets) {
  // const product = {'url':url, 'imgUrl':imgUrl, 'title':title, 'publisher':publisher, 'category':category, 'tags':tags, 'orderId':orderId, 'purchaseDate':purchaseDate, 'assetStore':'Unity'};
  // currentAssets[url] = product;
  const lines = [ 'title\tpublisher\tstore\turl\timgUrl\tpurchaseDate\torderId\tcategory\ttags' ];

  for (const url in currentAssets) {
    const p = currentAssets[url];
    const tagsJoined = p['tags'] ? p['tags'].join(', ') : '';
    const line = `${p['title']}\t${p['publisher']}\t${p['assetStore']}\t${p['url']}\t${p['imgUrl']}\t${p['purchaseDate']}\t${p['orderId']}\t${p['category']}\t${tagsJoined}`;
    lines.push(line);
  }

  return lines.join('\n');
}

export function download(text, filename) {
  var blob = new Blob([text], {type: 'text/plain'});
  var url = URL.createObjectURL(blob);
  browserAPI.downloads.download({
    url: url,
    filename: filename,
    saveAs: true // Prompts the user to choose the save location and filename
  });
}
