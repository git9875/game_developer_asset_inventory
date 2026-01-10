const browserAPI = chrome || browser;

export async function format(currentAssets) {
  return JSON.stringify( Object.values(currentAssets), null, 2 );
}

export function download(text, filename) {
  var blob = new Blob([text], {type: 'application/json'});
  var url = URL.createObjectURL(blob);
  browserAPI.downloads.download({
    url: url,
    filename: filename,
    saveAs: true // Prompts the user to choose the save location and filename
  });
}
