/**
 * Financial Opportunities Tracker - Core Logic
 */

const CONFIG = {
    REFRESH_INTERVAL: 5000,
    ENDPOINTS: {
        ARG_STOCKS: 'https://data912.com/live/arg_stocks',
        ARG_CEDEARS: 'https://data912.com/live/arg_cedears',
        USA_STOCKS: 'https://data912.com/live/usa_stocks',
        USA_ADRS: 'https://data912.com/live/usa_adrs',
        CCL_API: 'https://data912.com/live/ccl'
    },
    MARKET_HOURS: {
        START: '10:20',
        END: '17:05',
        TIMEZONE: 'America/Argentina/Buenos_Aires'
    },
    SUMMARY_TICKERS: ['AAPL', 'AMZN', 'SPY', 'NVDA', 'KO', 'MSFT']
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
let activeTab = 'cedear-usa';
let cclApiData = [];
let apiSearchTerm = '';
let currentApiSort = {
    column: 'CCL_mark',
    direction: 'asc'
};
let currentSort = {
    column: 'ccl',
    direction: 'asc' // 'asc' or 'desc'
};

/**
 * Initialization
 */
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initFilters();
    initSearch();
    initSort();
    startApp();
});

function initTabs() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeTab = tab.dataset.tab;
            
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(`tab-${activeTab}`).classList.add('active');
            
            // Re-render based on tab
            if (activeTab === 'cedear-usa') {
                renderAll();
            } else {
                renderApiAll();
            }
        });
    });
}

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
    const apiSearchInput = document.getElementById('api-ticker-search');
    
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            renderTable(e.target.value.toUpperCase());
        });
    }

    if (apiSearchInput) {
        apiSearchInput.addEventListener('input', (e) => {
            apiSearchTerm = e.target.value.toUpperCase();
            renderApiTable();
        });
    }
}

function initSort() {
    const allSortableHeaders = document.querySelectorAll('th.sortable');
    allSortableHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const column = header.dataset.sort;
            const isApiTable = header.closest('#api-table') !== null;
            
            if (isApiTable) {
                if (currentApiSort.column === column) {
                    currentApiSort.direction = currentApiSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    currentApiSort.column = column;
                    currentApiSort.direction = 'asc';
                }
                updateSortIndicators('api-table', currentApiSort);
                renderApiTable();
            } else {
                if (currentSort.column === column) {
                    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSort.column = column;
                    currentSort.direction = 'asc';
                }
                updateSortIndicators('main-table', currentSort);
                renderTable();
            }
        });
    });
}

function updateSortIndicators(tableId, sortState) {
    const headers = document.querySelectorAll(`#${tableId} th.sortable`);
    headers.forEach(h => {
        h.classList.remove('sort-asc', 'sort-desc');
        if (h.dataset.sort === sortState.column) {
            h.classList.add(`sort-${sortState.direction}`);
        }
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
        const [argStocks, argCedears, usaStocks, usaAdrs, cclRawData] = await Promise.all([
            fetchData(CONFIG.ENDPOINTS.ARG_STOCKS),
            fetchData(CONFIG.ENDPOINTS.ARG_CEDEARS),
            fetchData(CONFIG.ENDPOINTS.USA_STOCKS),
            fetchData(CONFIG.ENDPOINTS.USA_ADRS),
            fetchData(CONFIG.ENDPOINTS.CCL_API)
        ]);

        marketData.stocks = argStocks;
        marketData.cedears = argCedears;
        marketData.usaStocks = usaStocks;
        marketData.usaAdrs = usaAdrs;
        cclApiData = cclRawData;

        processCalculations();
        renderAll();
        renderApiAll();
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
    renderSummaryTable();
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

/**
 * CCL API Rendering
 */
function renderApiAll() {
    renderSummaryTable();
    renderApiOpportunities();
    renderApiTable();
}

function renderSummaryTable() {
    const body = document.getElementById('summary-table-body');
    if (!body) return;
    body.innerHTML = '';

    let totalCedear = 0;
    let totalApi = 0;
    let countCedear = 0;
    let countApi = 0;

    CONFIG.SUMMARY_TICKERS.forEach(ticker => {
        const tr = document.createElement('tr');
        
        // Data from Calculated (CEDEAR/USA)
        const cedearData = marketData.calculatedResults.find(r => r.ticker === ticker);
        const cclCedear = cedearData ? cedearData.ccl : null;
        
        // Data from API
        const apiData = cclApiData.find(r => r.ticker_ar === ticker);
        const cclApi = apiData ? apiData.CCL_mark : null;

        if (cclCedear) {
            totalCedear += cclCedear;
            countCedear++;
        }
        if (cclApi) {
            totalApi += cclApi;
            countApi++;
        }

        tr.innerHTML = `
            <td class="ticker-cell">${ticker}</td>
            <td class="price-cell">${cclCedear ? '$' + cclCedear.toFixed(2) : '--'}</td>
            <td class="price-cell">${cclApi ? '$' + cclApi.toFixed(2) : '--'}</td>
        `;
        body.appendChild(tr);
    });

    // Update Footer Averages
    const avgCedearEl = document.getElementById('avg-cedear');
    const avgApiEl = document.getElementById('avg-api');

    if (countCedear > 0) {
        avgCedearEl.textContent = '$' + (totalCedear / countCedear).toFixed(2);
    } else {
        avgCedearEl.textContent = '--';
    }

    if (countApi > 0) {
        avgApiEl.textContent = '$' + (totalApi / countApi).toFixed(2);
    } else {
        avgApiEl.textContent = '--';
    }
}

function renderApiOpportunities() {
    if (!cclApiData || cclApiData.length === 0) return;

    const cheaplySorted = [...cclApiData].sort((a, b) => a.CCL_bid - b.CCL_bid);
    const expensivelySorted = [...cclApiData].sort((a, b) => b.CCL_mark - a.CCL_mark);
    
    const cheapest = cheaplySorted.slice(0, 10);
    const expensive = expensivelySorted.slice(0, 10);

    const lowestContainer = document.getElementById('api-lowest-ccl');
    const highestContainer = document.getElementById('api-highest-ccl');
    
    if (!lowestContainer || !highestContainer) return;

    lowestContainer.innerHTML = '';
    highestContainer.innerHTML = '';

    cheapest.forEach(item => {
        const div = document.createElement('div');
        div.className = 'ccl-item good';
        div.innerHTML = `
            <span class="ticker">${item.ticker_ar}</span>
            <span class="ccl-value">Bid: $${item.CCL_bid.toFixed(2)} | Mark: $${item.CCL_mark.toFixed(2)}</span>
        `;
        lowestContainer.appendChild(div);
    });

    expensive.forEach(item => {
        const div = document.createElement('div');
        div.className = 'ccl-item bad';
        div.innerHTML = `
            <span class="ticker">${item.ticker_ar}</span>
            <span class="ccl-value">Mark: $${item.CCL_mark.toFixed(2)} | Ask: $${item.CCL_ask.toFixed(2)}</span>
        `;
        highestContainer.appendChild(div);
    });
}

function renderApiTable() {
    const body = document.getElementById('api-table-body');
    if (!body) return;
    body.innerHTML = '';

    let results = [...cclApiData];

    // Apply Search
    if (apiSearchTerm) {
        results = results.filter(r => 
            r.ticker_ar.toUpperCase().includes(apiSearchTerm) || 
            r.ticker_usa.toUpperCase().includes(apiSearchTerm)
        );
    }

    // Apply Sort
    results.sort((a, b) => {
        const valA = a[currentApiSort.column];
        const valB = b[currentApiSort.column];
        return currentApiSort.direction === 'asc' ? valA - valB : valB - valA;
    });

    results.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="ticker-cell">${item.ticker_ar}</td>
            <td style="color: var(--text-secondary);">${item.ticker_usa}</td>
            <td class="price-cell">$${item.CCL_bid.toFixed(2)}</td>
            <td class="ccl-cell">$${item.CCL_mark.toFixed(2)}</td>
            <td class="price-cell">$${item.CCL_ask.toFixed(2)}</td>
            <td class="price-cell">$${item.ars_volume.toLocaleString()}</td>
            <td style="font-size: 0.8rem; opacity: 0.7;">${item.arg_panel}/${item.usa_panel}</td>
        `;
        body.appendChild(tr);
    });
}
