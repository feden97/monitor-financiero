/**
 * Financial Opportunities Tracker - Core Logic
 */

const CONFIG = {
    REFRESH_INTERVAL: 5000,
    ENDPOINTS: {
        ARG_STOCKS: 'https://data912.com/live/arg_stocks',
        ARG_CEDEARS: 'https://data912.com/live/arg_cedears',
        USA_STOCKS: 'https://data912.com/live/usa_stocks',
        USA_ADRS: 'https://data912.com/live/usa_adrs'
    },
    MARKET_HOURS: {
        START: '10:20',
        END: '17:05',
        TIMEZONE: 'America/Argentina/Buenos_Aires'
    }
};

let marketData = {
    stocks: [],
    cedears: [],
    usaStocks: [],
    usaAdrs: [],
    calculatedResults: []
};

let lastUpdateTime = null;
let countdownInterval = null;
let refreshTimeout = null;
let currentFilter = 'all';
let currentSort = {
    column: 'ccl',
    direction: 'asc' // 'asc' or 'desc'
};

/**
 * Initialization
 */
document.addEventListener('DOMContentLoaded', () => {
    initFilters();
    initSearch();
    initSort();
    startApp();
});

function initFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderTable();
        });
    });
}

function initSearch() {
    const searchInput = document.getElementById('ticker-search');
    searchInput.addEventListener('input', (e) => {
        renderTable(e.target.value.toUpperCase());
    });
}

function initSort() {
    const sortableHeaders = document.querySelectorAll('th.sortable');
    sortableHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const column = header.dataset.sort;
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'asc';
            }
            
            // Update UI indicators
            sortableHeaders.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
            header.classList.add(`sort-${currentSort.direction}`);
            
            renderTable();
        });
    });
}

async function startApp() {
    await updateData();
    startCountdown();
}

/**
 * Time Logic
 */
function isMarketOpen() {
    const now = new Date();
    const argTime = new Intl.DateTimeFormat('en-US', {
        timeZone: CONFIG.MARKET_HOURS.TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(now);

    const [hours, minutes] = argTime.split(':').map(Number);
    const [startH, startM] = CONFIG.MARKET_HOURS.START.split(':').map(Number);
    const [endH, endM] = CONFIG.MARKET_HOURS.END.split(':').map(Number);

    const currentTimeMinutes = hours * 60 + minutes;
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    // Check if it's weekend (0 = Sunday, 6 = Saturday)
    // Note: Documentation didn't specify excluding weekends, but usually markets are closed.
    // I'll stick to the time constraint provided first.
    return currentTimeMinutes >= startMinutes && currentTimeMinutes <= endMinutes;
}

/**
 * Data Fetching & Processing
 */
async function fetchData(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error(`Fetch error for ${url}:`, error);
        return [];
    }
}

async function updateData() {
    if (!isMarketOpen()) {
        console.log("Market is closed. Skipping refresh.");
        updateLastUpdateTime("Market Closed");
        showMarketClosedOverlay();
        return;
    }

    try {
        // Parallel fetching for performance
        const [argStocks, argCedears, usaStocks, usaAdrs] = await Promise.all([
            fetchData(CONFIG.ENDPOINTS.ARG_STOCKS),
            fetchData(CONFIG.ENDPOINTS.ARG_CEDEARS),
            fetchData(CONFIG.ENDPOINTS.USA_STOCKS),
            fetchData(CONFIG.ENDPOINTS.USA_ADRS)
        ]);

        marketData.stocks = argStocks;
        marketData.cedears = argCedears;
        marketData.usaStocks = usaStocks;
        marketData.usaAdrs = usaAdrs;

        processCalculations();
        renderAll();
        updateLastUpdateTime();
    } catch (error) {
        console.error("Error updating data:", error);
    }
}

function showMarketClosedOverlay() {
    const body = document.getElementById('table-body');
    if (body.children.length === 0) {
        body.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 3rem; color: var(--text-secondary);">
            <div style="font-size: 1.2rem; margin-bottom: 0.5rem;">🌙 Market is currently closed</div>
            <p style="font-size: 0.9rem; opacity: 0.7;">Scanner runs between 10:20 and 17:05 ART</p>
        </td></tr>`;
    }
}

function processCalculations() {
    const results = [];

    // 1. Process Stocks with ADRs
    mappings.stocks.forEach(mapping => {
        const localAct = marketData.stocks.find(s => s.symbol === mapping.local);
        const adrAct = marketData.usaAdrs.find(a => a.symbol === mapping.adr);

        if (localAct && adrAct && adrAct.c > 0) {
            const ccl = (localAct.c * mapping.ratio) / adrAct.c;
            results.push({
                ticker: mapping.local,
                type: 'Stock',
                priceARS: localAct.c,
                priceUSD: adrAct.c,
                ratio: mapping.ratio,
                ccl: ccl
            });
        }
    });

    // 2. Process CEDEARs
    mappings.cedears.forEach(mapping => {
        const localAct = marketData.cedears.find(c => c.symbol === mapping.local);
        let usaAct = marketData.usaStocks.find(u => u.symbol === mapping.usa);
        
        // Fallback to ADRs if not in USA Stocks
        if (!usaAct) {
            usaAct = marketData.usaAdrs.find(a => a.symbol === mapping.usa);
        }

        if (localAct && usaAct && usaAct.c > 0) {
            const ccl = (localAct.c * mapping.ratio) / usaAct.c;
            results.push({
                ticker: mapping.local,
                type: 'CEDEAR',
                priceARS: localAct.c,
                priceUSD: usaAct.c,
                ratio: mapping.ratio,
                ccl: ccl
            });
        }
    });

    marketData.calculatedResults = results;
}

/**
 * Rendering Logic
 */
function renderAll() {
    renderOpportunities();
    renderTable();
}

function renderOpportunities() {
    const results = [...marketData.calculatedResults];
    if (results.length === 0) return;

    // Filter out outliers if necessary (e.g., CCL > 5000 or < 500, check current market reality)
    // For now, just sort
    const sorted = results.sort((a, b) => a.ccl - b.ccl);
    
    const lowest = sorted.slice(0, 10);
    const highest = sorted.slice(-10).reverse();

    updateCCLList('lowest-ccl', lowest, 'good');
    updateCCLList('highest-ccl', highest, 'bad');
}

function updateCCLList(elementId, items, statusClass) {
    const container = document.getElementById(elementId);
    container.innerHTML = '';
    
    items.forEach(item => {
        const div = document.createElement('div');
        div.className = `ccl-item ${statusClass}`;
        div.innerHTML = `
            <span class="ticker">${item.ticker}</span>
            <span class="ccl-value">$${item.ccl.toFixed(2)}</span>
        `;
        container.appendChild(div);
    });
}

function renderTable(searchTerm = '') {
    const body = document.getElementById('table-body');
    body.innerHTML = '';

    let results = marketData.calculatedResults;

    // Apply Filter
    if (currentFilter === 'stocks') {
        results = results.filter(r => r.type === 'Stock');
    } else if (currentFilter === 'cedears') {
        results = results.filter(r => r.type === 'CEDEAR');
    }

    // Apply Search
    if (searchTerm) {
        results = results.filter(r => r.ticker.includes(searchTerm));
    }

    // Apply Sort
    results.sort((a, b) => {
        const valA = a[currentSort.column];
        const valB = b[currentSort.column];
        return currentSort.direction === 'asc' ? valA - valB : valB - valA;
    });

    results.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="ticker-cell">${item.ticker}</td>
            <td style="color: var(--text-secondary); font-size: 0.8rem;">${item.type}</td>
            <td class="price-cell">$${item.priceARS.toLocaleString()}</td>
            <td class="price-cell">$${item.priceUSD.toFixed(2)}</td>
            <td style="font-size: 0.8rem; opacity: 0.7;">${item.ratio}:1</td>
            <td class="ccl-cell">$${item.ccl.toFixed(2)}</td>
        `;
        body.appendChild(tr);
    });
}

function updateLastUpdateTime(msg) {
    const now = new Date();
    const timeStr = msg || now.toLocaleTimeString();
    document.getElementById('last-update').textContent = timeStr;
    lastUpdateTime = now;
}

/**
 * Refresh & Timer Logic
 */
function startCountdown() {
    let timeLeft = CONFIG.REFRESH_INTERVAL / 1000;
    const countdownEl = document.getElementById('countdown');
    const progressBar = document.getElementById('progress-bar');

    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        timeLeft -= 1;
        countdownEl.textContent = `${timeLeft}s`;
        
        const progress = ((CONFIG.REFRESH_INTERVAL / 1000 - timeLeft) / (CONFIG.REFRESH_INTERVAL / 1000)) * 100;
        progressBar.style.width = `${progress}%`;

        if (timeLeft <= 0) {
            timeLeft = CONFIG.REFRESH_INTERVAL / 1000;
            updateData();
        }
    }, 1000);
}
