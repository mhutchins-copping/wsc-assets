// ─── Flags inbox (admin view of user-filed fault reports) ───

var flagsState = {
  status: 'open'  // 'open' is the default — resolved + dismissed live behind the tabs
};

Router.register('/flags', function() { renderFlagsList(); });

function renderFlagsList() {
  var el = document.getElementById('view-flags');
  if (!el) return;
  el.innerHTML = '<div class="toolbar">'
    + '<div class="toolbar-left"><h2 style="margin:0;font-size:18px">Flagged Issues</h2></div>'
    + '<div class="toolbar-right">'
    + '<button class="btn sm" onclick="loadFlags()">Refresh</button>'
    + '</div></div>'
    + '<div id="flags-filters"></div>'
    + '<div id="flags-table">' + skeleton(6) + '</div>';
  renderFlagsFilters();
  loadFlags();
}

function renderFlagsFilters() {
  var filters = [
    { value: 'open', label: 'Open' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'dismissed', label: 'Dismissed' },
    { value: '', label: 'All' }
  ];
  document.getElementById('flags-filters').innerHTML = renderFilters({
    filters: filters, active: flagsState.status, onClick: 'filterFlagsStatus'
  });
}

function filterFlagsStatus(status) {
  flagsState.status = status;
  loadFlags();
  renderFlagsFilters();
}
window.filterFlagsStatus = filterFlagsStatus;

async function loadFlags() {
  var tableEl = document.getElementById('flags-table');
  if (!tableEl) return;
  try {
    var params = {};
    if (flagsState.status) params.status = flagsState.status;
    var res = await API.getFlags(params);
    var rows = res.data || [];

    if (!rows.length) {
      tableEl.innerHTML = '<div class="view-placeholder">'
        + '<div class="view-placeholder-icon">'
        + '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>'
        + '</div>'
        + '<div class="view-placeholder-title">All clear</div>'
        + '<div class="view-placeholder-sub">No ' + (flagsState.status || '') + ' flags right now.</div>'
        + '</div>';
      updateFlagsBadge();
      return;
    }

    var columns = [
      { key: 'asset_tag', label: 'Asset', render: function(r) {
        return '<span style="font-family:var(--mono)">' + esc(r.asset_tag || '—') + '</span>'
          + '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + esc(r.asset_name || '') + '</div>';
      }},
      { key: 'category', label: 'Category', render: function(r) {
        return flagCategoryBadge(r.category);
      }},
      { key: 'description', label: 'Description', render: function(r) {
        if (!r.description) return '<span style="color:var(--text3)">—</span>';
        var trunc = r.description.length > 120 ? r.description.slice(0, 120) + '…' : r.description;
        return '<div style="max-width:340px;font-size:12px;white-space:pre-wrap">' + esc(trunc) + '</div>';
      }},
      { key: 'reported_by_email', label: 'Reported by', render: function(r) {
        return esc(r.reported_by_name || r.reported_by_email || '—')
          + (r.reported_by_email && r.reported_by_name ? '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + esc(r.reported_by_email) + '</div>' : '');
      }},
      { key: 'status', label: 'Status', render: function(r) { return flagStatusBadge(r.status); }},
      { key: 'created_at', label: 'Raised', render: function(r) {
        return '<span style="font-family:var(--mono);font-size:11px;color:var(--text3)">' + fmtDateTime(r.created_at) + '</span>';
      }},
      { key: '__actions', label: 'Actions', render: function(r) {
        if (r.status !== 'open') {
          return '<span style="color:var(--text3);font-size:11px">' + (r.resolved_at ? fmtDate(r.resolved_at) : '—') + '</span>';
        }
        return '<button class="btn primary sm" onclick="event.stopPropagation();openResolveFlag(\'' + esc(r.id) + '\',\'resolve\')">Resolve</button>'
          + ' <button class="btn sm" onclick="event.stopPropagation();openResolveFlag(\'' + esc(r.id) + '\',\'dismiss\')">Dismiss</button>';
      }}
    ];

    // Stash the rows for the row-click resolver so the table can navigate
    // by id without re-fetching.
    window.__flagsRowIndex = {};
    rows.forEach(function(r) { window.__flagsRowIndex[r.id] = r; });

    tableEl.innerHTML = renderTable({
      columns: columns,
      data: rows,
      emptyMsg: 'No flags',
      onRowClick: 'openFlagRow'
    });
    updateFlagsBadge();
  } catch(e) {
    tableEl.innerHTML = '<div class="table-empty">Failed to load flags</div>';
  }
}
window.loadFlags = loadFlags;

function openFlagRow(flagId) {
  var r = (window.__flagsRowIndex || {})[flagId];
  if (r && r.asset_id) navigate('#/assets/' + r.asset_id);
}
window.openFlagRow = openFlagRow;

function flagCategoryBadge(category) {
  var cls = {
    damaged: 'badge-flag-damaged',
    slow:    'badge-flag-slow',
    lost:    'badge-flag-lost',
    other:   'badge-flag-other'
  }[category] || 'badge-flag-other';
  var label = { damaged: 'Damaged', slow: 'Slow', lost: 'Lost', other: 'Other' }[category] || 'Other';
  return '<span class="badge ' + cls + '">' + label + '</span>';
}
window.flagCategoryBadge = flagCategoryBadge;

function flagStatusBadge(status) {
  var cls = {
    open:      'badge-issue-pending',
    resolved:  'badge-issue-signed',
    dismissed: 'badge-issue-cancelled'
  }[status] || 'badge-issue-pending';
  var label = { open: 'Open', resolved: 'Resolved', dismissed: 'Dismissed' }[status] || 'Open';
  return '<span class="badge ' + cls + '">' + label + '</span>';
}
window.flagStatusBadge = flagStatusBadge;

function openResolveFlag(flagId, action) {
  var verb = action === 'dismiss' ? 'Dismiss' : 'Resolve';
  openModal(verb + ' flag',
    '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">'
    + (action === 'dismiss'
        ? 'Close without taking action \u2014 e.g. duplicate, not a real issue.'
        : 'Mark this flag as handled. Leave a short note for the audit trail.')
    + '</div>'
    + '<div class="form-group"><label class="form-label">Notes (optional)</label>'
    + '<textarea id="flag-resolve-notes" class="form-textarea" rows="3" placeholder="What was done / why dismissed"></textarea></div>'
    + '<button class="btn primary" onclick="submitResolveFlag(\'' + esc(flagId) + '\',\'' + esc(action) + '\')">' + verb + '</button>'
  );
}
window.openResolveFlag = openResolveFlag;

async function submitResolveFlag(flagId, action) {
  var notes = document.getElementById('flag-resolve-notes').value.trim();
  try {
    if (action === 'dismiss') {
      await API.dismissFlag(flagId, notes);
    } else {
      await API.resolveFlag(flagId, notes);
    }
    closeModal();
    toast(action === 'dismiss' ? 'Flag dismissed' : 'Flag resolved', 'success');
    loadFlags();
  } catch(e) { /* toasted */ }
}
window.submitResolveFlag = submitResolveFlag;

// Sidebar count badge — only populated for admins, since that's who the
// nav item is visible to. Runs on /flags load and on auth boot.
async function updateFlagsBadge() {
  var badge = document.getElementById('flags-badge');
  if (!badge) return;
  if (!Auth.isAdmin || !Auth.isAdmin()) { badge.style.display = 'none'; return; }
  try {
    var res = await API.getFlags({ status: 'open', limit: 200 });
    var n = (res.data || []).length;
    if (n > 0) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  } catch(e) { badge.style.display = 'none'; }
}
window.updateFlagsBadge = updateFlagsBadge;

// Refresh the badge shortly after login so admins see the count without
// having to open the Flags page first.
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() { if (Auth.isLoggedIn) updateFlagsBadge(); }, 800);
});
