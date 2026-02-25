const browserAPI = chrome || browser;
const ERROR_CONTENT_DEFAULT_MESSAGE = "<p>Can't get inventory from this page.</p><p>Try a different page.</p>";

document.addEventListener("DOMContentLoaded", async () => {
    const selectPage = document.getElementById("select-page");
    const goPageButton = document.getElementById("go-page-button");
    const startGatheringInventoryBtn = document.getElementById("start-gathering-inventory-btn");
    const openViewerPageBtn = document.getElementById("open-viewer-page-btn");
    // const errorContent = document.getElementById("error-content");

    startGatheringInventoryBtn.addEventListener("click", () => gatherInventoryBtnClicked(false));

    openViewerPageBtn.addEventListener("click", () => {
        browserAPI.runtime.sendMessage({ source:"POPUP", action:"OPEN_VIEWER_PAGE" });
        window.close(); // close the popup after opening viewer page
    });

    // change content page to URL if select a page or click go-to-page button
    function goToPage() {
        const url = selectPage.value;
        if (!url) {
            return;
        }

        browserAPI.tabs.update({ url: url });
    }
    selectPage.addEventListener("change", goToPage);
    goPageButton.addEventListener("click", goToPage);

    // let background.js know that popup has loaded
    browserAPI.runtime.sendMessage({ source:"POPUP", action:"POPUP_IS_READY" })
        .then((response) => {
            // console.log("Response from background script:", response);
            handleLoadResponse(response);
        })
        .catch((error) => {
            console.error("Error sending message to background script:", error);
        });

    selectPage.innerHTML = '<option value="">-- Select a page --</option>';

    for (const pageInfo of availablePages) {
        const option = document.createElement("option");
        option.value = pageInfo.url;
        option.textContent = pageInfo.label;
        selectPage.appendChild(option);
    }

    document.getElementById("reset").addEventListener("click", () => {
        document.getElementById("error-content").innerHTML = ERROR_CONTENT_DEFAULT_MESSAGE;
        browserAPI.runtime.sendMessage({ source:"POPUP", action:"RESET_GATHERING_INVENTORY" });
        window.location.reload();
    });
});


// listen for messages from background.js
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "IN_PROGRESS") {
        gatherInventoryBtnClicked(true);
    }
});


// after loading and sending POPUP_IS_READY, will receive LOAD_RESPONSE action message
async function handleLoadResponse(message) {
    // console.log("Received data:", message);
    const { urlIsMatched, storeName, activeTabUrl } = await queryActiveTabUrl();
    // console.log("(popup) Active tab URL matched store:", urlIsMatched, storeName, activeTabUrl);

    // show the found-inventory div or hide it
    if (urlIsMatched) {
        document.getElementById("found-inventory").classList.remove("hidden");
        document.getElementById("error-content").classList.add("hidden");
        document.getElementById("which-site").textContent = "Click to start inventory on " + storeName;
    } else {
        document.getElementById("found-inventory").classList.add("hidden");
        document.getElementById("error-content").classList.remove("hidden");
    }

    if (message.data.lastError) {
        document.getElementById("error-content").innerHTML = `<p>Error: ${message.data.lastError}</p>`;

        if (document.getElementById("error-content").classList.contains("hidden")) {
            document.getElementById("error-content").classList.remove("hidden");
        }
    }

    if (message.data.isGatheringInventory) {
        gatherInventoryBtnClicked(true);
        return;
    }
}


// clicked "Start Gathering Inventory" button
async function gatherInventoryBtnClicked(inProgress) {
    const progressDiv = document.getElementById("progress");
    const progressBar = document.getElementById("progress-bar");
    const progressText = document.getElementById("progress-text");
    document.getElementById("which-site").textContent = "Gathering inventory";
    document.getElementById("found-inventory").classList.add("hidden");
    document.getElementById("select-page-wrapper").classList.add("hidden");

    // console.log("(popup) gatherInventoryBtnClicked, inProgress =", inProgress, typeof inProgress);
    if (!inProgress) {
        // console.log("(popup) Sending START_GATHERING_INVENTORY to background script");
        browserAPI.runtime.sendMessage({ source:"POPUP", action:"START_GATHERING_INVENTORY" });
    }

    // start polling for results from background script
    progressText.textContent = "Gathering...";
    progressDiv.classList.remove("hidden");
    let progressValue = 0;

    let progressInterval = setInterval(async () => {
        const pollResults = await pollBackgroundForResults();
        if ('error' in pollResults) {
            progressText.textContent = `Error: ${pollResults.error}`;
            clearInterval(progressInterval);
            return;
        }

        progressText.textContent = `Gathered ${pollResults.count} items, ${pollResults.percentDone}% done`;
        // console.log("(popup) pollBackgroundForResults results:", pollResults, pollResults.count, pollResults.percentDone);

        if (pollResults.percentDone >= 100) {
            clearInterval(progressInterval);
        }

        progressValue = pollResults.percentDone;
        progressBar.value = progressValue;
    }, 3000);
}

// polling results after start gathering inventory
async function pollBackgroundForResults() {
    return browserAPI.runtime.sendMessage({ source:"POPUP", action:"POLL_INVENTORY" })
        .then((response) => {
            // console.log("Poll response from background script:", response);
            return response.data;
        })
        .catch((error) => {
            console.error("Error polling background script:", error);
        });
}

// keep this list in sync with background/dbviewer.js
const availablePages = [
    { label:"3D Shards", url:"https://3dshards.com/account-4/downloads/" },
    { label:"CGTrader", url:"https://www.cgtrader.com/profile/purchases" },
    { label:"Daz3D", url:"https://www.daz3d.com/sales/order/history" },
    { label:"FAB Unreal", url:"https://www.fab.com/library" },
    { label:"FAB Quixel Megascans", url:"https://www.fab.com/sellers/Quixel%20Megascans" },
    { label:"GameDev Market", url:"https://www.gamedevmarket.net/user/orders" },
    { label:"Godot Marketplace", url:"https://godotmarketplace.com/my-account/orders/" },
    { label:"Gumroad", url:"https://gumroad.com/library" },
    { label:"Itch.io", url:"https://itch.io/my-collections" },
    { label:"Kitbash3D", url:"https://cargo-app.kitbash3d.com/account/my-assets" },
    { label:"Leartes Studio", url:"https://cosmos.leartesstudios.com/inventory" },
    { label:"Ovani Sound", url:"https://ovanisound.com/account" },
    { label:"RenderHub", url:"https://www.renderhub.com/my-downloads" },
    { label:"SuperHiveMarket Blender", url:"https://superhivemarket.com/account/orders" },
    { label:"Synty Store", url:"https://account.syntystore.com/orders" },
    { label:"TurboSquid", url:"https://www.turbosquid.com/Order/Index.cfm" },
    { label:"Unity", url:"https://assetstore.unity.com/account/assets" },
];

async function queryActiveTabUrl() {
    let storeName = "";
    let urlIsMatched = false;
    let activeTabUrl = "";

    await browserAPI.tabs.query({ currentWindow: true, active: true }).then((tabs) => {
        // console.log("(popup) queryActiveTabUrl, tabs:", tabs);
        if (tabs.length === 0) {
            console.error("(background) No active tab found.");
            return;
        }

        activeTabUrl = tabs[0].url.toLowerCase();

        for (const pageInfo of availablePages) {
            // console.log("(popup) queryActiveTabUrl comparing URLs:", activeTabUrl, pageInfo.url);
            if (activeTabUrl.startsWith(pageInfo.url.toLowerCase())) {
                // console.log("(popup) queryActiveTabUrl matched URL:", activeTabUrl, pageInfo.url);
                urlIsMatched = true;
                storeName = pageInfo.label;
                return;
            }
        }
    });

    return { urlIsMatched, storeName, activeTabUrl };
}

/*
// Other stores to consider adding later?
    { label:"Envato Elements", url:"https://elements.envato.com/account/downloads" },
    { label:"Sketchfab", url:"https://sketchfab.com/me/downloads" },
    { label:"3dmodels", url:"https://3dmodels.org/3d-models/" },
    { label:"Free3D", url:"https://free3d.com/account/downloads/" },
    { label:"Clara.io", url:"https://clara.io/library" },
    { label:"3DOcean", url:"https://3docean.net/downloads/" },
    { label:"3DExport", url:"https://3dexport.com/downloads" },
    { label:"CadNav", url:"https://www.cadnav.com/" },
    { label:"SketchUpBox", url:"https://www.sketchupbox.com/" },
    { label:"Evermotion", url:"https://evermotion.org/shop/my_orders" },
    { label:"Cadblocksfree", url:"https://www.cadblocksfree.com/en/3d-cad-models.html" },
    { label:"Renderosity Free", url:"https://www.renderosity.com/mod/freestuff/" },
    { label:"Renderosity Orders", url:"https://www.renderosity.com/marketplace/account/orders" },
*/