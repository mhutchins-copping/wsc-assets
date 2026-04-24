// ─── Loaner pool admin view ────────────────────

var loansState = { filter: 'active' };

Router.register('/loans', function() { renderLoansList(); });

function renderLoansList() {
  var el = document.getElementById('view-loans');
  if (!el) return;
  el.innerHTML = '<div class="toolbar">'
    + '<div class="toolbar-left"><h2 style="margin:0;font-size:18px">Loaner Pool</h2></div>'
    + '<div class="toolbar-right"><button class="btn sm" onclick="loadLoans()">Refresh</button></div>'
    + '</div>'
    + '<div id="loans-filters"></div>'
    + '<div id="loans-table">' + skeleton(6) + '</div>';
  renderLoansFilters();
  loadLoans();
}

function renderLoansFilters() {
  var filters = [
    { value: 'active',   label: 'Active' },
    { value: 'overdue',  label: 'Overdue' },
    { value: 'returned', label: 'Returned' },
    { value: 'all',      label: 'All' }
  ];
  document.getElementById('loans-filters').innerHTML = renderFilters({
    filters: filters, active: loansState.filter, onClick: 'filterLoans'
  });
}

function filterLoans(f) {
  loansState.filter = f;
  renderLoansFilters();
  loadLoans();
}
window.filterLoans = filterLoans;

async function loadLoans() {
  var tableEl = document.getElementById('loans-table');
  if (!tableEl) return;
  try {
    var res = await API.getLoans({ filter: loansState.filter });
    var rows = res.data || [];
    var today = res.today || new Date().toISOString().slice(0, 10);

    if (!rows.length) {
      tableEl.innerHTML = '<div class="view-placeholder">'
        + '<div class="view-placeholder-icon">'
        + '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>'
        + '</div>'
        + '<div class="view-placeholder-title">Nothing here</div>'
        + '<div class="view-placeholder-sub">No ' + loansState.filter + ' loans. Flag an asset as "in loaner pool" on the asset form to start lending it out.</div>'
        + '</div>';
      updateLoansBadge();
      return;
    }

    window.__loansRowIndex = {};
    rows.forEach(function(r) { window.__loansRowIndex[r.id] = r; });

    var columns = [
      { key: 'asset_tag', label: 'Asset', render: function(r) {
        return '<span style="font-family:var(--mono)">' + esc(r.asset_tag || '—') + '</span>'
          + '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + esc(r.asset_name || '') + '</div>';
      }},
      { key: 'person_name', label: 'Loaned to', render: function(r) {
        return esc(r.person_name || '—')
          + (r.department ? '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + esc(r.department) + '</div>' : '');
      }},
      { key: 'loaned_at', label: 'Lent', render: function(r) {
        return '<span style="font-family:var(--mono);font-size:11px;color:var(--text3)">' + fmtDate(r.loaned_at) + '</span>';
      }},
      { key: 'due_date', label: 'Due', render: function(r) {
        var overdue = !r.returned_at && r.due_date && r.due_date < today;
        return '<span style="font-family:var(--mono);font-size:12px;font-weight:' + (overdue ? '600' : '500') + ';color:' + (overdue ? '#dc2626' : 'inherit') + '">'
          + esc(fmtDate(r.due_date))
          + (overdue ? ' <span class="badge" style="background:#fee2e2;color:#991b1b">Overdue</span>' : '')
          + '</span>';
      }},
      { key: 'returned_at', label: 'Returned', render: function(r) {
        return r.returned_at
          ? '<span style="font-family:var(--mono);font-size:11px;color:var(--text3)">' + fmtDate(r.returned_at) + '</span>'
          : '<span style="color:var(--text3)">—</span>';
      }},
      { key: '__actions', label: 'Actions', render: function(r) {
        if (r.returned_at) return '<span style="color:var(--text3)">—</span>';
        return '<button class="btn primary sm" onclick="event.stopPropagation();returnLoanById(\'' + esc(r.id) + '\')">Mark returned</button>';
      }}
    ];

    tableEl.innerHTML = renderTable({
      columns: columns,
      data: rows,
      emptyMsg: 'No loans',
      onRowClick: 'openLoanAsset'
    });
    updateLoansBadge();
  } catch(e) {
    tableEl.innerHTML = '<div class="table-empty">Failed to load loans</div>';
  }
}
window.loadLoans = loadLoans;

function openLoanAsset(loanId) {
  var r = (window.__loansRowIndex || {})[loanId];
  if (r && r.asset_id) navigate('#/assets/' + r.asset_id);
}
window.openLoanAsset = openLoanAsset;

async function returnLoanById(loanId) {
  try {
    await API.returnLoan(loanId);
    toast('Loan returned', 'success');
    loadLoans();
  } catch(e) { /* toasted */ }
}
window.returnLoanById = returnLoanById;

// Return a loan when the operator is already on the asset detail page —
// find the active loan for this asset, call return, then re-render.
async function returnLoanForAsset(assetId) {
  try {
    var res = await API.getLoans({ filter: 'active', limit: 200 });
    var match = (res.data || []).find(function(r) { return r.asset_id === assetId; });
    if (!match) {
      toast('No active loan found for this asset', 'error');
      return;
    }
    await API.returnLoan(match.id);
    toast('Loan returned', 'success');
    renderAssetDetail(assetId);
  } catch(e) { /* toasted */ }
}
window.returnLoanForAsset = returnLoanForAsset;

// Loan-out modal: person + due date + optional note. Re-uses the existing
// person dropdown helper so we don't rebuild that UI here.
async function openLoanModal(assetId) {
  try {
    var people = await API.getPeople({ limit: 500 });
    var options = (people.data || people || []).map(function(p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.name) + (p.department ? ' — ' + esc(p.department) : '') + '</option>';
    }).join('');

    // Default due date: two weeks out, in local time.
    var defaultDue = new Date();
    defaultDue.setDate(defaultDue.getDate() + 14);
    var dueStr = defaultDue.toISOString().slice(0, 10);

    openModal('Loan out asset',
      '<div class="form-group"><label class="form-label">Loan to</label>'
      + '<select id="loan-person" class="form-select"><option value="">Select a person\u2026</option>' + options + '</select></div>'
      + '<div class="form-group"><label class="form-label">Due back</label>'
      + '<input type="date" id="loan-due" class="form-input" value="' + dueStr + '">'
      + '<div class="form-hint">Appears in red on the Loaners page once the date passes.</div></div>'
      + '<div class="form-group"><label class="form-label">Notes (optional)</label>'
      + '<textarea id="loan-notes" class="form-textarea" rows="2" placeholder="e.g. Trip to regional office"></textarea></div>'
      + '<button class="btn primary" onclick="submitLoan(\'' + esc(assetId) + '\')">Lend</button>'
    );
  } catch(e) { /* toasted */ }
}
window.openLoanModal = openLoanModal;

async function submitLoan(assetId) {
  var personId = document.getElementById('loan-person').value;
  var dueDate = document.getElementById('loan-due').value;
  var notes = document.getElementById('loan-notes').value.trim();
  if (!personId) { toast('Pick a person', 'error'); return; }
  if (!dueDate) { toast('Set a due date', 'error'); return; }
  try {
    await API.startLoan(assetId, { person_id: personId, due_date: dueDate, notes: notes });
    closeModal();
    toast('Loan started', 'success');
    renderAssetDetail(assetId);
  } catch(e) { /* toasted */ }
}
window.submitLoan = submitLoan;

// Sidebar count badge for overdue loans. Only surfaced for admins since the
// Loaners nav item is admin-only.
async function updateLoansBadge() {
  var badge = document.getElementById('loans-badge');
  if (!badge) return;
  if (!Auth.isAdmin || !Auth.isAdmin()) { badge.style.display = 'none'; return; }
  try {
    var res = await API.getLoans({ filter: 'overdue', limit: 200 });
    var n = (res.data || []).length;
    if (n > 0) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  } catch(e) { badge.style.display = 'none'; }
}
window.updateLoansBadge = updateLoansBadge;

document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() { if (Auth.isLoggedIn) updateLoansBadge(); }, 900);
});
