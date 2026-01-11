// IndexedDB storage
// handles CRUD operations for saved tests in indexedDB
// read queries are in reverse order (newest tests first)
const DB_NAME = "GDAI_Test_Results";
const DB_VERSION = 1;
const STORE_NAME = "tests";

/*
Test object structure:
{
    id: auto-incremented primary key,
    assetStoreKey: string,
    testName: string,
    passed: boolean,
    details: string,
    timestamp: Date,
    groupTimestamp: Date // for grouping multiple tests run together
}
*/

export function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
                store.createIndex("assetStoreKey", "assetStoreKey", { unique: false });
            }
        };
        request.onsuccess = (event) => {
            const db = event.target.result;
            resolve(db);
        };
        request.onerror = (event) => {
            reject(event.target.error);
        }
    });
}


export function addTest(db,test) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(test);
        request.onsuccess = () => {
            resolve();
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


export function addMultipleTests(db, tests) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        let completed = 0;

        for (const test of tests) {
            const request = store.add(test);
            request.onsuccess = () => {
                completed++;
                if (completed === tests.length) {
                    resolve();
                }
            };
            request.onerror = (event) => {
                reject(event.target.error);
            };
        }
    });
}



export function getAllTestsByPage(db, pageNumber, pageSize) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.openCursor(null, "prev");
        const allTests = [];

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                allTests.push(cursor.value);
                cursor.continue();
            } else {
                const start = (pageNumber - 1) * pageSize;
                const end = start + pageSize;
                resolve(allTests.slice(start, end));
            }
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


export function getTestsByStoreByPage(db, assetStoreKey, pageNumber, pageSize) {
    // assetStoreKey = assetStoreKey.replace(/\s+/g, '_'); // already sanitized on input
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index("assetStoreKey");
        const range = IDBKeyRange.only(assetStoreKey);
        const request = index.openCursor(range, "prev");
        const allTests = [];

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                allTests.push(cursor.value);
                cursor.continue();
            } else {
                const start = (pageNumber - 1) * pageSize;
                const end = start + pageSize;
                resolve(allTests.slice(start, end));
            }
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


export function textSearchOnTestTitle(db, searchText) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.openCursor(null, "prev");
        const matchingTests = [];
        const lowerSearchText = searchText.toLowerCase();

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                const test = cursor.value;
                if (test.title && test.title.toLowerCase().includes(lowerSearchText)) {
                    matchingTests.push(test);
                }
                cursor.continue();
            } else {
                resolve(matchingTests);
            }
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


export function textSearchOnTestTitleByStore(db, searchTerm, assetStoreKey) {
    // assetStoreKey = assetStoreKey.replace(/\s+/g, '_'); // already sanitized on input
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index("assetStoreKey");
        const range = IDBKeyRange.only(assetStoreKey);
        const request = index.openCursor(range, "prev");
        const matchingTests = [];
        const lowerSearchTerm = searchTerm.toLowerCase();
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                const test = cursor.value;
                if (test.title && test.title.toLowerCase().includes(lowerSearchTerm)) {
                    matchingTests.push(test);
                }
                cursor.continue();
            } else {
                resolve(matchingTests);
            }
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


export function countTests(db) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.count();
        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


export function countTestsByStore(db, assetStoreKey) {
    assetStoreKey = assetStoreKey.replace(/\s+/g, '_');
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index("assetStoreKey");
        const range = IDBKeyRange.only(assetStoreKey);
        const request = index.count(range);

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


export function clearTests(db) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();
        request.onsuccess = () => {
            resolve();
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

