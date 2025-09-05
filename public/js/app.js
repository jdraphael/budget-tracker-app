// app.js - Budget Tracker Main JS
import { setupTabNavigation, switchTab } from './components/tabNavigation.js';
import { parseCSV, calculateTotals } from './utils/dataHelpers.js';

// Resolve and fetch asset files robustly across different hosting setups
async function fetchCSVText(fileName) {
    const candidates = [];
    // Prefer new public data locations under static root
    candidates.push(`./data/${fileName}`);
    candidates.push(`/data/${fileName}`);
    try { candidates.push(new URL(`./data/${fileName}`, document.baseURI).href); } catch {}
    try { candidates.push(new URL(`./data/${fileName}`, import.meta.url).href); } catch {}
    // Back-compat fallbacks for legacy assets path
    candidates.push(`../assets/${fileName}`);
    candidates.push(`./assets/${fileName}`);
    candidates.push(`/assets/${fileName}`);
    try { candidates.push(new URL(`../assets/${fileName}`, document.baseURI).href); } catch {}
    try { candidates.push(new URL(`../assets/${fileName}`, import.meta.url).href); } catch {}
    // Deduplicate while preserving order
    const tried = new Set();
    for (const url of candidates) {
        if (!url || tried.has(url)) continue; tried.add(url);
        try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res.ok) return await res.text();
        } catch (e) {
            // continue to next candidate
        }
    }
    // Fallback: inline seeds in the HTML (for file:// usage)
    const idMap = {
        'bills.csv': 'seed-bills-csv',
        'income.csv': 'seed-income-csv',
        'transactions.csv': 'seed-transactions-csv',
        'categories.csv': 'seed-categories-csv',
        'budgets.csv': 'seed-budgets-csv',
    };
    const seedId = idMap[fileName];
    if (seedId) {
        const el = document.getElementById(seedId);
        if (el && el.textContent) {
            console.warn(`Using inline seed for ${fileName}`);
            return el.textContent;
        }
    }
    throw new Error(`Unable to load ${fileName} from candidates: ${Array.from(tried).join(', ')}`);
}

// Luxon for date manipulation
const DateTime = luxon.DateTime;

// Expose state so modular submodules (like src/bills.js) can access it
const state = {
    activeTab: 'dashboard',
    currentMonth: DateTime.now().toFormat('yyyy-MM'),
    data: {
        bills: [],
        income: [],
        transactions: [],
        categories: [],
        budgets: []
    },
    uiState: {
        searchQuery: '',
    folderHandle: null,
    // Per-tab filters and grid-edit mode
    filters: {},
    gridEditTabs: {}
    }
};
// Keep active Chart instances so we can destroy them before reusing canvases
state.charts = {};
// Make global for modules
window.state = state;

// (updateStickyOffsets is defined later in the file; duplicate removed)

// Charts: Render summary charts for each tab
function renderTabCharts(tab, columns, data) {
    const section = document.getElementById(tab);
    let chartDiv = section.querySelector('.tab-chart');
    if (!chartDiv) {
        chartDiv = document.createElement('div');
        chartDiv.className = 'tab-chart';
        chartDiv.style = 'margin-bottom:2rem;';
        section.insertBefore(chartDiv, section.querySelector('.analytics-bar'));
    }
    chartDiv.innerHTML = '';
    if (data.length && columns.includes('amount')) {
        const canvasId = `${tab}-chart`;
        chartDiv.innerHTML = `<canvas id='${canvasId}' style='max-width:600px;max-height:300px;'></canvas>`;
        // Destroy existing chart instance if present
        if (state.charts[canvasId]) {
            try { state.charts[canvasId].destroy(); } catch (e) { /* ignore */ }
            delete state.charts[canvasId];
        }
        const ctx = document.getElementById(canvasId).getContext('2d');
        state.charts[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(i => i[columns[0]]),
                datasets: [{
                    label: 'Amount',
                    data: data.map(i => Number(i.amount)),
                    backgroundColor: '#60a5fa'
                }]
            },
            options: { responsive: true, plugins: { legend: { display: false } } }
        });
    }
}

// Import CSV
function importCSV(tab, columns) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async function() {
        const file = input.files[0];
        if (!file) return;
        const text = await file.text();
        // Use shared CSV parser for consistency and trimming/number handling
        const parsed = parseCSV(text) || [];
        // Ensure each row has an id for downstream editing/deleting even if CSV lacks one
        const timestamp = Date.now();
        const items = parsed.map((row, idx) => {
            const hasId = Object.prototype.hasOwnProperty.call(row, 'id') && String(row.id).trim() !== '';
            return hasId ? row : { id: `${timestamp}_${idx}`, ...row };
        });
        state.data[tab] = items;
        if (tab === 'bills') { saveBillsToCSV(); renderBillsList(); }
        if (tab === 'income') { saveIncomeToCSV(); renderIncomeList(); }
        if (tab === 'transactions') { saveTransactionsToCSV(); renderTransactionsList(); }
        if (tab === 'budgets') { saveBudgetsToCSV(); renderBudgetsList(); }
        if (tab === 'categories') { saveCategoriesToCSV(); renderCategoriesList(); }
        alert('Import complete!');
    };
    input.click();
}

// Undo: Keep a history stack
let undoStack = [];
function pushUndo(tab) {
    undoStack.push({ tab, data: JSON.parse(JSON.stringify(state.data[tab])) });
    if (undoStack.length > 20) undoStack.shift();
}
function undoLastAction() {
    if (!undoStack.length) return alert('Nothing to undo.');
    const last = undoStack.pop();
    state.data[last.tab] = last.data;
    if (last.tab === 'bills') { saveBillsToCSV(); renderBillsList(); }
    if (last.tab === 'income') { saveIncomeToCSV(); renderIncomeList(); }
    if (last.tab === 'transactions') { saveTransactionsToCSV(); renderTransactionsList(); }
    if (last.tab === 'budgets') { saveBudgetsToCSV(); renderBudgetsList(); }
    if (last.tab === 'categories') { saveCategoriesToCSV(); renderCategoriesList(); }
    alert('Undo complete!');
}

// User accounts (simple local demo)
function showUserLogin() {
    let loginDiv = document.getElementById('user-login');
    if (!loginDiv) {
        loginDiv = document.createElement('div');
        loginDiv.id = 'user-login';
        loginDiv.style = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
        loginDiv.innerHTML = `<div class='card' style='min-width:320px;max-width:90vw;'><h2>Sign In</h2><form id='login-form'><div class='form-group'><label>Username</label><input type='text' id='login-username' required></div><div class='form-group'><label>Password</label><input type='password' id='login-password' required></div><div class='btn-group'><button type='submit' class='btn'>Login</button></div></form></div>`;
        document.body.appendChild(loginDiv);
    }
    document.getElementById('login-form').onsubmit = function(e) {
        e.preventDefault();
        const user = document.getElementById('login-username').value;
        const pass = document.getElementById('login-password').value;
        localStorage.setItem('budgetAppUser', JSON.stringify({ user, pass }));
        loginDiv.style.display = 'none';
        alert('Logged in as ' + user);
    };
}
function checkUserLogin() {
    const user = localStorage.getItem('budgetAppUser');
    if (!user) showUserLogin();
}
// Call checkUserLogin on load and load CSV data

document.addEventListener('DOMContentLoaded', async function() {
    checkUserLogin();
    // Load CSV data from assets so UI has data to render
    await loadAllData();
    // Immediately render Bills once after data load so the table appears without any extra clicks
    try { if (typeof renderBillsList === 'function') renderBillsList(); } catch {}

    // Run on initial load and after a short delay to ensure elements are rendered
    requestAnimationFrame(updateStickyOffsets);
    setTimeout(updateStickyOffsets, 100); // Fallback for any rendering delays
    window.addEventListener('resize', updateStickyOffsets);
    window.addEventListener('scroll', updateStickyOffsets, { passive: true });
    // Update sticky offsets when tab changes (if you have tab switching logic)
    document.addEventListener('tabchange', updateStickyOffsets);

    // Initialize UI and tab navigation
    setupTabNavigation();
    // Optional: an advanced Bills module exists, but it expects different data shape.
    // To keep the CSV-driven bills table working out-of-the-box, skip loading it by default.
    const USE_ADVANCED_BILLS = false;
    if (USE_ADVANCED_BILLS) {
        try {
            const mod = await import('./bills.js');
            if (mod && typeof mod.default === 'function') mod.default({ containerId: 'bills' });
        } catch (e) { console.warn('Bills module failed to load', e); }
    }
    // Wire interactive controls
    try { setupEventListeners(); } catch {}
    window.onTabSwitch = function(tabId) {
        if (tabId === 'dashboard') renderCharts();
        if (tabId === 'bills') renderBillsList();
        if (tabId === 'income') renderIncomeList();
        if (tabId === 'transactions') renderTransactionsList();
        if (tabId === 'budgets') renderBudgetsList();
        if (tabId === 'categories') renderCategoriesList();
        if (tabId === 'settings') {/* settings logic */}
    };
    // Load UI prefs (may change active tab)
    loadUIPreferences();
    // Ensure initial tab is visible
    switchTab(state.activeTab || 'dashboard');
    if (!('showDirectoryPicker' in window)) {
        try { showExportBannerTimed(5000); } catch { const el = document.getElementById('export-banner'); if (el) el.classList.remove('hidden'); }
    }
});

// Utility: Render table for a tab
function renderTable(tab, columns, data, actions, sortKeys = [{key:columns[0],dir:'asc'}], filter = {}, search = '') {
    addBulkActionsUI(tab, columns);
    renderAnalytics(tab, columns, data);
    // 1) Only current month data
    let filtered = filterToCurrentMonth(tab, data);
    // 2) Apply saved per-column filters
    const savedFilters = state.uiState.filters[tab] || {};
    filter = { ...savedFilters, ...filter };
    Object.keys(filter).forEach(key => {
        const val = (filter[key] || '').trim();
        if (val) {
            const v = val.toLowerCase();
            filtered = filtered.filter(item => String(item[key] ?? '').toLowerCase().includes(v));
        }
    });
    if (search) {
        filtered = filtered.filter(item => columns.some(col => String(item[col]).toLowerCase().includes(search.toLowerCase())));
    }
    let sorted = multiColumnSort(filtered, sortKeys);
    const section = document.getElementById(tab);
    let tableDiv = section.querySelector('.table-container.' + tab + '-table');
    if (!tableDiv) {
        tableDiv = document.createElement('div');
        tableDiv.className = `table-container ${tab}-table`;
        section.appendChild(tableDiv);
    }
    const inGridEdit = !!state.uiState.gridEditTabs[tab];
    let html = `<div class="table-toolbar">
        <button class="btn btn-sm ${inGridEdit ? '' : 'btn-outline'} toggle-grid">${inGridEdit ? 'Done' : 'Edit Grid'}</button>
        <button class="btn btn-sm btn-outline clear-filters">Clear Filters</button>
    </div>`;
    html += `<table><thead><tr><th><input type='checkbox' class='select-all'></th>`;
    columns.forEach(col => {
        const label = col.charAt(0).toUpperCase() + col.slice(1);
        const currentFilterVal = filter[col] || '';
        html += `<th data-sort="${col}">
            <div class="th-inner">
              <span class="th-label">${label}</span>
              <span class="th-sort" title="Sort">⇅</span>
              <div class="th-filter">
                <input class="th-filter-input" data-col="${col}" type="text" placeholder="Filter" value="${currentFilterVal}">
              </div>
            </div>
        </th>`;
    });
    html += `<th>Actions</th></tr></thead><tbody>`;
    if (sorted.length === 0) {
        html += `<tr><td colspan='${columns.length + 2}' style='text-align:center;color:var(--fg-300);'>No data yet.</td></tr>`;
    } else {
        for (const item of sorted) {
            html += `<tr data-id="${item.id}"><td><input type='checkbox' class='row-checkbox'></td>`;
            columns.forEach(col => {
                const raw = item[col] ?? '';
                const display = col === 'amount' && raw !== '' ? formatCurrency(Number(raw)) : raw || '';
                if (inGridEdit) {
                    html += `<td data-col="${col}"><div class="cell-edit" contenteditable="true" spellcheck="false">${escapeHtml(String(raw))}</div></td>`;
                } else {
                    html += `<td>${display || '-'}</td>`;
                }
            });
            html += `<td>`;
            actions.forEach(act => {
                html += `<button class="btn btn-sm btn-outline ${act}-row">${act.charAt(0).toUpperCase() + act.slice(1)}</button> `;
            });
            html += `</td></tr>`;
        }
    }
    html += `</tbody></table>`;
    tableDiv.innerHTML = html;
    // Toolbar handlers
    const toggleBtn = tableDiv.querySelector('.toggle-grid');
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            if (state.uiState.gridEditTabs[tab]) {
                // Save edits before exit
                persistGridEdits(tab, columns, data, tableDiv);
                delete state.uiState.gridEditTabs[tab];
            } else {
                state.uiState.gridEditTabs[tab] = true;
            }
            renderTable(tab, columns, data, actions, sortKeys, filter, search);
        };
    }
    const clearFiltersBtn = tableDiv.querySelector('.clear-filters');
    if (clearFiltersBtn) {
        clearFiltersBtn.onclick = () => {
            state.uiState.filters[tab] = {};
            renderTable(tab, columns, data, actions, sortKeys, {}, '');
        };
    }
    // Select all
    tableDiv.querySelector('.select-all').onchange = function() {
        tableDiv.querySelectorAll('.row-checkbox').forEach(cb => { cb.checked = this.checked; });
    };
    // Sorting
    let currentSortKeys = [...sortKeys];
    tableDiv.querySelectorAll('th[data-sort]').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', (e) => {
            // Ignore clicks inside filter input
            if (e.target && (e.target.closest('.th-filter') || e.target.classList.contains('th-filter-input'))) return;
            const col = th.getAttribute('data-sort');
            let found = currentSortKeys.find(s => s.key === col);
            if (found) {
                found.dir = found.dir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortKeys = [{ key: col, dir: 'asc' }];
            }
            renderTable(tab, columns, data, actions, currentSortKeys, filter, search);
        });
    });
    // Column filters
    tableDiv.querySelectorAll('.th-filter-input').forEach(inp => {
        inp.addEventListener('input', (e) => {
            const col = inp.getAttribute('data-col');
            state.uiState.filters[tab] = state.uiState.filters[tab] || {};
            state.uiState.filters[tab][col] = inp.value;
            renderTable(tab, columns, data, actions, sortKeys, state.uiState.filters[tab], search);
        });
    });
    // Edit/Delete
    tableDiv.querySelectorAll('.edit-row').forEach(btn => {
        btn.onclick = function() {
            const id = this.closest('tr').getAttribute('data-id');
            openEditModal(tab, id);
        };
    });
    tableDiv.querySelectorAll('.delete-row').forEach(btn => {
        btn.onclick = function() {
            const id = this.closest('tr').getAttribute('data-id');
            deleteRow(tab, id);
        };
    });
    // Grid edit: handle Enter to save cell and move down, Esc to revert
    if (inGridEdit) {
        tableDiv.querySelectorAll('.cell-edit').forEach(cell => {
            cell.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleCellCommit(cell, true); }
                if (e.key === 'Escape') { e.preventDefault(); handleCellRevert(cell); }
            });
            cell.addEventListener('blur', () => handleCellCommit(cell, false));
        });
    }
}

// Multi-column sort
function multiColumnSort(data, sortKeys) {
    return [...data].sort((a, b) => {
        for (const { key, dir } of sortKeys) {
            let cmp;
            if (typeof a[key] === 'number') {
                cmp = a[key] - b[key];
            } else {
                cmp = String(a[key]).localeCompare(String(b[key]));
            }
            if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
        }
        return 0;
    });
}

// Helpers
function filterToCurrentMonth(tab, data) {
    const ym = state.currentMonth; // 'yyyy-MM'
    const monthStart = DateTime.fromFormat(ym + '-01', 'yyyy-MM-dd');
    const monthEnd = monthStart.endOf('month');
    if (tab === 'bills') {
        // New schema: filter by Due_Date or Paid_Date falling in current month
        return data.filter(item => {
            const due = item.Due_Date ? DateTime.fromISO(String(item.Due_Date)) : null;
            const paid = item.Paid_Date ? DateTime.fromISO(String(item.Paid_Date)) : null;
            const inDue = due && due.isValid && due >= monthStart && due <= monthEnd;
            const inPaid = paid && paid.isValid && paid >= monthStart && paid <= monthEnd;
            return Boolean(inDue || inPaid);
        });
    }
    if (tab === 'income' || tab === 'transactions') {
        return data.filter(item => String(item.date || '').startsWith(ym));
    }
    // Budgets and categories have no date column; show all
    return data;
}

function persistGridEdits(tab, columns, data, tableDiv) {
    const rows = Array.from(tableDiv.querySelectorAll('tbody tr'));
    const map = new Map(data.map(d => [String(d.id), d]));
    for (const tr of rows) {
        const id = tr.getAttribute('data-id');
        const model = map.get(String(id));
        if (!model) continue;
        const tds = Array.from(tr.querySelectorAll('td'));
        // Skip first cell (checkbox)
        for (let i = 1; i <= columns.length; i++) {
            const col = columns[i - 1];
            const td = tds[i];
            if (!td) continue;
            const editor = td.querySelector('.cell-edit');
            if (!editor) continue;
            const newVal = editor.innerText.trim();
            // Basic typing: numeric for amount, leave others as string
            if (col === 'amount') {
                model[col] = newVal === '' ? '' : Number(newVal);
            } else {
                model[col] = newVal;
            }
        }
    }
    // Persist per tab
    if (tab === 'bills' && typeof saveBillsToCSV === 'function') saveBillsToCSV();
    if (tab === 'income' && typeof saveIncomeToCSV === 'function') saveIncomeToCSV();
    if (tab === 'transactions' && typeof saveTransactionsToCSV === 'function') saveTransactionsToCSV();
    if (tab === 'budgets' && typeof saveBudgetsToCSV === 'function') saveBudgetsToCSV();
    if (tab === 'categories' && typeof saveCategoriesToCSV === 'function') saveCategoriesToCSV();
}

function handleCellCommit(cell, moveDown) {
    const tr = cell.closest('tr');
    const table = cell.closest('table');
    if (!tr || !table) return;
    // mark dirty visual could be added
    if (moveDown) {
        // Move focus to the editor in next row same column
        const td = cell.closest('td');
        const colIndex = Array.from(td.parentElement.children).indexOf(td);
        const next = tr.nextElementSibling;
        if (next) {
            const target = next.children[colIndex];
            const ed = target && target.querySelector('.cell-edit');
            if (ed) {
                setTimeout(() => {
                    ed.focus();
                    document.getSelection()?.selectAllChildren(ed);
                }, 0);
            }
        }
    }
}

function handleCellRevert(cell) {
    // No-op for now: could store original value in dataset
}

function escapeHtml(str) {
    return str.replace(/[&<>"]+/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
}

// Bulk actions
function addBulkActionsUI(tab, columns) {
    const section = document.getElementById(tab);
    let bulkDiv = section.querySelector('.bulk-bar');
    if (!bulkDiv) {
        bulkDiv = document.createElement('div');
        bulkDiv.className = 'bulk-bar';
        bulkDiv.style = 'margin-bottom:1rem;display:flex;gap:1rem;flex-wrap:wrap;';
        bulkDiv.innerHTML = `<button class='btn btn-outline bulk-delete'>Delete Selected</button>`;
        section.insertBefore(bulkDiv, section.querySelector('.filter-bar'));
    }
    bulkDiv.querySelector('.bulk-delete').onclick = function() {
        const checked = Array.from(section.querySelectorAll('.row-checkbox:checked')).map(cb => cb.closest('tr').getAttribute('data-id'));
        if (checked.length && confirm('Delete selected items?')) {
            if (tab === 'bills') {
                state.data.bills = state.data.bills.filter(i => !checked.includes(String(i.id)));
                saveBillsToCSV();
                renderBillsList();
            } else if (tab === 'income') {
                state.data.income = state.data.income.filter(i => !checked.includes(String(i.id)));
                saveIncomeToCSV();
                renderIncomeList();
            } else if (tab === 'transactions') {
                state.data.transactions = state.data.transactions.filter(i => !checked.includes(String(i.id)));
                saveTransactionsToCSV();
                renderTransactionsList();
            } else if (tab === 'budgets') {
                state.data.budgets = state.data.budgets.filter(i => !checked.includes(String(i.id)));
                saveBudgetsToCSV();
                renderBudgetsList();
            } else if (tab === 'categories') {
                state.data.categories = state.data.categories.filter(i => !checked.includes(String(i.id)));
                saveCategoriesToCSV();
                renderCategoriesList();
            }
        }
    };
}

// Analytics
function renderAnalytics(tab, columns, data) {
    const section = document.getElementById(tab);
    let analyticsDiv = section.querySelector('.analytics-bar');
    if (!analyticsDiv) {
        analyticsDiv = document.createElement('div');
        analyticsDiv.className = 'analytics-bar';
        analyticsDiv.style = 'margin-bottom:1rem;display:flex;gap:2rem;flex-wrap:wrap;';
        section.insertBefore(analyticsDiv, section.querySelector('.bulk-bar'));
    }
    let html = '';
    if (data.length) {
        if (columns.includes('amount')) {
            const total = data.reduce((sum, i) => sum + Number(i.amount || 0), 0);
            html += `<div><strong>Total Amount:</strong> ${formatCurrency(total)}</div>`;
            const avg = total / data.length;
            html += `<div><strong>Average:</strong> ${formatCurrency(avg)}</div>`;
            const max = Math.max(...data.map(i => Number(i.amount || 0)));
            html += `<div><strong>Max:</strong> ${formatCurrency(max)}</div>`;
            const min = Math.min(...data.map(i => Number(i.amount || 0)));
            html += `<div><strong>Min:</strong> ${formatCurrency(min)}</div>`;
        }
        html += `<div><strong>Count:</strong> ${data.length}</div>`;
    }
    analyticsDiv.innerHTML = html;
}

// Renderers for each tab
function renderIncomeList() {
    addFilterSearchUI('income', ['source','amount','date','recurrence','status']);
    renderAnalytics('income', ['source','amount','date','recurrence','status'], state.data.income);
    renderTabCharts('income', ['source','amount','date','recurrence','status'], state.data.income);
    renderTable('income', ['source','amount','date','recurrence','status'], state.data.income, ['edit','delete']);
}
function renderTransactionsList() {
    addFilterSearchUI('transactions', ['date','description','category','amount','status']);
    renderAnalytics('transactions', ['date','description','category','amount','status'], state.data.transactions);
    renderTabCharts('transactions', ['date','description','category','amount','status'], state.data.transactions);
    renderTable('transactions', ['date','description','category','amount','status'], state.data.transactions, ['edit','delete']);
}
function renderBudgetsList() {
    addFilterSearchUI('budgets', ['name','amount','period','utilization']);
    renderAnalytics('budgets', ['name','amount','period','utilization'], state.data.budgets);
    renderTabCharts('budgets', ['name','amount','period','utilization'], state.data.budgets);
    renderTable('budgets', ['name','amount','period','utilization'], state.data.budgets, ['edit','delete']);
}
function renderCategoriesList() {
    addFilterSearchUI('categories', ['category','subcategory']);
    renderAnalytics('categories', ['category','subcategory'], state.data.categories);
    renderTabCharts('categories', ['category','subcategory'], state.data.categories);
    renderTable('categories', ['category','subcategory'], state.data.categories, ['edit','delete']);
}

function setupEventListeners() {
    // Tab navigation is now handled by tabNavigation.js
    document.getElementById('month-select').addEventListener('change', function() {
        state.currentMonth = this.value;
        saveUIPreferences();
    // Re-render current tab's content with new month filter
    const tab = state.activeTab;
    if (tab === 'bills') renderBillsList();
    if (tab === 'income') renderIncomeList();
    if (tab === 'transactions') renderTransactionsList();
    if (tab === 'budgets') renderBudgetsList();
    if (tab === 'categories') renderCategoriesList();
    if (tab === 'dashboard') { updateDashboardKPIs(); renderCharts(); }
    });
    document.getElementById('global-search').addEventListener('input', function() {
        state.uiState.searchQuery = this.value;
    });
    document.getElementById('undo-btn').addEventListener('click', undoLastAction);
    document.getElementById('sync-btn').addEventListener('click', rebuildCurrentMonth);
    document.getElementById('select-folder-btn').addEventListener('click', selectDataFolder);
    document.getElementById('backup-btn').addEventListener('click', createBackup);
}

// Add import buttons to filter bars
// Helpers for reading and storing filter selections
function getFilterValues(filterDiv) {
    const filters = {};
    filterDiv.querySelectorAll('.filter-select').forEach(select => {
        const column = select.getAttribute('data-column');
        if (select.value) filters[column] = select.value;
    });
    return filters;
}

function setFilterValue(tab, column, value) {
    // Simple placeholder to remember chosen filters; can be expanded later
    if (!state.uiState.filterValues) state.uiState.filterValues = {};
    if (!state.uiState.filterValues[tab]) state.uiState.filterValues[tab] = {};
    state.uiState.filterValues[tab][column] = value;
}

function addFilterSearchUI(tab, columns) {
    const section = document.getElementById(tab);
    let filterDiv = section.querySelector('.filter-bar');
    if (!filterDiv) {
        filterDiv = document.createElement('div');
        filterDiv.className = 'filter-bar';
        filterDiv.style = 'margin-bottom:1rem;display:flex;gap:1rem;flex-wrap:wrap;';
        section.insertBefore(filterDiv, section.querySelector('.table-container'));
    }
    let html = `<input type='text' class='search-box' placeholder='Search...'>`;
    columns.forEach(col => {
        html += `<select class='filter-select' data-column='${col}'>
            <option value=''>All</option>
            ${[...new Set(state.data[tab].map(i => i[col]))].map(val => `<option value='${val}'>${val}</option>`).join('')}
        </select>`;
    });
    html += `<button class='btn btn-outline add-btn'>Add ${tab.slice(0, -1).charAt(0).toUpperCase() + tab.slice(1, -1)}</button>`;
    filterDiv.innerHTML = html;
    // Search
    filterDiv.querySelector('.search-box').oninput = function() {
        const search = this.value;
        state.uiState.searchQuery = search;
        renderTable(tab, columns, state.data[tab], ['edit', 'delete'], [{key:columns[0],dir:'asc'}], getFilterValues(filterDiv), search);
    };
    // Filters
    filterDiv.querySelectorAll('.filter-select').forEach(select => {
        select.onchange = function() {
            const column = this.getAttribute('data-column');
            const value = this.value;
            setFilterValue(tab, column, value);
            renderTable(tab, columns, state.data[tab], ['edit', 'delete'], [{key:columns[0],dir:'asc'}], getFilterValues(filterDiv), state.uiState.searchQuery);
        };
    });
    // Add
    filterDiv.querySelector('.add-btn').onclick = function() {
        if (tab === 'bills') {
            document.getElementById('add-bill-modal').style.display = 'block';
        } else if (tab === 'income') {
            document.getElementById('add-income-modal').style.display = 'block';
        } else if (tab === 'transactions') {
            document.getElementById('add-transaction-modal').style.display = 'block';
        } else if (tab === 'budgets') {
            document.getElementById('add-budget-modal').style.display = 'block';
        } else if (tab === 'categories') {
            document.getElementById('add-category-modal').style.display = 'block';
        }
    };
    // Import
    filterDiv.innerHTML += `<button class='btn btn-outline import-btn'>Import CSV</button>`;
    filterDiv.querySelector('.import-btn').onclick = function() {
        importCSV(tab, columns);
    };
}

// Update table actions to push undo
function deleteRow(tab, id) {
    pushUndo(tab);
    const index = state.data[tab].findIndex(i => String(i.id) === String(id));
    if (index !== -1) {
        state.data[tab].splice(index, 1);
        if (tab === 'bills') {
            saveBillsToCSV();
            renderBillsList();
        } else if (tab === 'income') {
            saveIncomeToCSV();
            renderIncomeList();
        } else if (tab === 'transactions') {
            saveTransactionsToCSV();
            renderTransactionsList();
        } else if (tab === 'budgets') {
            saveBudgetsToCSV();
            renderBudgetsList();
        } else if (tab === 'categories') {
            saveCategoriesToCSV();
            renderCategoriesList();
        }
    }
}

// Update add/edit forms to push undo
// Example for bills:
document.getElementById('add-bill-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const name = document.getElementById('bill-name').value.trim();
    const amount = document.getElementById('bill-amount').value;
    const recurrence = document.getElementById('bill-recurrence').value;
    const start_date = document.getElementById('bill-start').value;
    const end_date = document.getElementById('bill-end').value;
    const status = document.getElementById('bill-status').value;
    const editId = this.getAttribute('data-edit-id');
    if (editId) {
        // Edit existing bill
        const bill = state.data.bills.find(b => String(b.id) === String(editId));
        if (bill) {
            bill.name = name;
            bill.amount = amount;
            bill.recurrence = recurrence;
            bill.start_date = start_date;
            bill.end_date = end_date;
            bill.status = status;
        }
    this.removeAttribute('data-edit-id');
        alert('Bill updated!');
    } else {
        // Add new bill
        const newId = Date.now();
        const newBill = { id: newId, name, amount, recurrence, start_date, end_date, status };
        state.data.bills.push(newBill);
        alert('Bill added!');
    }
    pushUndo('bills');
    await saveBillsToCSV();
    document.getElementById('add-bill-modal').style.display = 'none';
    this.reset();
    renderBillsList();
});
document.getElementById('add-income-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const incomeSource = document.getElementById('income-source').value.trim();
    const incomeAmount = document.getElementById('income-amount').value;
    const incomeDate = document.getElementById('income-date').value;
    const incomeRecurrence = document.getElementById('income-recurrence').value;
    const incomeStatus = document.getElementById('income-status').value;
    const editId = this.getAttribute('data-edit-id');
    if (editId) {
        const item = state.data.income.find(i => String(i.id) === String(editId));
        if (item) {
            item.source = incomeSource;
            item.amount = incomeAmount;
            item.date = incomeDate;
            item.recurrence = incomeRecurrence;
            item.status = incomeStatus;
        }
        this.removeAttribute('data-edit-id');
        alert('Income updated!');
    } else {
        const newId = Date.now();
        state.data.income.push({ id: newId, source: incomeSource, amount: incomeAmount, date: incomeDate, recurrence: incomeRecurrence, status: incomeStatus });
        alert('Income added!');
    }
    pushUndo('income');
    await saveIncomeToCSV();
    document.getElementById('add-income-modal').style.display = 'none';
    this.reset();
    renderIncomeList();
});
document.getElementById('add-transaction-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        const transDate = document.getElementById('transaction-date').value;
        const transDesc = document.getElementById('transaction-description').value.trim();
        const transCat = document.getElementById('transaction-category').value.trim();
        const transAmount = document.getElementById('transaction-amount').value;
        const transStatus = document.getElementById('transaction-status').value;
        const editId = this.getAttribute('data-edit-id');
        if (editId) {
            const item = state.data.transactions.find(i => String(i.id) === String(editId));
            if (item) {
                item.date = transDate;
                item.description = transDesc;
                item.category = transCat;
                item.amount = transAmount;
                item.status = transStatus;
            }
            this.removeAttribute('data-edit-id');
            alert('Transaction updated!');
        } else {
            const newId = Date.now();
            state.data.transactions.push({ id: newId, date: transDate, description: transDesc, category: transCat, amount: transAmount, status: transStatus });
            alert('Transaction added!');
        }
        pushUndo('transactions');
        await saveTransactionsToCSV();
        document.getElementById('add-transaction-modal').style.display = 'none';
        this.reset();
        renderTransactionsList();
    });
document.getElementById('add-budget-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const budgetName = document.getElementById('budget-name').value.trim();
    const budgetAmount = document.getElementById('budget-amount').value;
    const budgetPeriod = document.getElementById('budget-period').value.trim();
    const budgetUtilization = document.getElementById('budget-utilization').value;
    const editId = this.getAttribute('data-edit-id');
    if (editId) {
        const item = state.data.budgets.find(i => String(i.id) === String(editId));
        if (item) {
            item.name = budgetName;
            item.amount = budgetAmount;
            item.period = budgetPeriod;
            item.utilization = budgetUtilization;
        }
        this.removeAttribute('data-edit-id');
        alert('Budget updated!');
    } else {
        const newId = Date.now();
        state.data.budgets.push({ id: newId, name: budgetName, amount: budgetAmount, period: budgetPeriod, utilization: budgetUtilization });
        alert('Budget added!');
    }
    pushUndo('budgets');
    await saveBudgetsToCSV();
    document.getElementById('add-budget-modal').style.display = 'none';
    this.reset();
    renderBudgetsList();
});
document.getElementById('add-category-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const catName = document.getElementById('category-name').value.trim();
    const subcatName = document.getElementById('subcategory-name').value.trim();
    const editId = this.getAttribute('data-edit-id');
    if (editId) {
        const item = state.data.categories.find(i => String(i.id) === String(editId));
        if (item) {
            item.category = catName;
            item.subcategory = subcatName;
        }
        this.removeAttribute('data-edit-id');
        alert('Category updated!');
    } else {
        const newId = Date.now();
        state.data.categories.push({ id: newId, category: catName, subcategory: subcatName });
        alert('Category added!');
    }
    pushUndo('categories');
    await saveCategoriesToCSV();
    document.getElementById('add-category-modal').style.display = 'none';
    this.reset();
    renderCategoriesList();
});


// Define global tab switch handler that will be called by tabNavigation.js
window.onTabSwitch = function(tabId) {
    state.activeTab = tabId;
    saveUIPreferences();
    if (tabId === 'dashboard') {
        renderCharts();
    }
    if (tabId === 'bills') {
        renderBillsList();
    }
    if (tabId === 'income') {
        renderIncomeList();
    }
    if (tabId === 'transactions') {
        renderTransactionsList();
    }
    if (tabId === 'budgets') {
        renderBudgetsList();
    }
    if (tabId === 'categories') {
        renderCategoriesList();
    }
};

function renderCharts() {
    const incomeCanvasId = 'income-expense-chart';
    const spendingCanvasId = 'spending-chart';
    const budgetCanvasId = 'budget-actual-chart';
    // Destroy existing dashboard charts if present
    [incomeCanvasId, spendingCanvasId, budgetCanvasId].forEach(id => {
        if (state.charts && state.charts[id]) {
            try { state.charts[id].destroy(); } catch (e) { /* ignore */ }
            delete state.charts[id];
        }
    });

    const ym = state.currentMonth;
    const monthStart = DateTime.fromFormat(ym + '-01', 'yyyy-MM-dd');
    const monthEnd = monthStart.endOf('month');
    const inMonth = d => {
        const dt = DateTime.fromISO(String(d));
        return dt.isValid && dt >= monthStart && dt <= monthEnd;
    };
    const weekIndex = d => {
        const dt = DateTime.fromISO(String(d));
        if (!dt.isValid) return -1;
        const day = dt.day;
        if (day <= 7) return 0;
        if (day <= 14) return 1;
        if (day <= 21) return 2;
        return 3;
    };

    // 1) Income vs Expenses by week (4 buckets)
    const weeksLabels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
    const weeklyIncome = [0, 0, 0, 0];
    const weeklyExpenses = [0, 0, 0, 0];

    // Income from income.csv
    (state.data.income || []).forEach(item => {
        if (!inMonth(item.date)) return;
        const idx = weekIndex(item.date);
        if (idx >= 0) weeklyIncome[idx] += Number(item.amount || 0) || 0;
    });
    // Income from positive transactions and expenses from negative transactions
    (state.data.transactions || []).forEach(t => {
        const amt = Number(t.amount || 0) || 0;
        if (!inMonth(t.date)) return;
        const idx = weekIndex(t.date);
        if (idx < 0) return;
        if (amt > 0) weeklyIncome[idx] += amt; else weeklyExpenses[idx] += Math.abs(amt);
    });

    const incomeExpenseCtxEl = document.getElementById(incomeCanvasId);
    if (incomeExpenseCtxEl) {
        const incomeExpenseCtx = incomeExpenseCtxEl.getContext('2d');
        state.charts[incomeCanvasId] = new Chart(incomeExpenseCtx, {
            type: 'bar',
            data: {
                labels: weeksLabels,
                datasets: [
                    { label: 'Income', data: weeklyIncome, backgroundColor: '#4CAF50' },
                    { label: 'Expenses', data: weeklyExpenses, backgroundColor: '#F44336' }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } }
        });
    }

    // 2) Spending by category (top 6 categories + Other)
    const expenseByCat = new Map();
    (state.data.transactions || []).forEach(t => {
        const amt = Number(t.amount || 0) || 0;
        if (!inMonth(t.date) || amt >= 0) return;
        const cat = String(t.category || 'Uncategorized');
        expenseByCat.set(cat, (expenseByCat.get(cat) || 0) + Math.abs(amt));
    });
    const sortedCats = Array.from(expenseByCat.entries()).sort((a, b) => b[1] - a[1]);
    const topN = 6;
    const topCats = sortedCats.slice(0, topN);
    const otherTotal = sortedCats.slice(topN).reduce((s, [, v]) => s + v, 0);
    const catLabels = topCats.map(([k]) => k).concat(otherTotal > 0 ? ['Other'] : []);
    const catData = topCats.map(([, v]) => v).concat(otherTotal > 0 ? [otherTotal] : []);
    const palette = ['#4E9AF1', '#4CAF50', '#FF9800', '#9C27B0', '#F44336', '#00BCD4', '#607D8B'];

    const spendingCtxEl = document.getElementById(spendingCanvasId);
    if (spendingCtxEl) {
        const spendingCtx = spendingCtxEl.getContext('2d');
        state.charts[spendingCanvasId] = new Chart(spendingCtx, {
            type: 'doughnut',
            data: {
                labels: catLabels,
                datasets: [{
                    data: catData,
                    backgroundColor: catLabels.map((_, i) => palette[i % palette.length])
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
        });
    }

    // 3) Budget vs Actual by category for the month
    const budgetLabels = (state.data.budgets || []).map(b => String(b.name || ''));
    const budgeted = (state.data.budgets || []).map(b => Number(b.amount || 0) || 0);
    const actualByCat = new Map();
    (state.data.transactions || []).forEach(t => {
        const amt = Number(t.amount || 0) || 0;
        if (!inMonth(t.date) || amt >= 0) return;
        const cat = String(t.category || '');
        actualByCat.set(cat, (actualByCat.get(cat) || 0) + Math.abs(amt));
    });
    const actual = budgetLabels.map(cat => actualByCat.get(cat) || 0);

    const budgetCtxEl = document.getElementById(budgetCanvasId);
    if (budgetCtxEl) {
        const budgetCtx = budgetCtxEl.getContext('2d');
        state.charts[budgetCanvasId] = new Chart(budgetCtx, {
            type: 'bar',
            data: {
                labels: budgetLabels,
                datasets: [
                    { label: 'Budgeted', data: budgeted, backgroundColor: '#3F51B5' },
                    { label: 'Actual', data: actual, backgroundColor: '#FF9800' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top' } },
                scales: { x: { stacked: false }, y: { stacked: false } }
            }
        });
    }
}

// Compute and update Dashboard KPI values from current data
function updateDashboardKPIs() {
    try {
        const ym = state.currentMonth;
        const monthStart = DateTime.fromFormat(ym + '-01', 'yyyy-MM-dd');
        const monthEnd = monthStart.endOf('month');
        const inMonth = d => {
            const dt = DateTime.fromISO(String(d));
            return dt.isValid && dt >= monthStart && dt <= monthEnd;
        };

        // Totals
        let totalIncome = 0;
        let totalExpenses = 0;

        (state.data.income || []).forEach(i => {
            if (!inMonth(i.date)) return;
            const v = Number(i.amount || 0) || 0;
            totalIncome += v;
        });
        (state.data.transactions || []).forEach(t => {
            if (!inMonth(t.date)) return;
            const v = Number(t.amount || 0) || 0;
            if (v >= 0) totalIncome += v; else totalExpenses += Math.abs(v);
        });
        const netAmount = totalIncome - totalExpenses;

        // Budget utilization: average of provided utilization values if present
        let budgetUtilization = 0;
        if (state.data.budgets && state.data.budgets.length) {
            const sum = state.data.budgets.reduce((s, b) => {
                const v = Number(b.utilization || 0);
                return s + (isNaN(v) ? 0 : v);
            }, 0);
            budgetUtilization = Math.round(sum / state.data.budgets.length);
        }

        const container = document.querySelector('#dashboard .kpi-container');
        if (!container) return;
        const cards = Array.from(container.querySelectorAll('.kpi-card'));
        for (const card of cards) {
            const title = (card.querySelector('.kpi-title') || {}).textContent || '';
            const valueEl = card.querySelector('.kpi-value');
            if (!valueEl) continue;
            if (/Total Income/i.test(title)) {
                valueEl.textContent = formatCurrency(totalIncome);
                valueEl.classList.add('positive-value');
                valueEl.classList.remove('negative-value');
            } else if (/Total Expenses/i.test(title)) {
                valueEl.textContent = formatCurrency(totalExpenses);
                valueEl.classList.add('negative-value');
                valueEl.classList.remove('positive-value');
            } else if (/Net Amount/i.test(title)) {
                valueEl.textContent = formatCurrency(netAmount);
                if (netAmount < 0) {
                    valueEl.classList.add('negative-value');
                    valueEl.classList.remove('positive-value');
                } else {
                    valueEl.classList.add('positive-value');
                    valueEl.classList.remove('negative-value');
                }
            } else if (/Budget Utilization/i.test(title)) {
                valueEl.textContent = `${budgetUtilization}%`;
                valueEl.classList.remove('positive-value', 'negative-value');
            }
        }
    } catch (e) {
        // Avoid crashing dashboard on partial data
        console.warn('KPI update failed:', e);
    }
}

// Add this function to render bills in the Bills tab using the new schema
function renderBillsList() {
    const billsSection = document.getElementById('bills');

    // Clean up any existing content first except for the action bar
    Array.from(billsSection.children).forEach(child => {
        if (!child.classList.contains('action-bar')) {
            child.remove();
        }
    });

    const bills = [...(state.data.bills || [])];
    // Sort: overdue first, then by upcoming due date
    const today = DateTime.now();
    const toDT = (s) => { const d = s ? DateTime.fromISO(String(s)) : null; return d && d.isValid ? d : null; };
    const isOverdue = (b) => {
        const status = String(b.Status || '').toLowerCase();
        if (status === 'overdue') return true;
        if (status === 'paid' || status === 'auto-paid') return false;
        const due = toDT(b.Due_Date);
        return !!(due && due < today);
    };
    bills.sort((a, b) => {
        const ao = isOverdue(a) ? 0 : 1;
        const bo = isOverdue(b) ? 0 : 1;
        if (ao !== bo) return ao - bo; // overdue first
        const ad = toDT(a.Due_Date);
        const bd = toDT(b.Due_Date);
        if (ad && bd) return ad - bd;
        if (ad) return -1; if (bd) return 1;
        return String(a.Bill_Name||'').localeCompare(String(b.Bill_Name||''));
    });

    // Create a fresh table container
    const billsTable = document.createElement('div');
    billsTable.className = 'table-container bills-table';
    billsSection.appendChild(billsTable);

    // Details panel
    const details = document.createElement('div');
    details.id = 'bills-details';
    details.className = 'card';
    details.style = 'padding:1rem; margin-top:0.5rem; display:none;';

    // Render table + actions header
    let html = `<table><thead><tr>
        <th>Bill Name</th>
        <th>Category</th>
        <th>Amount</th>
        <th>Due/Paid</th>
        <th>Status</th>
        <th>Payment Method</th>
        <th style="text-align:right;">Quick Actions</th>
    </tr></thead><tbody>`;

    if (!bills.length) {
        html += `<tr><td colspan='6' style='text-align:center;color:var(--fg-300);'>No bills found.</td></tr>`;
    } else {
        for (const b of bills) {
            const recurring = String(b.Recurring || '').toLowerCase() === 'true';
            const status = String(b.Status || '').trim();
            const overdue = isOverdue(b);
            const rowCls = overdue ? 'overdue' : '';
            const amount = formatCurrency(Number(b.Amount_Due) || 0);
            const showPaid = /^paid$/i.test(status) && b.Paid_Date;
            const dateText = showPaid ? b.Paid_Date : (b.Due_Date || '-');
            const dateCls = showPaid ? "style='color:var(--fg-400)'" : '';
            const statusBadge = overdue ? `<span class='badge badge-overdue'>Overdue</span>` : `<span class='badge'>${status || 'Pending'}</span>`;
            html += `<tr class='${rowCls}' data-id='${b.Bill_ID}'>
                <td>${recurring ? "<span class='badge badge-recurring' title='Recurring'>↻</span> " : ''}${escapeHtml(String(b.Bill_Name || ''))}</td>
                <td>${escapeHtml(String(b.Category || ''))}</td>
                <td>${amount}</td>
                <td ${dateCls}>${dateText}</td>
                <td>${statusBadge}</td>
                <td>${escapeHtml(String(b.Payment_Method || ''))}</td>
                <td class='bills-actions'>
                    <button class='bills-action-btn' data-action='mark-paid' title='Mark Paid' aria-label='Mark Paid'>✓</button>
                    <button class='bills-action-btn' data-action='mark-unpaid' title='Mark Unpaid' aria-label='Mark Unpaid'>↺</button>
                    <button class='bills-action-btn' data-action='toggle-autopaid' title='Toggle Auto-Paid' aria-label='Toggle Auto-Paid'>⟳</button>
                    <button class='bills-action-btn' data-action='edit' title='Edit' aria-label='Edit'>✎</button>
                    <button class='bills-action-btn' data-action='delete' title='Delete' aria-label='Delete'>🗑</button>
                    <button class='bills-action-btn' data-action='copy' title='Copy summary' aria-label='Copy summary'>📋</button>
                </td>
            </tr>`;
        }
    }
    html += `</tbody></table>`;
    billsTable.innerHTML = html;
    billsSection.appendChild(details);

    // Delegated dblclick for opening modal (ignore action buttons)
    billsTable.addEventListener('dblclick', (e) => {
        const inActions = e.target.closest('.bills-actions');
        const btn = e.target.closest('.bills-action-btn');
        if (inActions || btn) return; // don't open modal from action clicks
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        const id = tr.getAttribute('data-id');
        const bill = (state.data.bills || []).find(x => String(x.Bill_ID) === String(id));
        if (!bill) return;
        openBillsModal(bill, tr);
    });

    // Delegated click for quick actions
    billsTable.addEventListener('click', async (e) => {
        const btn = e.target.closest('.bills-action-btn');
        if (!btn) return;
        e.stopPropagation(); // prevent row dblclick from seeing these clicks
        const tr = btn.closest('tr[data-id]');
        const id = tr && tr.getAttribute('data-id');
        if (!id) return;
        const action = btn.getAttribute('data-action');
        if (action === 'mark-paid') await billsActionMarkPaid(id);
        else if (action === 'mark-unpaid') await billsActionMarkUnpaid(id);
        else if (action === 'toggle-autopaid') await billsActionToggleAutoPaid(id);
        else if (action === 'edit') await billsActionEdit(id, tr);
        else if (action === 'delete') await billsActionDelete(id);
        else if (action === 'copy') await billsActionCopy(id);
    });

    // Update sticky offsets now and after render
    updateStickyOffsets();
    setTimeout(updateStickyOffsets, 100);
}

// Make renderBillsList globally accessible for tabNavigation.js
window.renderBillsList = renderBillsList;

function openEditBillModal(id) {
    const bill = state.data.bills.find(b => String(b.id) === String(id));
    if (!bill) return;
    document.getElementById('add-bill-modal').style.display = 'block';
    document.getElementById('bill-name').value = bill.name;
    document.getElementById('bill-amount').value = bill.amount;
    document.getElementById('bill-recurrence').value = bill.recurrence;
    document.getElementById('bill-start').value = bill.start_date;
    document.getElementById('bill-end').value = bill.end_date;
    document.getElementById('bill-status').value = bill.status;
    document.getElementById('add-bill-form').setAttribute('data-edit-id', id);
}

function deleteBill(id) {
    if (!confirm('Delete this bill?')) return;
    state.data.bills = state.data.bills.filter(b => String(b.id) !== String(id));
    saveBillsToCSV();
    renderBillsList();
}

async function saveBillsToCSV() {
    if (state.uiState.folderHandle) {
        try {
            const fileHandle = await state.uiState.folderHandle.getFileHandle('bills.csv', { create: true });
            let csv = 'Bill_ID,Bill_Name,Category,Amount_Due,Due_Date,Paid_Date,Status,Recurring,Frequency,Payment_Method,Notes\n';
            for (const b of (state.data.bills || [])) {
                const row = [
                    b.Bill_ID ?? '',
                    b.Bill_Name ?? '',
                    b.Category ?? '',
                    b.Amount_Due ?? '',
                    b.Due_Date ?? '',
                    b.Paid_Date ?? '',
                    b.Status ?? '',
                    b.Recurring ?? '',
                    b.Frequency ?? '',
                    b.Payment_Method ?? '',
                    (b.Notes ?? '').toString().replace(/\n/g,' ')
                ];
                csv += row.join(',') + '\n';
            }
            const writable = await fileHandle.createWritable();
            await writable.write(csv);
            await writable.close();
        } catch (err) {
            alert('Failed to save bill to CSV.');
        }
    }
}

function saveUIPreferences() {
    const preferences = {
        activeTab: state.activeTab,
        currentMonth: state.currentMonth
    };
    localStorage.setItem('budgetAppUIPrefs', JSON.stringify(preferences));
}

// Persist transactions if a data folder is selected; otherwise keep in-memory
async function saveTransactionsToCSV() {
    if (state.uiState.folderHandle) {
        try {
            const fileHandle = await state.uiState.folderHandle.getFileHandle('transactions.csv', { create: true });
            let csv = 'id,date,description,category,amount,status\n';
            for (const t of state.data.transactions) {
                csv += `${t.id},${t.date},${t.description},${t.category},${t.amount},${t.status}\n`;
            }
            const writable = await fileHandle.createWritable();
            await writable.write(csv);
            await writable.close();
        } catch (err) {
            alert('Failed to save transactions to CSV.');
        }
    } else {
        // Show export banner to hint at persisting changes
        try { showExportBannerTimed(5000); } catch { const banner = document.getElementById('export-banner'); if (banner) banner.classList.remove('hidden'); }
    }
}

// Mark a bill as paid for the current month and handle recurrence
async function markBillPaid(id) {
    const bill = (state.data.bills || []).find(b => String(b.Bill_ID ?? b.id) === String(id));
    if (!bill) return;
    const ym = state.currentMonth;
    const monthStart = DateTime.fromFormat(ym + '-01', 'yyyy-MM-dd');
    const todayIso = DateTime.now().toISODate();
    const tx = {
        id: Date.now(),
        date: monthStart.toISODate(),
        description: bill.Bill_Name || bill.name,
        category: 'Bills',
        amount: -Math.abs(Number(bill.Amount_Due ?? bill.amount ?? 0) || 0),
        status: 'Paid'
    };
    state.data.transactions = state.data.transactions || [];
    state.data.transactions.push(tx);
    await saveTransactionsToCSV();

    // Update bill status/date per new schema
    bill.Status = 'Paid';
    bill.Paid_Date = todayIso;
    await saveBillsToCSV();

    // If recurring monthly, ask whether to create a pending placeholder for next month
    const isMonthly = /^monthly$/i.test(String(bill.Frequency || bill.recurrence || '')) && String(bill.Recurring || 'false').toLowerCase() === 'true';
    if (isMonthly) {
        const ok = confirm('Create a pending entry for next month?');
        if (ok) {
            const nextMonth = monthStart.plus({ months: 1 });
            state.data.transactions.push({
                id: Date.now() + 1,
                date: nextMonth.toISODate(),
                description: bill.Bill_Name || bill.name,
                category: 'Bills',
                amount: -Math.abs(Number(bill.Amount_Due ?? bill.amount ?? 0) || 0),
                status: 'Pending'
            });
            await saveTransactionsToCSV();
        }
    }

    // Re-render unpaid list; this bill should now disappear for this month
    renderBillsList();
}

// Expose to global so tabNavigation can persist active tab
try { window.saveUIPreferences = saveUIPreferences; } catch {}

function loadUIPreferences() {
    const savedPrefs = localStorage.getItem('budgetAppUIPrefs');
    if (savedPrefs) {
        const prefs = JSON.parse(savedPrefs);
        state.activeTab = prefs.activeTab || 'dashboard';
        state.currentMonth = prefs.currentMonth || DateTime.now().toFormat('yyyy-MM');
        document.getElementById('month-select').value = state.currentMonth;
        switchTab(state.activeTab);
    }
}

async function selectDataFolder() {
    try {
        const handle = await window.showDirectoryPicker();
        state.uiState.folderHandle = handle;
        await verifyDataFiles();
        await loadAllData();
        document.getElementById('export-banner').classList.add('hidden');
        alert('Data folder selected successfully!');
    } catch (error) {
        console.error('Error selecting folder:', error);
        alert('Could not access the selected folder. Please try again.');
    }
}

async function verifyDataFiles() {
    const requiredFiles = ['bills.csv', 'income.csv', 'transactions.csv', 'categories.csv', 'budgets.csv'];
    for (const file of requiredFiles) {
        try {
            const fileHandle = await state.uiState.folderHandle.getFileHandle(file, { create: true });
            const fileData = await fileHandle.getFile();
            if (fileData.size === 0) {
                await seedDefaultData(file);
            }
        } catch (error) {
            console.error(`Error verifying ${file}:`, error);
        }
    }
}

async function seedDefaultData(fileName) {
    let content = '';
    switch(fileName) {
        case 'categories.csv':
            content = `id,category,subcategory\n1,Housing,Rent/Mortgage\n2,Housing,HOA\n3,Housing,Repairs\n4,Utilities,Electric\n5,Utilities,Water\n6,Utilities,Gas\n7,Utilities,Trash\n8,Utilities,Internet\n9,Utilities,Mobile\n10,Transportation,Fuel\n11,Transportation,Maintenance\n12,Transportation,Insurance\n13,Transportation,Parking/Transit\n14,Food,Groceries\n15,Food,Dining Out\n16,Food,Coffee\n17,Health,Insurance\n18,Health,Copay\n19,Health,Pharmacy\n20,Personal,Clothing\n21,Personal,Hair/Beauty\n22,Personal,Subscriptions\n23,Kids/Family,Childcare\n24,Kids/Family,School\n25,Kids/Family,Activities\n26,Debt,Credit Card\n27,Debt,Student Loan\n28,Debt,Personal Loan\n29,Savings,Emergency Fund\n30,Savings,Retirement\n31,Savings,General\n32,Income,Salary\n33,Income,Bonus\n34,Income,Reimbursement\n35,Income,Other`;
            break;
        // Similar seeding for other files would be implemented
    }
    if (content) {
        const fileHandle = await state.uiState.folderHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
    }
}

async function loadAllData() {
    console.log('Loading data from CSV files...');
    try {
        const billsText = await fetchCSVText('bills.csv');
        state.data.bills = parseCSV(billsText);
        console.log('Bills loaded:', state.data.bills);

        const incomeText = await fetchCSVText('income.csv');
        state.data.income = parseCSV(incomeText);
        console.log('Income loaded:', state.data.income);

        const transactionsText = await fetchCSVText('transactions.csv');
        state.data.transactions = parseCSV(transactionsText);
        console.log('Transactions loaded:', state.data.transactions);

        const categoriesText = await fetchCSVText('categories.csv');
        state.data.categories = parseCSV(categoriesText);
        console.log('Categories loaded:', state.data.categories);

        const budgetsText = await fetchCSVText('budgets.csv');
        state.data.budgets = parseCSV(budgetsText);
        console.log('Budgets loaded:', state.data.budgets);

        updateDashboardKPIs();
        // Ensure current tab content renders using freshly loaded data
        if (typeof window.currentTab === 'string') {
            if (window.onTabSwitch) window.onTabSwitch(window.currentTab);
        }
    } catch (error) {
        // Avoid logging raw objects that show up as JSHandle in headless logs.
        try {
            const msg = error && error.message ? error.message : String(error);
            console.error('Error loading data:', msg);
        } catch (e) {
            console.error('Error loading data: (unserializable error)');
        }
    }
}

function updateStickyOffsets() {
    const header = document.querySelector('header');
    const tabs = document.querySelector('.tabs');
    if (!header || !tabs) return;

    const headerHeight = header.offsetHeight;
    const tabsHeight = tabs.offsetHeight;
    const tabsRect = tabs.getBoundingClientRect();
    const tabsBottomFromViewportTop = Math.round(tabsRect.bottom);

    // Default desired sticky top: just under tabs
    let desiredTop = tabsBottomFromViewportTop;

    // If Bills tab is active, keep table header below the Bills action bar
    try {
        const active = document.querySelector('.tab-content.active');
        const isBills = active && active.id === 'bills';
        if (isBills) {
            const actionBar = active.querySelector('.action-bar');
            if (actionBar) {
                const abStyles = getComputedStyle(actionBar);
                const marginBottom = Math.ceil(parseFloat(abStyles.marginBottom || '0'));
                const actionBarHeight = actionBar.offsetHeight + marginBottom;
                // Expose the Bills action bar height for CSS to size the scroll container
                try { active.style.setProperty('--bills-actionbar-height', `${actionBarHeight}px`); } catch {}
                desiredTop = tabsBottomFromViewportTop + actionBarHeight;
            }
        }
        // Respect the table's own top so the header doesn't float above the table before it reaches that point
        const table = active ? active.querySelector('table') : null;
        if (table) {
            const tableTop = Math.round(table.getBoundingClientRect().top);
            desiredTop = Math.max(0, Math.min(desiredTop, tableTop));
        }
    } catch {}

    // Set sticky offset variables on :root
    document.documentElement.style.setProperty('--header-height', `${headerHeight}px`);
    document.documentElement.style.setProperty('--tabs-height', `${tabsHeight}px`);
    document.documentElement.style.setProperty('--thead-top-offset', `${desiredTop}px`);

    // Expose computed offsets for automated tests and debugging
    window.__stickyOffsets = {
        headerHeight,
        tabsHeight,
        tabsBottom: tabsBottomFromViewportTop,
        theadTopOffset: desiredTop
    };
}
// Minimal backup implementation to keep UI functional
function createBackup() {
    try {
        const blob = new Blob([
            'bills.csv,income.csv,transactions.csv,categories.csv,budgets.csv'
        ], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `budget-backup-${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 100);
        alert('Backup created successfully!');
    } catch (error) {
        console.error('Backup failed:', error);
        alert('Could not create backup. Please try again.');
    }
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

// Initialize the UI and ensure tables are rendered correctly
function initializeUI() {
    console.log("Initializing UI and setting up tables");
    
    // Make key functions globally accessible
    window.updateStickyOffsets = updateStickyOffsets;
    
    // Calculate sticky offsets for table headers
    updateStickyOffsets();
    
    // Ensure bills table is rendered on load if bills tab is active
    if (state.activeTab === 'bills') {
        renderBillsList();
    }
    
    // Re-run sticky offset calculations after a small delay to ensure all elements are fully rendered
    setTimeout(() => {
        updateStickyOffsets();
        console.log("Delayed sticky offset calculation complete");
    }, 200);

    // Recompute on resize and scroll in case the header/tabs heights change
    window.addEventListener('resize', () => requestAnimationFrame(updateStickyOffsets));
    window.addEventListener('scroll', () => requestAnimationFrame(updateStickyOffsets), { passive: true });

    // Observe layout changes within the tabs or header to recalc offsets
    try {
        const observer = new MutationObserver(() => requestAnimationFrame(updateStickyOffsets));
        const header = document.querySelector('header');
        const tabs = document.querySelector('.tabs');
        if (header) observer.observe(header, { childList: true, subtree: true, attributes: true });
        if (tabs) observer.observe(tabs, { childList: true, subtree: true, attributes: true });
    } catch {}
}

// Show the export banner for a limited time with a progress bar
function showExportBannerTimed(durationMs = 5000) {
    const el = document.getElementById('export-banner');
    if (!el) return;
    // ensure progress elements
    let bar = el.querySelector('.export-progress-bar');
    if (!bar) {
        const prog = document.createElement('div');
        prog.className = 'export-progress';
        bar = document.createElement('div');
        bar.className = 'export-progress-bar';
        prog.appendChild(bar);
        el.insertBefore(prog, el.querySelector('button'));
    }
    // cancel any existing timer
    if (!state.uiState) state.uiState = {};
    if (state.uiState._exportHideTimer) {
        clearTimeout(state.uiState._exportHideTimer);
        state.uiState._exportHideTimer = null;
    }
    // reset and show
    el.classList.remove('hidden');
    bar.style.transition = 'none';
    bar.style.width = '0%';
    // force reflow before starting transition
    void bar.offsetWidth;
    bar.style.transition = `width ${durationMs}ms linear`;
    bar.style.width = '100%';
    // schedule hide
    state.uiState._exportHideTimer = setTimeout(() => {
        el.classList.add('hidden');
        // reset progress for next time
        bar.style.transition = 'none';
        bar.style.width = '0%';
        state.uiState._exportHideTimer = null;
    }, durationMs);
}

// ===== Bills Modal + Actions =====
let __billsModalPrevFocus = null;
function openBillsModal(bill, rowEl) {
    const overlay = document.getElementById('bills-modal-overlay');
    const titleEl = document.getElementById('bills-modal-title');
    const fields = document.getElementById('bills-modal-fields');
    const btnClose = document.getElementById('bills-modal-close');
    const btnCancel = document.getElementById('bills-modal-cancel');
    if (!overlay || !fields) return;
    __billsModalPrevFocus = rowEl || document.activeElement;
    titleEl.textContent = 'Bill Details - ' + (bill.Bill_Name || '');
    const fmt = (n) => formatCurrency(Number(n) || 0);
    const status = String(bill.Status || '').trim();
    const isPaid = /^paid$/i.test(status);
    const dueLabel = isPaid ? 'Paid Date' : 'Due Date';
    const dateVal = isPaid ? (bill.Paid_Date || '-') : (bill.Due_Date || '-');
    const overdueDays = computeOverdueDays(bill);
    const recurringYesNo = String(bill.Recurring || '').toLowerCase() === 'true' ? 'Yes' : 'No';
    const badge = isPaid ? `<span class='badge badge-active'>Paid</span>` : (status.toLowerCase()==='overdue' ? `<span class='badge badge-overdue'>Overdue</span>` : `<span class='badge'>${status||'Pending'}</span>`);
    fields.innerHTML = `
        <div class='bills-modal-field'><div class='bills-modal-label'>Bill Name</div><div class='bills-modal-value'>${escapeHtml(String(bill.Bill_Name||''))}</div></div>
        <div class='bills-modal-field'><div class='bills-modal-label'>Category</div><div class='bills-modal-value'>${escapeHtml(String(bill.Category||''))}</div></div>
        <div class='bills-modal-field'><div class='bills-modal-label'>Amount</div><div class='bills-modal-value'>${fmt(bill.Amount_Due)}</div></div>
        <div class='bills-modal-field'><div class='bills-modal-label'>Status</div><div class='bills-modal-value'>${badge}</div></div>
        <div class='bills-modal-field'><div class='bills-modal-label'>${dueLabel}</div><div class='bills-modal-value'>${escapeHtml(String(dateVal||'-'))}</div></div>
        <div class='bills-modal-field'><div class='bills-modal-label'>Overdue Days</div><div class='bills-modal-value'>${overdueDays ?? '—'}</div></div>
        <div class='bills-modal-field'><div class='bills-modal-label'>Recurring</div><div class='bills-modal-value'>${recurringYesNo}${bill.Frequency? ' ('+escapeHtml(String(bill.Frequency))+')':''}</div></div>
        <div class='bills-modal-field'><div class='bills-modal-label'>Payment Method</div><div class='bills-modal-value'>${escapeHtml(String(bill.Payment_Method||''))}</div></div>
        <div class='bills-modal-field'><div class='bills-modal-label'>Bill ID</div><div class='bills-modal-value'>${escapeHtml(String(bill.Bill_ID||''))}</div></div>
        <div class='bills-modal-notes'>${escapeHtml(String(bill.Notes||'')) || '<em style="color:var(--fg-400)">No notes</em>'}</div>
    `;
    // Wire controls
    const close = () => closeBillsModal();
    btnClose.onclick = close;
    btnCancel.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    // Open and focus trap
    overlay.classList.remove('hidden');
    const focusables = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const first = focusables[0]; const last = focusables[focusables.length-1];
    if (first) first.focus();
    overlay.onkeydown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key === 'Tab') {
            if (!focusables.length) return;
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    };
}

function closeBillsModal() {
    const overlay = document.getElementById('bills-modal-overlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.onkeydown = null;
    if (__billsModalPrevFocus && __billsModalPrevFocus.focus) {
        try { __billsModalPrevFocus.focus(); } catch {}
    }
}

function computeOverdueDays(bill) {
    const status = String(bill.Status || '').toLowerCase();
    if (status !== 'overdue') return '—';
    const d = DateTime.fromISO(String(bill.Due_Date||''));
    if (!d.isValid) return '—';
    const diff = DateTime.now().startOf('day').diff(d.startOf('day'), 'days').days;
    return Math.max(0, Math.floor(diff));
}

async function billsActionMarkPaid(id) {
    const b = (state.data.bills || []).find(x => String(x.Bill_ID) === String(id));
    if (!b) return;
    b.Status = 'Paid';
    b.Paid_Date = DateTime.now().toISODate();
    if (typeof saveBillsToCSV === 'function') await saveBillsToCSV();
    renderBillsList();
}
async function billsActionMarkUnpaid(id) {
    const b = (state.data.bills || []).find(x => String(x.Bill_ID) === String(id));
    if (!b) return;
    b.Status = 'Pending';
    b.Paid_Date = '';
    if (typeof saveBillsToCSV === 'function') await saveBillsToCSV();
    renderBillsList();
}
async function billsActionToggleAutoPaid(id) {
    const b = (state.data.bills || []).find(x => String(x.Bill_ID) === String(id));
    if (!b) return;
    b.Status = (String(b.Status||'').toLowerCase()==='auto-paid') ? 'Pending' : 'Auto-Paid';
    if (typeof saveBillsToCSV === 'function') await saveBillsToCSV();
    renderBillsList();
}
async function billsActionEdit(id, rowEl) {
    // If details modal is open, close it first
    const detailsOverlay = document.getElementById('bills-modal-overlay');
    if (detailsOverlay && !detailsOverlay.classList.contains('hidden')) closeBillsModal();
    const bill = (state.data.bills || []).find(x => String(x.Bill_ID) === String(id));
    if (!bill) return;
    if (typeof openEditBill === 'function') {
        // Delegate to app-provided edit flow
        return openEditBill(String(id));
    }
    // Use our edit modal
    openBillsEditModal(bill, rowEl);
}
async function billsActionDelete(id) {
    if (typeof deleteBill === 'function') return deleteBill(String(id));
    // UI fallback
    state.data.bills = (state.data.bills || []).filter(x => String(x.Bill_ID) !== String(id));
    if (typeof saveBillsToCSV === 'function') await saveBillsToCSV();
    renderBillsList();
    console.warn('TODO: Persist deletion for Bills in CSV if needed.');
}
async function billsActionCopy(id) {
    const b = (state.data.bills || []).find(x => String(x.Bill_ID) === String(id));
    if (!b) return;
    const lines = [
        `Bill: ${b.Bill_Name}`,
        `Category: ${b.Category}`,
        `Amount: ${formatCurrency(Number(b.Amount_Due)||0)}`,
        `Status: ${b.Status}`,
        `Due Date: ${b.Due_Date || '-'}`,
        `Paid Date: ${b.Paid_Date || '-'}`,
        `Recurring: ${String(b.Recurring).toLowerCase()==='true' ? 'Yes' : 'No'}${b.Frequency? ' ('+b.Frequency+')':''}`,
        `Payment Method: ${b.Payment_Method || '-'}`,
        `Bill ID: ${b.Bill_ID}`,
        `Notes: ${b.Notes || ''}`
    ];
    const text = lines.join('\n');
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch {}
        document.body.removeChild(ta);
    }
}

// Edit Modal (local implementation)
let __billsEditPrevFocus = null;
function openBillsEditModal(bill, rowEl) {
    const overlay = document.getElementById('bills-edit-modal');
    if (!overlay) return;
    __billsEditPrevFocus = rowEl || document.activeElement;
    // populate inputs
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    set('bills-edit-name', bill.Bill_Name);
    set('bills-edit-category', bill.Category);
    set('bills-edit-amount', bill.Amount_Due);
    set('bills-edit-status', bill.Status || 'Pending');
    set('bills-edit-due', bill.Due_Date);
    set('bills-edit-paid', bill.Paid_Date);
    const chk = document.getElementById('bills-edit-recurring'); if (chk) chk.checked = String(bill.Recurring||'').toLowerCase()==='true';
    set('bills-edit-frequency', bill.Frequency);
    set('bills-edit-method', bill.Payment_Method);
    set('bills-edit-id', bill.Bill_ID);
    const notes = document.getElementById('bills-edit-notes'); if (notes) notes.value = bill.Notes || '';

    // wire actions
    const btnClose = document.getElementById('bills-edit-close');
    const btnCancel = document.getElementById('bills-edit-cancel');
    const btnSave = document.getElementById('bills-edit-save');
    const form = document.getElementById('bills-edit-form');
    const close = () => closeBillsEditModal();
    btnClose.onclick = close;
    btnCancel.onclick = (e) => { e.preventDefault(); close(); };
    btnSave.onclick = async (e) => { e.preventDefault(); await saveBillsEditModal(bill); };
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    // open + focus trap
    overlay.classList.remove('hidden');
    const focusables = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const first = focusables[0]; const last = focusables[focusables.length-1];
    if (first) first.focus();
    overlay.onkeydown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key === 'Tab') {
            if (!focusables.length) return;
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    };
}

function closeBillsEditModal() {
    const overlay = document.getElementById('bills-edit-modal');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.onkeydown = null;
    if (__billsEditPrevFocus && __billsEditPrevFocus.focus) {
        try { __billsEditPrevFocus.focus(); } catch {}
    }
}

async function saveBillsEditModal(bill) {
    const get = (id) => document.getElementById(id);
    bill.Bill_Name = get('bills-edit-name').value.trim();
    bill.Category = get('bills-edit-category').value.trim();
    bill.Amount_Due = parseFloat(get('bills-edit-amount').value || '0') || 0;
    bill.Status = get('bills-edit-status').value;
    bill.Due_Date = get('bills-edit-due').value;
    bill.Paid_Date = get('bills-edit-paid').value;
    bill.Recurring = get('bills-edit-recurring').checked ? 'true' : 'false';
    bill.Frequency = get('bills-edit-frequency').value.trim();
    bill.Payment_Method = get('bills-edit-method').value.trim();
    bill.Notes = get('bills-edit-notes').value;
    if (typeof saveBillsToCSV === 'function') await saveBillsToCSV();
    renderBillsList();
    closeBillsEditModal();
}

// Run initialization on page load
document.addEventListener('DOMContentLoaded', initializeUI);

// Tab navigation is initialized on DOMContentLoaded earlier
