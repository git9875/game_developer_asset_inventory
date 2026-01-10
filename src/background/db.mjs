// IndexedDB storage
// handles CRUD operations for saved inventories in indexedDB
const DB_NAME = "GameAssetInventoryDB";
const DB_VERSION = 1;
const STORE_NAME = "assets";

/*
Asset object structure:
{
    id: auto-incremented primary key,
    url: string (unique), // indexed key, prevent duplicates
    imgUrl: string,
    title: string,
    publisher: string,
    category: string,
    tags: [string],
    orderId: string,
    purchaseDate: string,
    assetStore: string, (was originally "storeName", but renamed for clarity)
    assetStoreKey: string (assetStore with spaces replaced by underscores, required for indexing in indexedDB)
}
*/

export function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
                store.createIndex("url", "url", { unique: true });
                store.createIndex("assetStoreKey", "assetStoreKey", { unique: false });
                store.createIndex("category", "category", { unique: false });
                store.createIndex("tags", "tags", {unique: false, multiEntry: true});
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


export function addAsset(db, asset) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        // prevent adding duplicate URLs
        const index = store.index("url");
        const getRequest = index.get(asset.url);

        getRequest.onsuccess = (event) => {
            if (event.target.result) {
                reject(new Error("Duplicate URL"));
                return;
            }

            asset['assetStoreKey'] = asset.assetStore.replace(/\s+/g, '_'); // for text search by store
            const request = store.add(asset);
            request.onsuccess = () => {
                resolve();
            };
            request.onerror = (event) => {
                reject(event.target.error);
            };
        };
        getRequest.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


export function addMultipleAssets(db, assets) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        let completed = 0;

        for (const asset of assets) {
            // prevent adding duplicate URLs
            const index = store.index("url");
            const getRequest = index.get(asset.url);
            getRequest.onsuccess = (event) => {
                if (event.target.result) {
                    // reject(new Error("Duplicate URL: " + asset.url));
                    console.warn("(db) Skipping duplicate URL:", asset.url);
                    completed++;
                    if (completed === assets.length) {
                        resolve();
                    }
                    return;
                }

                asset['assetStoreKey'] = asset.assetStore.replace(/\s+/g, '_'); // for text search by store
                const request = store.add(asset);
                request.onsuccess = () => {
                    completed++;
                    if (completed === assets.length) {
                        resolve();
                    }
                };
                request.onerror = (event) => {
                    reject(event.target.error);
                };
            };
            getRequest.onerror = (event) => {
                reject(event.target.error);
            };
        }
    });
}


export function getAllAssets(db) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


export function getAllAssetsByPage(db, pageNumber, pageSize) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.openCursor();
        const allAssets = [];

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                allAssets.push(cursor.value);
                cursor.continue();
            } else {
                const start = (pageNumber - 1) * pageSize;
                const end = start + pageSize;
                resolve(allAssets.slice(start, end));
            }
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


export function getAssetsByStore(db, assetStoreKey) {
    assetStoreKey = assetStoreKey.replace(/\s+/g, '_');
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index("assetStoreKey");
        const range = IDBKeyRange.only(assetStoreKey);
        const request = index.getAll(range);

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


export function getAssetsByStoreByPage(db, assetStoreKey, pageNumber, pageSize) {
    assetStoreKey = assetStoreKey.replace(/\s+/g, '_');
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index("assetStoreKey");
        const range = IDBKeyRange.only(assetStoreKey);
        const request = index.openCursor(range);
        const allAssets = [];

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                allAssets.push(cursor.value);
                cursor.continue();
            } else {
                const start = (pageNumber - 1) * pageSize;
                const end = start + pageSize;
                resolve(allAssets.slice(start, end));
            }
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


export function textSearchOnProductTitle(db, searchText) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.openCursor();
        const matchingAssets = [];
        const lowerSearchText = searchText.toLowerCase();

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                const product = cursor.value;
                if (product.title && product.title.toLowerCase().includes(lowerSearchText)) {
                    matchingAssets.push(product);
                }
                cursor.continue();
            } else {
                resolve(matchingAssets);
            }
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


export function textSearchOnProductTitleByStore(db, searchTerm, assetStoreKey) {
    assetStoreKey = assetStoreKey.replace(/\s+/g, '_');
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index("assetStoreKey");
        const range = IDBKeyRange.only(assetStoreKey);
        const request = index.openCursor(range);
        const matchingAssets = [];
        const lowerSearchTerm = searchTerm.toLowerCase();
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                const product = cursor.value;
                if (product.title && product.title.toLowerCase().includes(lowerSearchTerm)) {
                    matchingAssets.push(product);
                }
                cursor.continue();
            } else {
                resolve(matchingAssets);
            }
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


export function getAssetsByTag(db, tag) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index("tags");
        const range = IDBKeyRange.only(tag);
        const request = index.getAll(range);
        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


export function getAssetsByCategory(db, category) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index("category");
        const range = IDBKeyRange.only(category);
        const request = index.getAll(range);
        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


export function countAssets(db) {
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


export function countAssetsByStore(db, assetStoreKey) {
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

// use this function to create a dropdown of tags and categories in the viewer
export function getAllKeysByIndex(db, indexName) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index(indexName);
        const request = index.openKeyCursor();
        const keys = new Set();

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                keys.add(cursor.key);
                cursor.continue();
            } else {
                resolve(Array.from(keys));
            }
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


/*
export function clearAssets(db) {
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

export function deleteAssetsForStore(db, assetStoreKey) {
    assetStoreKey = assetStoreKey.replace(/\s+/g, '_');
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index("assetStoreKey");
        const range = IDBKeyRange.only(assetStoreKey);
        const request = index.openCursor(range);
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            } else {
                resolve();
            }
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}
*/