// src/bills.js - Next-gen Bills tab module
// This module is self-contained and uses the global `state` where available.
import { DateTime } from 'https://cdn.jsdelivr.net/npm/luxon@3.3.0/build/es6/luxon.js';

// Lightweight CSV export helper
function exportToCSV(rows) {
  const header = ['Bill Name','Owner','Category','Subcategory','Due Date','Projected','Actual','Status'];
  const lines = [header.join(',')];
  rows.forEach(r => {
    lines.push([r.name, r.owner, r.category, r.subcategory, r.due, r.projected, r.actual ?? '', r.status].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'bills.csv'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function formatUSD(n) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
  } catch (e) { return String(n); }
}

// Render helpers (expects elements to be present in DOM)
export function initBillsModule(options = {}) {
  // options: containerId
  const container = document.getElementById(options.containerId || 'bills');
  if (!container) return console.warn('Bills container not found');

  // Inject top-level HTML if not present
  if (!container.querySelector('.bills-tab')) {
    container.innerHTML = `
      <div class="bills-tab">
        <div class="bills-topbar">
          <div class="bills-search">
            <input id="bills-search-input" placeholder="Search bills by name, owner, category..." />
            <button id="bills-export-btn" class="pill-btn">Export CSV</button>
          </div>
          <div class="bills-view-toggle">
            <button id="bills-list-view-btn" class="pill-btn active">List View</button>
            <button id="bills-calendar-view-btn" class="pill-btn">Calendar View</button>
          </div>
          <div class="bills-totals">
            <div id="bills-monthly-total"></div>
            <div class="bills-progress-bar"><div id="bills-progress-inner"></div></div>
          </div>
        </div>
        <div class="bills-charts"><canvas id="bills-bar-chart"></canvas><canvas id="bills-pie-chart"></canvas></div>
        <div id="bills-list-view" class="bills-list-view"></div>
        <div id="bills-calendar-view" class="bills-calendar-view" style="display:none;"></div>
        <div id="bills-modal" class="bills-modal hidden">
          <form id="bills-modal-form">
            <h3 id="bills-modal-title">Add Bill</h3>
            <label>Bill Name</label><input id="modal-bill-name" required />
            <label>Owner</label><select id="modal-bill-owner"></select>
            <label>Category</label><select id="modal-bill-category"></select>
            <label>Subcategory</label><select id="modal-bill-subcategory"></select>
            <label>Due Date</label><input id="modal-bill-due" type="date" required />
            <label>Projected Amount</label><input id="modal-bill-projected" type="number" step="0.01" min="0" required />
            <label>Actual Amount</label><input id="modal-bill-actual" type="number" step="0.01" min="0" />
            <label>Status</label><select id="modal-bill-status"><option>Upcoming</option><option>Due Soon</option><option>Overdue</option><option>Paid</option></select>
            <div class="modal-actions"><button type="submit" class="pill-btn">Save</button><button id="bills-modal-cancel" type="button" class="pill-btn pill-cancel">Cancel</button></div>
          </form>
        </div>
      </div>`;
  }

  // Wire interactions
  const exportBtn = container.querySelector('#bills-export-btn');
  exportBtn.onclick = () => exportToCSV(state.data.bills || []);

  const addBtn = document.createElement('button'); addBtn.className = 'pill-btn'; addBtn.textContent = '+ Add Bill';
  addBtn.onclick = () => openModal();
  container.querySelector('.bills-topbar').appendChild(addBtn);

  // populate dropdowns
  populateModalDropdowns();

  // initial render
  renderAll();

  // Search
  container.querySelector('#bills-search-input').addEventListener('input', (e) => renderAll(e.target.value));

  // View toggles
  container.querySelector('#bills-list-view-btn').addEventListener('click', () => { container.querySelector('#bills-list-view').style.display=''; container.querySelector('#bills-calendar-view').style.display='none'; });
  container.querySelector('#bills-calendar-view-btn').addEventListener('click', () => { container.querySelector('#bills-list-view').style.display='none'; container.querySelector('#bills-calendar-view').style.display=''; });

  // Modal cancel — hide and remove body lock
  container.querySelector('#bills-modal-cancel').addEventListener('click', () => {
    container.querySelector('#bills-modal').classList.add('hidden');
    document.body.classList.remove('modal-open');
  });

  // Form submit
  container.querySelector('#bills-modal-form').addEventListener('submit', (e) => { e.preventDefault(); saveModal(); });

  // Expose a render method
  function renderAll(query='') {
    const items = (state.data && state.data.bills) ? state.data.bills : ([]);
    const filtered = query ? items.filter(b => (b.name||'').toLowerCase().includes(query.toLowerCase()) || (b.owner||'').toLowerCase().includes(query.toLowerCase()) || (b.category||'').toLowerCase().includes(query.toLowerCase())) : items;
    renderTable(filtered);
    renderTotals(filtered);
    renderCharts(filtered);
    renderCalendar(filtered);
  }

  function renderTable(bills) {
    const containerEl = container.querySelector('#bills-list-view');
    const groups = { Overdue:[], DueSoon:[], Upcoming:[], Paid:[] };
    const now = DateTime.now();
    bills.forEach(b => {
      const due = DateTime.fromISO(b.due);
      if (b.status === 'Paid') groups.Paid.push(b);
      else if (due.isValid && due < now) groups.Overdue.push(b);
      else if (due.isValid && due <= now.plus({ days:7 })) groups.DueSoon.push(b);
      else groups.Upcoming.push(b);
    });
    let html = '<table class="bills-table"><thead><tr><th>Bill Name</th><th>Owner</th><th>Category</th><th>Subcategory</th><th>Due Date</th><th>Projected</th><th>Actual</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    ['Overdue','DueSoon','Upcoming','Paid'].forEach(section => {
      const rows = groups[section];
      if (!rows.length) return;
      html += `<tr class="section-row"><td colspan="9" style="background:var(--bg-800);font-weight:700;color:var(--accent);">${section}</td></tr>`;
      rows.forEach(b => {
        const overdueClass = section === 'Overdue' ? 'overdue' : '';
        html += `<tr class="${overdueClass}" data-id="${b.id}">`;
        // Bill name with ellipsis utility
        html += `<td class="bill-name">${escapeHtml(b.name || '-')}${b.projected > ((b.history && b.history[b.history.length-2])||0) ? '<span class="badge badge-duesoon" title="Higher than previous month">↑</span>' : ''}</td>`;
        html += `<td><span class="badge badge-owner">${escapeHtml(b.owner||'')}</span></td>`;
        html += `<td><span class="badge badge-category">${escapeHtml(b.category||'')}</span></td>`;
        html += `<td>${escapeHtml(b.subcategory||'')}</td>`;
        html += `<td>${escapeHtml(b.due||'-')}</td>`;
        html += `<td class="num">${formatUSD(b.projected)}</td>`;
        html += `<td class="num">${b.actual!=null?formatUSD(b.actual):'-'}</td>`;
        // Status badge mapping
        const status = (b.status || 'Upcoming');
        let statusBadge = `<span class="badge badge-upcoming">${escapeHtml(status)}</span>`;
        if (/overdue/i.test(status)) statusBadge = `<span class="badge badge-overdue">${escapeHtml(status)}</span>`;
        else if (/paid/i.test(status)) statusBadge = `<span class="badge badge-paid">${escapeHtml(status)}</span>`;
        else if (/due/i.test(status)) statusBadge = `<span class="badge badge-duesoon">${escapeHtml(status)}</span>`;
        html += `<td>${statusBadge}</td>`;
        html += `<td><button class="edit-btn" data-id="${b.id}" aria-label="Edit ${escapeHtml(b.name)}">✏️ Edit</button> <button class="delete-btn" data-id="${b.id}" aria-label="Delete ${escapeHtml(b.name)}">🗑️ Delete</button></td>`;
        html += `</tr>`;
      });
    });
    html += '</tbody></table>';
    containerEl.innerHTML = html;
    // Wire edit/delete
    containerEl.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', (e) => openModal(getBillById(e.currentTarget.dataset.id))));
    containerEl.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', (e) => { deleteBill(e.currentTarget.dataset.id); }));
  }

  function renderTotals(bills) {
    const totalProjected = bills.reduce((s,b)=>s+(b.projected||0),0);
    const totalActual = bills.reduce((s,b)=>s+(b.actual||0),0);
    const paid = bills.filter(b => b.status==='Paid').length;
    const total = bills.length || 1;
    container.querySelector('#bills-monthly-total').innerHTML = `<strong>Projected:</strong> ${formatUSD(totalProjected)} &nbsp; <strong>Actual:</strong> ${formatUSD(totalActual)}`;
    const percent = Math.round((paid/total)*100);
    const prog = container.querySelector('#bills-progress-inner'); prog.style.width = percent + '%'; prog.textContent = `${paid} of ${total} bills paid`;
  }

  function renderCharts(bills) {
    try {
      // Destroy previous charts if present (prevents stacking on re-render)
      try { if (container._billsBarChart) { container._billsBarChart.destroy(); delete container._billsBarChart; } } catch(e){}
      try { if (container._billsPieChart) { container._billsPieChart.destroy(); delete container._billsPieChart; } } catch(e){}
      const barCtx = container.querySelector('#bills-bar-chart').getContext('2d');
      const pieCtx = container.querySelector('#bills-pie-chart').getContext('2d');
      // simple bar: due date vs projected
      const labels = bills.map(b => b.due || '');
      const data = bills.map(b => Number(b.projected) || 0);
      container._billsBarChart = new Chart(barCtx, { type: 'bar', data:{ labels, datasets:[{ label:'Projected', data, backgroundColor:getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#60a5fa' }] }, options:{ responsive:true, plugins:{ legend:{ display:false } } } });
      const catCount = {};
      bills.forEach(b => catCount[b.category] = (catCount[b.category]||0)+1);
      const palette = [getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#60a5fa', getComputedStyle(document.documentElement).getPropertyValue('--positive') || '#22c55e', getComputedStyle(document.documentElement).getPropertyValue('--warning') || '#fbbf24', getComputedStyle(document.documentElement).getPropertyValue('--negative') || '#ef4444', getComputedStyle(document.documentElement).getPropertyValue('--accent-hover') || '#2563eb'];
      container._billsPieChart = new Chart(pieCtx, { type:'pie', data:{ labels:Object.keys(catCount), datasets:[{ data:Object.values(catCount), backgroundColor: Object.keys(catCount).map((k,i)=> palette[i % palette.length]) }] }, options:{ responsive:true, plugins:{ legend:{ position:'right' } } } });
    } catch (e) { console.warn('Charts failed', e); }
  }

  function renderCalendar(bills) {
    const el = container.querySelector('#bills-calendar-view');
    const byDate = {};
    bills.forEach(b => { byDate[b.due] = byDate[b.due] || []; byDate[b.due].push(b); });
    let html = '<div style="padding:0.6rem">'; Object.keys(byDate).sort().forEach(d => { html += `<div style="margin-bottom:0.8rem"><strong>${d}</strong><ul>`; byDate[d].forEach(b=>html+=`<li>${b.name} — ${formatUSD(b.projected)} ${b.status}</li>`); html += '</ul></div>'; }); html += '</div>';
    el.innerHTML = html;
  }

  function populateModalDropdowns() {
    const ownerSel = container.querySelector('#modal-bill-owner'); ownerSel.innerHTML = (state.uiState && state.uiState.owners ? state.uiState.owners : ['You']).map(o=>`<option>${o}</option>`).join('');
    const catSel = container.querySelector('#modal-bill-category'); catSel.innerHTML = Object.keys(state.uiState && state.uiState.categories ? state.uiState.categories : {'Misc':['General']}).map(k=>`<option>${k}</option>`).join('');
    catSel.addEventListener('change', () => { const subs = (state.uiState && state.uiState.categories && state.uiState.categories[catSel.value])||['General']; container.querySelector('#modal-bill-subcategory').innerHTML = subs.map(s=>`<option>${s}</option>`).join(''); });
    catSel.dispatchEvent(new Event('change'));
  }

  function getBillById(id) { return (state.data && state.data.bills) ? state.data.bills.find(b => String(b.id) === String(id)) : null; }

  function openModal(bill=null) {
  const modal = container.querySelector('#bills-modal'); modal.classList.remove('hidden');
  // Prevent page from scrolling behind modal
  document.body.classList.add('modal-open');
    container.querySelector('#bills-modal-title').textContent = bill ? 'Edit Bill' : 'Add Bill';
    container.querySelector('#modal-bill-name').value = bill ? bill.name : '';
    container.querySelector('#modal-bill-owner').value = bill ? bill.owner : (state.uiState && state.uiState.owners ? state.uiState.owners[0] : 'You');
    container.querySelector('#modal-bill-category').value = bill ? bill.category : Object.keys(state.uiState.categories||{Misc:['General']})[0];
    container.querySelector('#modal-bill-subcategory').value = bill ? bill.subcategory : (state.uiState.categories ? state.uiState.categories[container.querySelector('#modal-bill-category').value][0] : 'General');
    container.querySelector('#modal-bill-due').value = bill ? bill.due : '';
    container.querySelector('#modal-bill-projected').value = bill ? bill.projected : '';
    container.querySelector('#modal-bill-actual').value = bill ? bill.actual : '';
    container.querySelector('#modal-bill-status').value = bill ? bill.status : 'Upcoming';
    container.querySelector('#bills-modal-form').onsubmit = (e) => { e.preventDefault(); saveModal(bill); };
  }

  function saveModal(existing=null) {
    const name = container.querySelector('#modal-bill-name').value.trim();
    const owner = container.querySelector('#modal-bill-owner').value;
    const category = container.querySelector('#modal-bill-category').value;
    const subcategory = container.querySelector('#modal-bill-subcategory').value;
    const due = container.querySelector('#modal-bill-due').value;
    const projected = parseFloat(container.querySelector('#modal-bill-projected').value);
    const actual = parseFloat(container.querySelector('#modal-bill-actual').value) || null;
    const status = container.querySelector('#modal-bill-status').value;
    if (!name || !due || isNaN(projected)) { alert('Please fill required fields'); return; }
    if (existing) {
      existing.name = name; existing.owner = owner; existing.category = category; existing.subcategory = subcategory; existing.due = due; existing.projected = projected; existing.actual = actual; existing.status = status;
    } else {
      const newB = { id: Date.now(), name, owner, category, subcategory, due, projected, actual, status, history:[projected] };
      if (!state.data) state.data = {}; if (!state.data.bills) state.data.bills = [];
      state.data.bills.push(newB);
    }
  container.querySelector('#bills-modal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  renderAll();
  }

  function deleteBill(id) { if (!confirm('Delete?')) return; state.data.bills = state.data.bills.filter(b=>String(b.id)!==String(id)); renderAll(); }

}

// Export default init
export default initBillsModule;
