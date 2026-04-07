// ─── Audits View ───────────────────────────────

Router.register('/audits', function(param) {
  if (param) {
    renderAuditDetail(param);
    return;
  }
  renderAuditsList();
});

async function renderAuditsList() {
  var el = document.getElementById('view-audits');
  el.innerHTML = '<div class="toolbar">'
    + '<div class="toolbar-left"><h2 style="margin:0;font-size:16px">Asset Audits</h2></div>'
    + '<div class="toolbar-right">'
    + '<button class="btn primary sm" onclick="openNewAudit()">+ New Audit</button>'
    + '</div></div>'
    + '<div id="audits-table">' + skeleton(4) + '</div>';

  try {
    var result = await API.getAudits();
    var audits = result.data || [];
    var tableEl = document.getElementById('audits-table');

    if (!audits.length) {
      tableEl.innerHTML = '<div class="view-placeholder" style="padding:60px 0">'
        + '<div class="view-placeholder-icon">&#9989;</div>'
        + '<div class="view-placeholder-title">No audits yet</div>'
        + '<div class="view-placeholder-sub">Start an audit to verify your asset inventory</div></div>';
      return;
    }

    var columns = [
      { key: 'started_at', label: 'Started', render: function(r) { return fmtDateTime(r.started_at); } },
      { key: 'status', label: 'Status', render: function(r) {
        var colors = { in_progress: 'var(--amber)', completed: 'var(--green)' };
        var labels = { in_progress: 'In Progress', completed: 'Completed' };
        return '<span class="status-badge" style="--status-color:' + (colors[r.status] || 'var(--text3)') + '">'
          + (labels[r.status] || r.status) + '</span>';
      }},
      { key: 'total_expected', label: 'Expected', mono: true },
      { key: 'total_found', label: 'Found', mono: true, render: function(r) {
        return '<span style="color:var(--green);font-weight:600">' + (r.total_found || 0) + '</span>';
      }},
      { key: 'total_missing', label: 'Missing', mono: true, render: function(r) {
        var m = r.total_missing || 0;
        var pending = (r.total_expected || 0) - (r.total_found || 0) - m;
        if (r.status === 'completed') {
          return m > 0 ? '<span style="color:var(--red);font-weight:600">' + m + '</span>' : '0';
        }
        return '<span style="color:var(--text3)">' + pending + ' pending</span>';
      }},
      { key: 'notes', label: 'Notes', render: function(r) {
        return r.notes ? '<span style="font-size:12px;color:var(--text2)">' + esc(r.notes).substring(0, 40) + '</span>' : '';
      }}
    ];

    tableEl.innerHTML = renderTable({
      columns: columns,
      data: audits,
      onRowClick: 'viewAudit',
      emptyMsg: 'No audits'
    });
  } catch(e) {
    document.getElementById('audits-table').innerHTML = '<div class="table-empty">Failed to load audits</div>';
  }
}

function viewAudit(id) { navigate('#/audits/' + id); }
window.viewAudit = viewAudit;

// ─── New Audit ────────────────────────────────

async function openNewAudit() {
  var categories = [];
  try {
    var r = await API.getCategories();
    categories = r.flat || r.data || [];
  } catch(e) {}

  var html = '<div class="form-group"><label class="form-label">Scope</label>'
    + '<select id="audit-category" class="form-select">'
    + '<option value="">All assets</option>';
  categories.forEach(function(c) {
    if (c.parent_id) {
      html += '<option value="' + esc(c.id) + '">' + (c.icon || '') + ' ' + esc(c.name) + '</option>';
    }
  });
  html += '</select>'
    + '<div class="form-hint">Optionally limit to a specific category</div></div>';

  html += '<div class="form-group"><label class="form-label">Notes</label>'
    + '<textarea id="audit-notes" class="form-textarea" placeholder="e.g. Q2 2026 stocktake"></textarea></div>';

  html += '<button class="btn primary full" onclick="doStartAudit()">Start Audit</button>';

  openModal('Start New Audit', html);
}
window.openNewAudit = openNewAudit;

async function doStartAudit() {
  try {
    var data = {
      notes: document.getElementById('audit-notes').value.trim() || undefined
    };
    var cat = document.getElementById('audit-category').value;
    if (cat) data.category_id = cat;

    var result = await API.startAudit(data);
    closeModal();
    toast('Audit started — ' + result.total_expected + ' assets to verify', 'success');
    navigate('#/audits/' + result.id);
  } catch(e) { /* toasted */ }
}
window.doStartAudit = doStartAudit;

// ─── Audit Detail ─────────────────────────────

async function renderAuditDetail(auditId) {
  var el = document.getElementById('view-audit-detail');
  el.innerHTML = skeleton(8);

  try {
    var audit = await API.getAudit(auditId);
    var items = audit.items || [];
    var found = items.filter(function(i) { return i.status === 'found'; });
    var missing = items.filter(function(i) { return i.status === 'missing'; });
    var pending = items.filter(function(i) { return i.status === 'pending'; });
    var unexpected = items.filter(function(i) { return i.status === 'moved'; });

    var html = '<div style="margin-bottom:16px"><button class="btn sm" onclick="navigate(\'#/audits\')">&larr; Back to Audits</button></div>';

    // Header
    var statusColor = audit.status === 'completed' ? 'var(--green)' : 'var(--amber)';
    var statusLabel = audit.status === 'completed' ? 'Completed' : 'In Progress';
    html += '<div class="detail-header">'
      + '<div class="detail-header-info">'
      + '<div class="detail-header-name">Audit <span class="status-badge" style="--status-color:' + statusColor + '">' + statusLabel + '</span></div>'
      + '<div style="font-size:12px;font-family:var(--mono);color:var(--text3)">Started ' + fmtDateTime(audit.started_at)
      + (audit.completed_at ? ' &middot; Completed ' + fmtDateTime(audit.completed_at) : '') + '</div>'
      + (audit.notes ? '<div style="font-size:13px;color:var(--text2);margin-top:4px">' + esc(audit.notes) + '</div>' : '')
      + '</div>'
      + '<div class="detail-header-actions">';

    if (audit.status === 'in_progress') {
      html += '<button class="btn primary sm" onclick="openAuditScan(\'' + esc(auditId) + '\')">Scan Asset</button>'
        + '<button class="btn danger sm" onclick="doCompleteAudit(\'' + esc(auditId) + '\')">Complete Audit</button>';
    }
    html += '</div></div>';

    // KPIs
    html += '<div class="kpi-row" style="margin-bottom:20px">'
      + auditKpi('Expected', audit.total_expected || items.length, 'var(--accent)')
      + auditKpi('Found', found.length, 'var(--green)')
      + auditKpi('Missing', audit.status === 'completed' ? missing.length : pending.length, pending.length > 0 && audit.status !== 'completed' ? 'var(--text3)' : (missing.length > 0 ? 'var(--red)' : 'var(--green)'))
      + auditKpi('Unexpected', unexpected.length, unexpected.length > 0 ? 'var(--amber)' : 'var(--text3)')
      + '</div>';

    // Progress bar
    var total = items.length || 1;
    var pctFound = Math.round((found.length / total) * 100);
    html += '<div style="margin-bottom:24px">'
      + '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">'
      + '<span>Progress</span><span style="font-family:var(--mono);font-weight:600">' + pctFound + '%</span></div>'
      + '<div style="height:8px;background:var(--surface3);border-radius:4px;overflow:hidden">'
      + '<div style="height:100%;width:' + pctFound + '%;background:var(--green);border-radius:4px;transition:width 0.3s"></div>'
      + '</div></div>';

    // Item tables
    if (missing.length > 0 && audit.status === 'completed') {
      html += auditItemTable('Missing', missing, 'var(--red)');
    }
    if (unexpected.length > 0) {
      html += auditItemTable('Unexpected', unexpected, 'var(--amber)');
    }
    if (pending.length > 0 && audit.status !== 'completed') {
      html += auditItemTable('Not Yet Scanned', pending, 'var(--text3)');
    }
    if (found.length > 0) {
      html += auditItemTable('Found', found, 'var(--green)');
    }

    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<div class="table-empty">Audit not found: ' + esc(e.message) + '</div>';
  }
}

function auditKpi(label, value, color) {
  return '<div class="kpi-card">'
    + '<div class="kpi-label">' + label + '</div>'
    + '<div class="kpi-value" style="color:' + color + '">' + value + '</div></div>';
}

function auditItemTable(title, items, color) {
  var html = '<div class="card" style="margin-bottom:16px">'
    + '<div class="card-header"><span class="card-title" style="color:' + color + '">' + esc(title) + ' (' + items.length + ')</span></div>'
    + '<div style="padding:0"><div class="table-wrap" style="border:none;border-radius:0"><table><thead><tr>'
    + '<th>Tag</th><th>Name</th><th>Serial</th>'
    + (items[0] && items[0].scanned_at ? '<th>Scanned</th>' : '')
    + (items[0] && items[0].notes ? '<th>Notes</th>' : '')
    + '</tr></thead><tbody>';
  items.forEach(function(i) {
    html += '<tr style="cursor:pointer" onclick="navigate(\'#/assets/' + esc(i.asset_id) + '\')">'
      + '<td class="mono">' + esc(i.asset_tag || '—') + '</td>'
      + '<td>' + esc(i.asset_name || '—') + '</td>'
      + '<td class="mono">' + esc(i.serial_number || '—') + '</td>'
      + (i.scanned_at ? '<td class="mono" style="font-size:11px">' + fmtDateTime(i.scanned_at) + '</td>' : '')
      + (i.notes ? '<td style="font-size:12px">' + esc(i.notes) + '</td>' : '')
      + '</tr>';
  });
  html += '</tbody></table></div></div></div>';
  return html;
}

// ─── Scan Modal ───────────────────────────────

function openAuditScan(auditId) {
  var html = '<div class="form-group"><label class="form-label">Asset Tag or Serial Number</label>'
    + '<input type="text" id="scan-input" class="form-input" placeholder="e.g. WSC-L-0001 or scan QR code" autofocus '
    + 'onkeydown="if(event.key===\'Enter\')doAuditScan(\'' + esc(auditId) + '\')">'
    + '<div class="form-hint">Type an asset tag, serial number, or scan a QR code</div></div>';

  html += '<div id="scan-result" style="margin-bottom:16px"></div>';

  html += '<div style="display:flex;gap:8px">'
    + '<button class="btn primary" onclick="doAuditScan(\'' + esc(auditId) + '\')">Scan</button>'
    + '<button class="btn" onclick="closeModal();renderAuditDetail(\'' + esc(auditId) + '\')">Done</button>'
    + '</div>';

  openModal('Scan Asset', html);
  setTimeout(function() {
    var inp = document.getElementById('scan-input');
    if (inp) inp.focus();
  }, 50);
}
window.openAuditScan = openAuditScan;

async function doAuditScan(auditId) {
  var input = document.getElementById('scan-input').value.trim();
  if (!input) return;

  var resultEl = document.getElementById('scan-result');

  try {
    var result = await API.scanAudit(auditId, { asset_tag: input });

    var colors = { found: 'var(--green)', already_scanned: 'var(--text3)', unexpected: 'var(--amber)' };
    var labels = { found: 'Found', already_scanned: 'Already scanned', unexpected: 'Unexpected — not in this audit' };
    var color = colors[result.status] || 'var(--text2)';
    var label = labels[result.status] || result.status;

    resultEl.innerHTML = '<div style="padding:12px;border-radius:8px;background:color-mix(in srgb, ' + color + ' 10%, transparent);border:1px solid color-mix(in srgb, ' + color + ' 30%, transparent);text-align:center">'
      + '<div style="font-size:15px;font-weight:600;color:' + color + '">' + label + '</div>'
      + '<div style="font-size:12px;font-family:var(--mono);color:var(--text3);margin-top:4px">' + esc(input) + '</div>'
      + '</div>';

    // Clear and refocus for next scan
    document.getElementById('scan-input').value = '';
    document.getElementById('scan-input').focus();
  } catch(e) {
    resultEl.innerHTML = '<div style="padding:12px;border-radius:8px;background:color-mix(in srgb, var(--red) 10%, transparent);border:1px solid color-mix(in srgb, var(--red) 30%, transparent);text-align:center">'
      + '<div style="font-size:13px;color:var(--red)">' + esc(e.message) + '</div></div>';
  }
}
window.doAuditScan = doAuditScan;

// ─── Complete Audit ───────────────────────────

async function doCompleteAudit(auditId) {
  var ok = await confirmDialog('Complete this audit? All unscanned assets will be marked as missing.', 'Complete Audit');
  if (!ok) return;

  try {
    var result = await API.completeAudit(auditId);
    toast('Audit completed — ' + result.total_found + ' found, ' + result.total_missing + ' missing', 'success');
    renderAuditDetail(auditId);
  } catch(e) { /* toasted */ }
}
window.doCompleteAudit = doCompleteAudit;
