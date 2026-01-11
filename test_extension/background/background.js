import * as indb from "./db.mjs";
let db = null;
indb.openDatabase().then((database) => {
    db = database;
    // console.log("(background) IndexedDB opened:", db);
});

const browserAPI = chrome || browser;


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
    // tabId: { store:"", total:0, passed:0, lastUpdated:timestamp, finished:false }
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
    console.log("(background) Message received in background script:", message, sender);
    const tabId = getCurrentTabId().then(tabId => {
        const currentTimestamp = Math.floor((new Date()).getTime() / 1000);

        if (message.source == "CONTENT") {
            console.log("(background) Message from content script:", tabId, message);

            if (message.action === "TEST_RESULT") {
                if (tabId in tabSessions) {
                    const session = tabSessions[tabId];
                    session.total = message.progress.total;
                    session.passed = message.progress.passed;
                    session.lastUpdated = currentTimestamp;
                }
                else {
                    tabSessions[tabId] = { store: "", total:0, passed:0, lastUpdated:currentTimestamp, finished:false };
                }

                // store test result in indexedDB
                const testData = message.data;
                testData.assetStoreKey = testData.store;
                delete testData.store;

                indb.addTest(db, testData).then(() => {
                    console.log(`(background) Added test result ${testData.testName} to the database.`);
                }).catch((error) => {
                    console.error("(background) Error adding test result to the database:", error);
                });
            }
            else if (message.action === "ERROR") {
                console.error(`(background) Error reported from content script: ${message.data.message}`);
                
                if (tabId in tabSessions) {
                    const session = tabSessions[tabId];
                    session.error = message.data.message;
                    session.lastUpdated = currentTimestamp;
                }
                else {
                    tabSessions[tabId] = { store: "", total:0, passed:0, lastUpdated:currentTimestamp, finished:true, error: message.data.message };
                }
            }
            else if (message.action === "TESTS_FINISHED") {
                console.log("(background) All tests finished in content script.");
                
                if (tabId in tabSessions) {
                    const session = tabSessions[tabId];
                    session.finished = true;
                    session.lastUpdated = currentTimestamp;
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
                console.log("(background) Starting to gather inventory...");

                // check if there is already a session for this tab
                expireOldSessions();
                if (tabId in tabSessions) {
                    console.error(`(background) Session already exists for tab ${tabId}`);
                    return;
                }
                else {
                    tabSessions[tabId] = { store: "", total: 0, passed: 0, lastUpdated: currentTimestamp, finished: false }; // , collectedAssets: {}
                }

                sendMessageToContentScript({ command: "PARSE_GAME_ASSETS", data: {} });
            }
            else if (message.action === "POLL_INVENTORY") {
                console.log("(background) Polling for inventory...", tabId);
                // get game tab session 
                if (!(tabId in tabSessions)) {
                    console.warn(`(background) No session found for tab ${tabId}`);
                    sendResponse({ action: "INVENTORY_PROGRESS", data: { total:0, passed:0, finished:true, lastUpdated: currentTimestamp } });
                    return;
                }

                const session = tabSessions[tabId];
                const data = { total:session.total, passed:session.passed, finished:session.finished, lastUpdated: session.lastUpdated };
                console.log("(background) Inventory progress data:", data);
                sendResponse({ action: "INVENTORY_PROGRESS", data: data });
                return;
            }
            else if (message.action === "OPEN_VIEWER_PAGE") {
                console.log("(background) Opening viewer page...");
                browserAPI.tabs.create({
                    url: browserAPI.runtime.getURL("background/testviewer.html")
                });
            }
            else if (message.action === "RESET_GATHERING_INVENTORY") {
                console.log("(background) Resetting gathering inventory...");
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
        return { action: "LOAD_RESPONSE", data: data };
    });
}

function getCurrentTabId() {
    return browserAPI.tabs.query({ currentWindow: true, active: true }).then((tabs) => {
        if (tabs.length === 0) {
            console.warn("(background) No active tab found.");
            return null;
        }

        console.log("(background) Current active tab ID:", tabs[0].id, tabs[0].url);
        return tabs[0].id;
    });
}
