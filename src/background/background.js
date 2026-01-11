import * as indb from "./db.mjs";
let db = null;
indb.openDatabase().then((database) => {
    db = database;
    // console.log("(background) IndexedDB opened:", db);
});

const browserAPI = chrome || browser;
let lastError = null;

function sendMessageToContentScript(message) {
    getCurrentTabId().then((tabId) => {
        if (!tabId) {
            console.error("(background) No active tab found.");
            return;
        }

        browserAPI.tabs.sendMessage(tabId, message).then((response) => {
            console.log("(background) Response from content script:", response);
        }).catch((error) => {
            console.warn("(background) Error sending message to content script. Make sure the content script is loaded in the active tab.", tabId, error);
        });
    });
}


const tabSessions = {
    // tabId: { store: "", collectedAssets: {}, totalAssets: 0, percentDone: 0, lastUpdated: timestamp }
};

function expireOldSessions() {
    const now = Math.floor((new Date()).getTime() / 1000);
    const expirationSeconds = 300; // 5 minutes
    // console.log("(background) Expiring old sessions...", tabSessions);

    for (const tabId in tabSessions) {
        const session = tabSessions[tabId];
        if (now - expirationSeconds > session.lastUpdated) {
            // console.log(`(background) Expiring session for tab ${tabId}`);
            delete tabSessions[tabId];
        }
    }
}


// listen for messages from popup or content scripts
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // console.log("(background) Message received in background script:", message, sender);
    const tabId = getCurrentTabId().then(tabId => {

        if (message.source == "CONTENT") {
            // console.log("(background) Message from content script:", message);
            
            if (message.action === "SENDING_CONTENT") {
                // store received data in memory or indexedDB
                tabSessions[tabId] = tabSessions[tabId] || { store: "", totalAssets: 0, percentDone: 0, lastUpdated: null }; // , collectedAssets: {}
                const session = tabSessions[tabId];
                const assets = Object.values(message.data.assets);
                session.lastUpdated = Math.floor((new Date()).getTime() / 1000);
                session.percentDone = message.data.percentDone || session.percentDone;
                session.totalAssets += assets.length;

                if (assets.length > 0) {
                    indb.addMultipleAssets(db, assets).then(() => {
                        // console.log(`(background) Added ${assets.length} assets to the database.`);
                    }).catch((error) => {
                        console.error("(background) Error adding assets to the database:", error);
                        // "Duplicate URL" error can be ignored
                    });
                }
            }
            else if (message.action === "ERROR") {
                console.error(`(background) Error reported from content script: ${message.data.message}`);
                
                if (tabId in tabSessions) {
                    tabSessions[tabId] = tabSessions[tabId] || { store: "", totalAssets: 0, percentDone: 0, lastUpdated: null }; // , collectedAssets: {}
                    const session = tabSessions[tabId];
                    session.error = message.data.message;
                    lastError = message.data.message;
                }
            }
        }


        else if (message.source == "POPUP") {
            // console.log("(background) message from popup:", message);
            if (message.action === "POPUP_IS_READY") {
                expireOldSessions();
                handlePopupIsReadyMessage().then((response) => {
                    // console.log("(background) Responding to POPUP_IS_READY with:", response);
                    sendResponse(response);
                });
            }
            if (message.action === "START_GATHERING_INVENTORY") {
                // console.log("(background) Starting to gather inventory...");

                // check if there is already a session for this tab
                expireOldSessions();
                if (tabId in tabSessions) {
                    console.error(`(background) Session already exists for tab ${tabId}`);
                    return;
                }
                else {
                    tabSessions[tabId] = { store: "", totalAssets: 0, percentDone: 0, lastUpdated: null }; // , collectedAssets: {}
                }

                sendMessageToContentScript({ command: "PARSE_GAME_ASSETS", data: {} });
            }
            else if (message.action === "POLL_INVENTORY") {
                // console.log("(background) Polling for inventory...");
                // get game tab session 
                if (!(tabId in tabSessions)) {
                    console.warn(`(background) No session found for tab ${tabId}`);
                    sendResponse({ action: "INVENTORY_PROGRESS", data: { count:0, percentDone:0, isComplete:true } });
                    return;
                }

                const session = tabSessions[tabId];
                const isComplete = session ? (session.percentDone >= 100) : false;
                const data = { count:session.totalAssets, percentDone:session.percentDone, isComplete:isComplete };
                // console.log("(background) Inventory progress data:", data);
                sendResponse({ action: "INVENTORY_PROGRESS", data: data });
                return;
            }
            else if (message.action === "OPEN_VIEWER_PAGE") {
                // console.log("(background) Opening viewer page...");
                browserAPI.tabs.create({
                    url: browserAPI.runtime.getURL("background/dbviewer.html")
                });
            }
            else if (message.action === "RESET_GATHERING_INVENTORY") {
                // console.log("(background) Resetting gathering inventory...");
                lastError = null;
                if (tabId in tabSessions) {
                    delete tabSessions[tabId];
                }
                sendMessageToContentScript({ command: "STOP_PARSING", data: {} });
            }
        }

    });

    if (message.source == "POPUP" && (message.action === "POPUP_IS_READY" || message.action === "POLL_INVENTORY")) {
        return true; // indicate that we will send a response asynchronously
    }
});

// pop-up sent POPUP_IS_READY message, send response
function handlePopupIsReadyMessage() {
    return browserAPI.tabs.query({ currentWindow: true, active: true }).then((tabs) => {
        if (tabs.length === 0) {
            console.error("(background) No active tab found.");
            return;
        }

        const tabInGameInventorySession = (tabs[0].id in tabSessions);
        // console.log("Popup is ready. Note available tabs...", tabs);
        const data = { isGatheringInventory: tabInGameInventorySession };
        if (lastError) {
            data.lastError = lastError;
        }
        return { action: "LOAD_RESPONSE", data: data };
    });
}

function getCurrentTabId() {
    return browserAPI.tabs.query({ currentWindow: true, active: true }).then((tabs) => {
        if (tabs.length === 0) {
            // console.warn("(background) No active tab found.");
            return null;
        }

        // console.log("(background) Current active tab ID:", tabs[0].id, tabs[0].url);
        return tabs[0].id;
    });
}
