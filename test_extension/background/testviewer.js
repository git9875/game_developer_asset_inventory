import * as indb from "./db.mjs";
const db = await indb.openDatabase();


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
const storeNames = [ "3D Shards", "CGTrader", "Daz3D", "Fab Quixel Megascans", "Fab Unreal", "Gumroad", "KitBash3d", "Leartes Studios", "Ovani Sound", "RenderHub", "Blender", "Synty", "TurboSquid", "Unity" ];


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

    let lastGroupTimestamp = null;
    const rows = [];

    for (const item of pageData) {
        if (lastGroupTimestamp !== null && item.groupTimestamp !== lastGroupTimestamp) {
            // insert a blank row for visual separation
            rows.push('<tr class="blank-row"><td colspan="7"></td></tr>');
        }
        lastGroupTimestamp = item.groupTimestamp;

        rows.push(`
        <tr>
            <td>${item.assetStoreKey.replace(/_/g, ' ')}</td>
            <td>${item.testName}</td>
            <td class="${item.pass ? 'passed' : 'failed'}">${item.pass ? 'Yes' : 'No'}</td>
            <td>${item.details}</td>
            <td>${item.timestamp}</td>
            <td>${item.groupTimestamp}</td>
        </tr>
        `);
    }

    tbody.innerHTML = rows.join('\n');
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
        paginationHtml.push(`<a class="page-links ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</a>`);
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
            await indb.getAllTestsByPage(db, page, rowsPerPage).then((assets) => {
                currentData = assets;
                // console.log(`(goToPage) Loaded ${assets.length} assets for page ${page}`, currentData);
            });
        } else {
            await indb.getTestsByStoreByPage(db, storeFilter, page, rowsPerPage).then((assets) => {
                currentData = assets;
            });
        }
    }

    filteredData = currentData;

    currentPage = page;
    renderTable();
    renderPagination();
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



async function handleStoreFilterChange() {
    storeFilter = document.getElementById('store-select').value;
    itemCount = await getDbRowCount();

    if (storeFilter === "") {
        // no filter
        await indb.getAllTestsByPage(db, 1, rowsPerPage).then((assets) => {
            currentData = assets;
        });

    } else {
        // console.log(`dbviewer Loading tests for store "${storeFilter}" with pagination, 1, ${rowsPerPage}`);
        await indb.getTestsByStoreByPage(db, storeFilter, 1, rowsPerPage).then((assets) => {
            currentData = assets;
            // console.log(`dbviewer Loaded ${assets.length} tests for store "${storeFilter}"`);
        });
    }

    applyFilter();
    setPrePagination(itemCount);
    currentPage = 1;
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
        option.textContent = storeName.replace(/_/g, ' ');
        storeSelect.appendChild(option);
    }

    await indb.countTests(db).then((count) => {
        // console.log(`Total tests in DB: ${count}`);
        itemCount = count;
    });

    await indb.getAllTestsByPage(db, 1, rowsPerPage).then((assets) => {
        currentData = assets;
    });

    filteredData = currentData;
    setPrePagination(itemCount);
    renderTable();
    renderPagination();
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
        return await indb.textSearchOnTestTitle(db, searchTerm);
    } else {
        return await indb.textSearchOnTestTitleByStore(db, searchTerm, storeName);
    }
}

async function getDbRowCount() {
    if (storeFilter === "") {
        return await indb.countTests(db);
    } else {
        return await indb.countTestsByStore(db, storeFilter);
    }
}

