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
    + (Auth.isManager() ? '<button class="btn primary sm" onclick="openNewAudit()">+ New Audit</button>' : '')
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

    var html = '';
    audits.forEach(function(a) {
      var isActive = a.status === 'in_progress';
      var found = a.total_found || 0;
      var expected = a.total_expected || 0;
      var missing = a.total_missing || 0;
      var pct = expected > 0 ? Math.round((found / expected) * 100) : 0;

      html += '<div class="card" style="margin-bottom:12px;cursor:pointer" onclick="viewAudit(\'' + esc(a.id) + '\')">'
        + '<div class="card-body" style="padding:16px">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
        + '<div>'
        + '<span style="font-weight:600;font-size:14px">' + esc(a.notes || 'Audit') + '</span> '
        + '<span class="badge ' + (isActive ? 'maintenance' : 'available') + '">'
        + (isActive ? 'In Progress' : 'Completed') + '</span>'
        + '</div>'
        + '<div style="display:flex;gap:8px;align-items:center">'
        + '<span style="font-size:11px;font-family:var(--mono);color:var(--text3)">' + fmtDateTime(a.started_at) + '</span>'
        + '<button class="btn danger sm" onclick="event.stopPropagation();deleteAudit(\'' + esc(a.id) + '\')">Delete</button>'
        + '</div></div>'
        + '<div style="display:flex;gap:24px;font-size:13px;margin-bottom:8px">'
        + '<span><strong>' + expected + '</strong> expected</span>'
        + '<span style="color:var(--green)"><strong>' + found + '</strong> found</span>';
      if (a.status === 'completed') {
        html += '<span style="color:' + (missing > 0 ? 'var(--red)' : 'var(--green)') + '"><strong>' + missing + '</strong> missing</span>';
      } else {
        html += '<span style="color:var(--text3)"><strong>' + (expected - found) + '</strong> remaining</span>';
      }
      html += '</div>'
        + '<div style="height:6px;background:var(--surface3);border-radius:3px;overflow:hidden">'
        + '<div style="height:100%;width:' + pct + '%;background:var(--green);border-radius:3px"></div>'
        + '</div></div></div>';
    });

    tableEl.innerHTML = html;
  } catch(e) {
    document.getElementById('audits-table').innerHTML = '<div class="table-empty">Failed to load audits</div>';
  }
}

function viewAudit(id) { navigate('#/audits/' + id); }
window.viewAudit = viewAudit;

// ─── New Audit ────────────────────────────────

async function openNewAudit() {
  var html = '<div class="form-group"><label class="form-label">Audit Name</label>'
    + '<input type="text" id="audit-notes" class="form-input" placeholder="e.g. Q2 2026 Stocktake">'
    + '</div>';

  html += '<button class="btn primary full" onclick="doStartAudit()">Start Audit</button>';
  openModal('Start New Audit', html);
}
window.openNewAudit = openNewAudit;

async function doStartAudit() {
  try {
    var result = await API.startAudit({
      notes: document.getElementById('audit-notes').value.trim() || undefined
    });
    closeModal();
    toast('Audit started — ' + result.total_expected + ' assets to check', 'success');
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
    var isActive = audit.status === 'in_progress';

    var html = '<div style="margin-bottom:10px"><button class="btn sm" onclick="navigate(\'#/audits\')">&larr; Back</button></div>';

    // Header
    html += '<div class="detail-header">'
      + '<div class="detail-header-info">'
      + '<div class="detail-header-name">' + esc(audit.notes || 'Audit') + ' '
      + '<span class="badge ' + (isActive ? 'maintenance' : 'available') + '">'
      + (isActive ? 'In Progress' : 'Completed') + '</span></div>'
      + '<div style="font-size:12px;font-family:var(--mono);color:var(--text3)">'
      + fmtDateTime(audit.started_at)
      + (audit.completed_at ? ' — ' + fmtDateTime(audit.completed_at) : '')
      + '</div></div>'
      + '<div class="detail-header-actions">';

    if (isActive && Auth.isManager()) {
      html += '<button class="btn primary sm" onclick="openAuditScan(\'' + esc(auditId) + '\')">Scan Asset</button>'
        + '<button class="btn sm" onclick="doCompleteAudit(\'' + esc(auditId) + '\')">Finish Audit</button>';
    }
    if (Auth.isManager()) {
      html += '<button class="btn danger sm" onclick="deleteAudit(\'' + esc(auditId) + '\')">Delete</button>';
    }
    html += '</div></div>';

    // Stats row
    var total = audit.total_expected || items.length || 1;
    var pct = Math.round((found.length / total) * 100);
    html += '<div style="display:flex;gap:16px;margin-bottom:16px">'
      + statBox('Expected', total, 'var(--accent)')
      + statBox('Found', found.length, 'var(--green)')
      + statBox(isActive ? 'Remaining' : 'Missing', isActive ? pending.length : missing.length, isActive ? 'var(--text3)' : (missing.length > 0 ? 'var(--red)' : 'var(--green)'))
      + (unexpected.length > 0 ? statBox('Unexpected', unexpected.length, 'var(--amber)') : '')
      + '</div>';

    // Progress
    html += '<div style="margin-bottom:16px">'
      + '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">'
      + '<span>Progress</span><span style="font-weight:600">' + pct + '%</span></div>'
      + '<div style="height:5px;background:var(--surface3);border-radius:3px;overflow:hidden">'
      + '<div style="height:100%;width:' + pct + '%;background:var(--green);border-radius:3px"></div>'
      + '</div></div>';

    // Tables
    if (missing.length > 0) html += itemTable('Missing', missing, 'var(--red)');
    if (unexpected.length > 0) html += itemTable('Unexpected', unexpected, 'var(--amber)');
    if (pending.length > 0 && isActive) html += itemTable('Not Yet Scanned', pending, 'var(--text3)');
    if (found.length > 0) html += itemTable('Found', found, 'var(--green)');

    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<div class="table-empty">Audit not found</div>';
  }
}

function statBox(label, value, color) {
  return '<div style="flex:1;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);text-align:center">'
    + '<div style="font-size:20px;font-weight:700;color:' + color + '">' + value + '</div>'
    + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:var(--text3);margin-top:2px">' + label + '</div></div>';
}

function itemTable(title, items, color) {
  var html = '<div class="card" style="margin-bottom:12px">'
    + '<div class="card-header"><span class="card-title" style="color:' + color + '">' + esc(title) + ' (' + items.length + ')</span></div>'
    + '<div style="padding:0"><div class="table-wrap" style="border:none;border-radius:0"><table><thead><tr>'
    + '<th>Tag</th><th>Name</th><th>Serial</th></tr></thead><tbody>';
  items.forEach(function(i) {
    html += '<tr style="cursor:pointer" onclick="navigate(\'#/assets/' + esc(i.asset_id) + '\')">'
      + '<td class="mono">' + esc(i.asset_tag || '—') + '</td>'
      + '<td>' + esc(i.asset_name || '—') + '</td>'
      + '<td class="mono">' + esc(i.serial_number || '—') + '</td></tr>';
  });
  html += '</tbody></table></div></div></div>';
  return html;
}

// ─── Scan ─────────────────────────────────────

function openAuditScan(auditId) {
  var html = '<div class="form-group"><label class="form-label">Asset Tag</label>'
    + '<input type="text" id="scan-input" class="form-input" placeholder="Type or scan asset tag" '
    + 'onkeydown="if(event.key===\'Enter\')doAuditScan(\'' + esc(auditId) + '\')">'
    + '</div>'
    + '<div id="scan-result" style="margin-bottom:16px"></div>'
    + '<div style="display:flex;gap:8px">'
    + '<button class="btn primary" onclick="doAuditScan(\'' + esc(auditId) + '\')">Scan</button>'
    + '<button class="btn" onclick="closeModal();renderAuditDetail(\'' + esc(auditId) + '\')">Done</button>'
    + '</div>';

  openModal('Scan Asset', html);
  setTimeout(function() { var i = document.getElementById('scan-input'); if (i) i.focus(); }, 50);
}
window.openAuditScan = openAuditScan;

async function doAuditScan(auditId) {
  var input = document.getElementById('scan-input').value.trim();
  if (!input) return;
  var resultEl = document.getElementById('scan-result');

  try {
    var result = await API.scanAudit(auditId, { asset_tag: input });
    var msgs = { found: 'Found', already_scanned: 'Already scanned', unexpected: 'Not in this audit' };
    var colors = { found: 'var(--green)', already_scanned: 'var(--text3)', unexpected: 'var(--amber)' };
    resultEl.innerHTML = '<div style="padding:12px;border-radius:8px;text-align:center;background:color-mix(in srgb, ' + (colors[result.status] || 'var(--text2)') + ' 10%, transparent)">'
      + '<div style="font-size:15px;font-weight:600;color:' + (colors[result.status] || 'var(--text2)') + '">' + (msgs[result.status] || result.status) + '</div>'
      + '<div style="font-size:12px;font-family:var(--mono);color:var(--text3);margin-top:4px">' + esc(input) + '</div></div>';
    document.getElementById('scan-input').value = '';
    document.getElementById('scan-input').focus();
  } catch(e) {
    resultEl.innerHTML = '<div style="padding:12px;border-radius:8px;text-align:center;background:color-mix(in srgb, var(--red) 10%, transparent)">'
      + '<div style="font-size:13px;color:var(--red)">' + esc(e.message) + '</div></div>';
  }
}
window.doAuditScan = doAuditScan;

// ─── Complete & Delete ────────────────────────

async function doCompleteAudit(auditId) {
  var ok = await confirmDialog('Finish this audit? All unscanned assets will be marked as missing.', 'Finish Audit');
  if (!ok) return;
  try {
    var result = await API.completeAudit(auditId);
    var cleanSweep = result.total_found > 0 && result.total_missing === 0;
    if (cleanSweep) {
      toast('Clean sweep — all ' + result.total_found + ' assets accounted for', 'success');
      // Rare, earned celebration: only fires on a perfect audit.
      if (typeof confetti === 'function') confetti();
    } else {
      toast('Done — ' + result.total_found + ' found, ' + result.total_missing + ' missing', 'success');
    }
    renderAuditDetail(auditId);
  } catch(e) { /* toasted */ }
}
window.doCompleteAudit = doCompleteAudit;

async function deleteAudit(auditId) {
  var ok = await confirmDialog('Delete this audit permanently?', 'Delete');
  if (!ok) return;
  try {
    await API.deleteAudit(auditId);
    toast('Audit deleted', 'success');
    navigate('#/audits');
  } catch(e) { /* toasted */ }
}
window.deleteAudit = deleteAudit;
