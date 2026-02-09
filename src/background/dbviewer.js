import * as indb from "./db.mjs";
const db = await indb.openDatabase();

import * as csv from './exporters/csv.mjs';
import * as excel from './exporters/excel.mjs';
import * as json from './exporters/json.mjs';
import * as text from './exporters/text.mjs';


// ------------------- Filtering, Pagination, and Rendering -------------------

let currentData = [];
let filteredData = [];
let currentPage = 1;
let rowsPerPage = 50;
let itemCount = 0;
let totalPages = 1;
let storeFilter = "";
let isMultiPage = false;


// keep this list in sync with popup/run_inventory.js
const storeNames = [ "3D Shards", "CGTrader", "Daz3D", "Fab Quixel Megascans", "Fab Unreal", 'GameDev Market', 'Godot Marketplace', "Gumroad", "KitBash3d", "Leartes Studios", "Ovani Sound", "RenderHub", "Blender", "Synty", "TurboSquid", "Unity" ];


function applyFilter() {
    const searchTerm = document.getElementById('searchBox').value.toLowerCase();
    filteredData = currentData.filter(item =>
        Object.values(item).some(val => String(val).toLowerCase().includes(searchTerm))
    );
    currentPage = 1;
    renderTable();
    renderPagination();
}

function renderTable() {
    const tbody = document.getElementById('tableBody');
    const pageData = filteredData;

    if (pageData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No data found</td></tr>';
        return;
    }

    tbody.innerHTML = pageData.map(item => `
        <tr>
            <td>${item.imgUrl ? `<img src="${item.imgUrl}" loading="lazy" alt="${item.title || 'Asset'}">` : 'N/A'}</td>
            <td><b>${escapeHtml(item.title || 'N/A')}</b><br />${escapeHtml(item.category)}<br />${escapeHtml(item.tags ? item.tags.join(', ') : '')}</td>
            <td>${escapeHtml(item.publisher || 'N/A')}</td>
            <td>${escapeHtml(item.orderId || 'N/A')}</td>
            <td>${escapeHtml(item.purchaseDate || 'N/A')}</td>
            <td>${escapeHtml(item.assetStore || 'N/A')}</td>
            <td><a href="${item.url}" target="game_asset_item_view">View</a></td>
        </tr>
    `).join('');
}

function renderPagination() {
    const pagination = document.getElementById('pagination');
    pagination.innerHTML = '';
    const paginationHtml = [];

    if (totalPages <= 1) return;

    if (currentPage > 1) {
        paginationHtml.push(`<a class="page-links" data-page="1">« First</a>`);
        paginationHtml.push(`<a class="page-links" data-page="${currentPage - 1}">‹ Prev</a>`);
    }

    for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
        paginationHtml.push(`<a class="page-links" data-page="${i}" class="${i === currentPage ? 'active' : ''}">${i}</a>`);
    }

    if (currentPage < totalPages) {
        paginationHtml.push(`<a class="page-links" data-page="${currentPage + 1}">Next ›</a>`);
        paginationHtml.push(`<a class="page-links" data-page="${totalPages}">Last »</a>`);
    }

    pagination.innerHTML = paginationHtml.join('');

    const buttons = document.querySelectorAll(".page-links")
    buttons.forEach(button => {
        button.addEventListener("click", (e) => {
            const page = parseInt(e.target.getAttribute("data-page"));
            goToPage(page);
        });
    });
}

async function goToPage(page) {
    // console.log(`Going to page ${page}`);
    if (isMultiPage) {
        if (storeFilter === "") {
            await indb.getAllAssetsByPage(db, page, rowsPerPage).then((assets) => {
                currentData = assets;
                // console.log(`(goToPage) Loaded ${assets.length} assets for page ${page}`, currentData);
            });
        } else {
            await indb.getAssetsByStoreByPage(db, storeFilter, page, rowsPerPage).then((assets) => {
                currentData = assets;
            });
        }
    }

    filteredData = currentData;

    currentPage = page;
    renderTable();
    renderPagination();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}




// ------------------- Event Listeners -------------------

document.getElementById('searchBox').addEventListener('input', applyFilter);
document.getElementById('searchBox').addEventListener('keydown', searchKeydown);

document.getElementById('rowsPerPage').addEventListener('change', (e) => {
    rowsPerPage = parseInt(e.target.value);
    currentPage = 1;
    renderTable();
    renderPagination();
});

document.getElementById('store-select').addEventListener('change', handleStoreFilterChange);
document.getElementById('load-data-button').addEventListener('click', handleStoreFilterChange);
document.getElementById('tag-select').addEventListener('change', handleTagFilterChange);
document.getElementById('category-select').addEventListener('change', handleCategoryFilterChange);

// Open the modal dialog when the button is clicked
const exporterDialog = document.getElementById('exporter-dialog');
document.getElementById('open-exporter-dialog-btn').addEventListener('click', () => {
    // console.log('Opening exporter dialog');
    exporterDialog.showModal();
});
document.getElementById('close-exporter-dialog-btn').addEventListener('click', () => {
    exporterDialog.close();
});
document.getElementById('close-exporter-dialog-btn2').addEventListener('click', () => {
    exporterDialog.close();
});
const exporterSplitSelect = document.getElementById('exporter-rows-split-select');
exporterSplitSelect.value = "100000000"; // default to "No Split" so that the listener is triggered on change and perform calculations
exporterSplitSelect.addEventListener('change', exportSplitRowsSelect);
document.getElementById('export-all-btn').addEventListener('click', () => exportFile(0));


async function handleStoreFilterChange() {
    storeFilter = document.getElementById('store-select').value;
    itemCount = await getDbRowCount();

    if (storeFilter === "") {
        // no filter
        if (itemCount > rowsPerPage) {
            await indb.getAllAssetsByPage(db, 1, rowsPerPage).then((assets) => {
                currentData = assets;
            });
        }
        else {
            await indb.getAllAssets(db).then((assets) => {
                currentData = assets;
            });
        }

    } else {
        if (itemCount > rowsPerPage) {
            // console.log(`dbviewer Loading assets for store "${storeFilter}" with pagination, 1, ${rowsPerPage}`);
            await indb.getAssetsByStoreByPage(db, storeFilter, 1, rowsPerPage).then((assets) => {
                currentData = assets;
                // console.log(`dbviewer Loaded ${assets.length} assets for store "${storeFilter}"`);
            });
        }
        else {
            await indb.getAssetsByStore(db, storeFilter).then((assets) => {
                currentData = assets;
            });
        }
    }

    applyFilter();
    setPrePagination(itemCount);
    currentPage = 1;
    renderTable();
    renderPagination();
}


async function handleTagFilterChange() {
    const tagFilter = document.getElementById('tag-select').value;
    currentData = await indb.getAssetsByTag(db, tagFilter);
    filteredData = currentData;
    currentPage = 1;
    setPrePagination(currentData.length, false);
    renderTable();
    renderPagination();
}

async function handleCategoryFilterChange() {
    const categoryFilter = document.getElementById('category-select').value;
    currentData = await indb.getAssetsByCategory(db, categoryFilter);
    filteredData = currentData;
    currentPage = 1;
    setPrePagination(currentData.length, false);
    renderTable();
    renderPagination();
}


async function handleInitialLoadResponse() {
    // console.log("(viewer handleInitialLoadResponse) Received data:", data);
    const storeSelect = document.getElementById('store-select');
    storeSelect.innerHTML = '<option value="">All Stores</option>';

    for (const storeName of storeNames) {
        const option = document.createElement('option');
        option.value = storeName;
        option.textContent = storeName;
        storeSelect.appendChild(option);
    }

    loadTagsAndCategories();

    await indb.countAssets(db).then((count) => {
        // console.log(`Total assets in DB: ${count}`);
        itemCount = count;
    });

    if (itemCount > rowsPerPage) {
        await indb.getAllAssetsByPage(db, 1, rowsPerPage).then((assets) => {
            currentData = assets;
        });
    }
    else {
        await indb.getAllAssets(db).then((assets) => {
            currentData = assets;
        });
    }

    filteredData = currentData;
    setPrePagination(itemCount);
    renderTable();
    renderPagination();
}


async function loadTagsAndCategories() {
    const tagSelect = document.getElementById('tag-select');
    const categorySelect = document.getElementById('category-select');
    tagSelect.innerHTML = '<option value="">All Tags</option>';
    categorySelect.innerHTML = '<option value="">All Categories</option>';

    const tags = await indb.getAllKeysByIndex(db, 'tags');
    tags.sort();
    const categories = await indb.getAllKeysByIndex(db, 'category');
    categories.sort();

    // console.log('sample tag objects:', tags.slice(0,5));
    // console.log('sample category objects:', categories.slice(0,5));

    for (const tag of tags) {
        const option = document.createElement('option');
        option.value = tag;
        option.textContent = tag;
        tagSelect.appendChild(option);
    }

    for (const category of categories) {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        categorySelect.appendChild(option);
    }
}


// instead of just filtering on the current content, this wiill query the database for matching items
async function searchKeydown(e) {
    if (e.key !== 'Enter') {
        return;
    }

    const searchTerm = e.target.value.toLowerCase().trim();
    if (searchTerm === "") {
        handleStoreFilterChange();
        return;
    }

    const storeName = storeFilter;
    currentData = await searchData(searchTerm, storeName);
    filteredData = currentData;
    currentPage = 1;
    setPrePagination(currentData.length, true);
    renderTable();
    renderPagination();
}

function setPrePagination(realCount, noPagination=false) {
    itemCount = realCount;
    totalPages = Math.ceil(itemCount / rowsPerPage);

    if (noPagination) {
        totalPages = 1;
        isMultiPage = false;
    }
    else {
        isMultiPage = (totalPages > 1);
    }

    document.getElementById('pagination-summary').innerHTML = `Total items: <b>${itemCount}</b>. Total pages: <b>${totalPages}</b>.`;
}

handleInitialLoadResponse();


async function searchData(searchTerm, storeName) {
    if (storeName === "") {
        return await indb.textSearchOnProductTitle(db, searchTerm);
    } else {
        return await indb.textSearchOnProductTitleByStore(db, searchTerm, storeName);
    }
}

async function getDbRowCount() {
    if (storeFilter === "") {
        return await indb.countAssets(db);
    } else {
        return await indb.countAssetsByStore(db, storeFilter);
    }
}


// -------------------- Exporting --------------------
let exportFormat = 'csv'; // default format
let exportPaginationNumber = 0; // default no pagination
let exportSearchData = [];
let exportTotalRows = 0;

// split up the data into multiple files based on the pagination number (split rows) selected
async function exportSplitRowsSelect(e) {
    exportPaginationNumber = parseInt(e.target.value, 10);
    const storeName = storeFilter;
    exportSearchData = [];
    exportTotalRows = 0;

    const searchTerm = document.getElementById('searchBox').value.toLowerCase();
    if (searchTerm) {
        exportSearchData = await searchData(searchTerm, storeName);
        exportTotalRows = exportSearchData.length;
    }
    else {
        exportTotalRows = itemCount = await getDbRowCount();
        // console.log(`(exportSplitRowsSelect) Total rows to export: ${exportTotalRows}`);
    }

    const exportBtnWrapper = document.getElementById('export-btns-wrapper');
    exportBtnWrapper.innerHTML = ''; // clear previous buttons
    let numFiles = 1;

    if (exportPaginationNumber > 0 && (exportTotalRows > exportPaginationNumber)) {
        numFiles = Math.ceil(exportTotalRows / exportPaginationNumber);

        for (let i = 0; i < numFiles; i++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = `Export File ${i + 1}`;
            btn.addEventListener('click', () => exportFile(i));
            exportBtnWrapper.appendChild(btn);
        }
    }

    document.getElementById('export-info').textContent = `Total rows to export: ${exportTotalRows}. ${numFiles} file(s) will be created.`;
}

async function exportFile(fileIndex) {
    const start = fileIndex * exportPaginationNumber;
    const end = start + exportPaginationNumber;
    let dataToExport = exportSearchData.slice(start, end);
    let isSingleFileExport = (dataToExport.length == exportTotalRows);

    if (! dataToExport.length) { // no search data, get from DB
        if (storeFilter === "") {
            // no filter
            if (exportTotalRows > exportPaginationNumber) {
                await indb.getAllAssetsByPage(db, 1, exportPaginationNumber).then((assets) => {
                    dataToExport = assets;
                    isSingleFileExport = false;
                });
            }
            else {
                await indb.getAllAssets(db).then((assets) => {
                    dataToExport = assets;
                });
            }

        } else {
            if (exportTotalRows > exportPaginationNumber) {
                await indb.getAssetsByStoreByPage(db, storeFilter, 1, exportPaginationNumber).then((assets) => {
                    dataToExport = assets;
                    isSingleFileExport = false;
                });
            }
            else {
                await indb.getAssetsByStore(db, storeFilter).then((assets) => {
                    dataToExport = assets;
                });
            }
        }
    }

    const fileBaseName = isSingleFileExport ? `game_assets_export` : `game_assets_export_part${fileIndex + 1}`;
    exportFormat = document.getElementById('exporter-select').value;
    if (exportFormat === 'csv') {
        const csvText = await csv.format(dataToExport);
        const filename = `${fileBaseName}.csv`;
        csv.download(csvText, filename);
    }
    else if (exportFormat === 'excel') {
        const workbook = await excel.format(dataToExport);
        const filename = `${fileBaseName}.xlsx`;
        excel.download(workbook, filename);
    }
    else if (exportFormat === 'json') {
        const jsonText = await json.format(dataToExport);
        const filename = `${fileBaseName}.json`;
        json.download(jsonText, filename);
    }
    else if (exportFormat === 'text') {
        const textData = await text.format(dataToExport);
        const filename = `${fileBaseName}.txt`;
        text.download(textData, filename);
    }
}