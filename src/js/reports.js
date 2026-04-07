// ─── Reports View ──────────────────────────────

Router.register('/reports', function() {
  var el = document.getElementById('view-reports');

  el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">'
    + '<div></div>'
    + '<div style="display:flex;gap:8px">'
    + '<button class="btn sm" onclick="exportReportCSV()">Export CSV</button>'
    + '<button class="btn sm" onclick="loadReports()">Refresh</button>'
    + '</div></div>'

    // KPI summary row
    + '<div class="kpi-row" id="rpt-kpis"></div>'

    // Row 1: Status + Category
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px" id="rpt-row1">'
    + '<div class="card"><div class="card-header"><span class="card-title">Assets by Status</span></div>'
    + '<div class="card-body" id="rpt-status">' + skeleton(4) + '</div></div>'
    + '<div class="card"><div class="card-header"><span class="card-title">Assets by Category</span></div>'
    + '<div class="card-body" id="rpt-category">' + skeleton(4) + '</div></div>'
    + '</div>'

    // Row 2: Department + Top Assigned
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px">'
    + '<div class="card"><div class="card-header"><span class="card-title">Deployed by Department</span></div>'
    + '<div class="card-body" id="rpt-department">' + skeleton(4) + '</div></div>'
    + '<div class="card"><div class="card-header"><span class="card-title">Top Assigned People</span></div>'
    + '<div class="card-body" id="rpt-assigned">' + skeleton(4) + '</div></div>'
    + '</div>'

    // Row 3: Age + Cost
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px">'
    + '<div class="card"><div class="card-header"><span class="card-title">Asset Age Distribution</span></div>'
    + '<div class="card-body" id="rpt-age">' + skeleton(4) + '</div></div>'
    + '<div class="card"><div class="card-header"><span class="card-title">Cost by Category</span></div>'
    + '<div class="card-body" id="rpt-cost">' + skeleton(4) + '</div></div>'
    + '</div>'

    // Row 4: OS + Manufacturer
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px">'
    + '<div class="card"><div class="card-header"><span class="card-title">Operating Systems</span></div>'
    + '<div class="card-body" id="rpt-os">' + skeleton(4) + '</div></div>'
    + '<div class="card"><div class="card-header"><span class="card-title">Top Manufacturers</span></div>'
    + '<div class="card-body" id="rpt-manufacturer">' + skeleton(4) + '</div></div>'
    + '</div>';

  loadReports();
});

async function loadReports() {
  try {
    var data = await API.getReports();
    renderReportKPIs(data);
    renderBarChart('rpt-status', data.by_status, 'status', 'count', statusColor);
    renderCategoryTable('rpt-category', data.by_category);
    renderBarChart('rpt-department', data.by_department, 'department', 'count');
    renderAssignedTable('rpt-assigned', data.top_assigned);
    renderBarChart('rpt-age', data.age_distribution, 'age_group', 'count', ageColor);
    renderCostTable('rpt-cost', data.cost_by_category);
    renderBarChart('rpt-os', data.by_os, 'os', 'count');
    renderBarChart('rpt-manufacturer', data.by_manufacturer, 'manufacturer', 'count');
  } catch(e) {
    toast('Failed to load reports: ' + e.message, 'error');
    ['rpt-status','rpt-category','rpt-department','rpt-assigned','rpt-age','rpt-cost','rpt-os','rpt-manufacturer'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="table-empty" style="padding:20px 0">Failed to load</div>';
    });
  }
}
window.loadReports = loadReports;

function renderReportKPIs(data) {
  var el = document.getElementById('rpt-kpis');
  if (!el) return;

  var statusMap = {};
  (data.by_status || []).forEach(function(s) { statusMap[s.status] = s.count; });
  var total = 0;
  (data.by_status || []).forEach(function(s) { if (s.status !== 'disposed') total += s.count; });

  el.innerHTML = kpiCard('rpt-k-total', 'Active Assets', total, 'Excludes disposed', 'var(--accent)')
    + kpiCard('rpt-k-deployed', 'Deployed', statusMap.deployed || 0, 'Currently assigned', '#2563eb')
    + kpiCard('rpt-k-available', 'Available', statusMap.available || 0, 'Ready for use', '#10b981')
    + kpiCard('rpt-k-cost', 'Total Value', fmtCurrency(data.cost_summary.total_cost), (data.cost_summary.total_assets || 0) + ' assets with cost', '#8b5cf6')
    + kpiCard('rpt-k-new', 'Added (30d)', data.recently_added || 0, 'Last 30 days', '#f59e0b')
    + kpiCard('rpt-k-disposed', 'Disposed', data.disposed_count || 0, 'End of life', '#6b7280');
}

// ─── Chart Helpers ─────────────────────────────

function statusColor(val) {
  var colors = { deployed: '#2563eb', available: '#10b981', maintenance: '#f59e0b', retired: '#6b7280', disposed: '#ef4444' };
  return colors[val] || 'var(--accent)';
}

function ageColor(val) {
  var colors = { '< 1 year': '#10b981', '1-2 years': '#2563eb', '2-3 years': '#8b5cf6', '3-5 years': '#f59e0b', '5+ years': '#ef4444', 'Unknown': '#6b7280' };
  return colors[val] || 'var(--accent)';
}

function renderBarChart(containerId, items, labelKey, valueKey, colorFn) {
  var el = document.getElementById(containerId);
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = '<div class="table-empty" style="padding:20px 0">No data</div>';
    return;
  }

  var max = Math.max.apply(null, items.map(function(i) { return i[valueKey]; })) || 1;
  el.innerHTML = items.map(function(item) {
    var pct = Math.round((item[valueKey] / max) * 100);
    var color = colorFn ? colorFn(item[labelKey]) : 'var(--accent)';
    return '<div style="margin-bottom:10px">'
      + '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">'
      + '<span>' + esc(item[labelKey]) + '</span>'
      + '<span style="font-family:var(--mono);font-weight:600">' + item[valueKey] + '</span></div>'
      + '<div style="height:6px;background:var(--surface3);border-radius:3px;overflow:hidden">'
      + '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:3px;transition:width 0.5s ease"></div>'
      + '</div></div>';
  }).join('');
}

function renderCategoryTable(containerId, items) {
  var el = document.getElementById(containerId);
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = '<div class="table-empty" style="padding:20px 0">No data</div>';
    return;
  }

  var html = '<table class="table"><thead><tr>'
    + '<th>Category</th><th style="text-align:right">Total</th>'
    + '<th style="text-align:right">Deployed</th><th style="text-align:right">Available</th>'
    + '<th style="text-align:right">Maint.</th></tr></thead><tbody>';

  items.forEach(function(c) {
    if (c.count === 0) return;
    html += '<tr>'
      + '<td>' + (c.icon ? c.icon + ' ' : '') + esc(c.name) + '</td>'
      + '<td style="text-align:right;font-family:var(--mono);font-weight:600">' + c.count + '</td>'
      + '<td style="text-align:right;font-family:var(--mono);color:#2563eb">' + (c.deployed || 0) + '</td>'
      + '<td style="text-align:right;font-family:var(--mono);color:#10b981">' + (c.available || 0) + '</td>'
      + '<td style="text-align:right;font-family:var(--mono);color:#f59e0b">' + (c.maintenance || 0) + '</td>'
      + '</tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function renderAssignedTable(containerId, items) {
  var el = document.getElementById(containerId);
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = '<div class="table-empty" style="padding:20px 0">No assigned assets</div>';
    return;
  }

  var html = '<table class="table"><thead><tr>'
    + '<th>Person</th><th>Department</th><th style="text-align:right">Assets</th>'
    + '</tr></thead><tbody>';

  items.forEach(function(p) {
    html += '<tr>'
      + '<td style="font-weight:500">' + esc(p.name) + '</td>'
      + '<td style="color:var(--text3)">' + esc(p.department || '—') + '</td>'
      + '<td style="text-align:right;font-family:var(--mono);font-weight:600">' + p.count + '</td>'
      + '</tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function renderCostTable(containerId, items) {
  var el = document.getElementById(containerId);
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = '<div class="table-empty" style="padding:20px 0">No cost data</div>';
    return;
  }

  var html = '<table class="table"><thead><tr>'
    + '<th>Category</th><th style="text-align:right">Assets</th><th style="text-align:right">Total Cost</th>'
    + '</tr></thead><tbody>';

  var grandTotal = 0;
  items.forEach(function(c) {
    grandTotal += c.total_cost || 0;
    html += '<tr>'
      + '<td>' + (c.icon ? c.icon + ' ' : '') + esc(c.name) + '</td>'
      + '<td style="text-align:right;font-family:var(--mono)">' + c.count + '</td>'
      + '<td style="text-align:right;font-family:var(--mono);font-weight:600">' + fmtCurrency(c.total_cost) + '</td>'
      + '</tr>';
  });
  html += '<tr style="border-top:2px solid var(--border);font-weight:700">'
    + '<td>Total</td><td></td>'
    + '<td style="text-align:right;font-family:var(--mono)">' + fmtCurrency(grandTotal) + '</td>'
    + '</tr>';
  html += '</tbody></table>';
  el.innerHTML = html;
}

// ─── CSV Export ─────────────────────────────────

async function exportReportCSV() {
  try {
    var res = await API.exportCSV();
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'wsc-assets-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exported', 'success');
  } catch(e) {
    // Error already toasted
  }
}
window.exportReportCSV = exportReportCSV;
