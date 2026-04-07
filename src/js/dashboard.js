// ─── Dashboard View ────────────────────────────

Router.register('/', function() {
  var el = document.getElementById('view-dashboard');

  // KPI row
  var kpiRow = '<div class="kpi-row" id="dash-kpis">'
    + kpiCard('dash-kpi-total', 'Total Assets', '—', 'All tracked assets', 'var(--accent)')
    + kpiCard('dash-kpi-deployed', 'Deployed', '—', 'Currently assigned', '#2563eb')
    + kpiCard('dash-kpi-available', 'Available', '—', 'Ready for use', '#16a34a')
    + kpiCard('dash-kpi-maintenance', 'Maintenance', '—', 'Under repair', '#d97706')
    + kpiCard('dash-kpi-retired', 'Retired', '—', 'End of life', '#6b7280')
    + '</div>';

  // Two-column grid
  var grid = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" id="dash-grid">'
    // Recent Activity
    + '<div class="card"><div class="card-header"><span class="card-title">Recent Activity</span>'
    + '<button class="btn sm" onclick="navigate(\'#/assets\')">View All</button></div>'
    + '<div class="card-body" id="dash-activity" style="max-height:360px;overflow-y:auto">' + skeleton(5) + '</div></div>'
    // Assets by Category
    + '<div class="card"><div class="card-header"><span class="card-title">Assets by Category</span></div>'
    + '<div class="card-body" id="dash-by-category">' + skeleton(4) + '</div></div>'
    + '</div>';

  el.innerHTML = kpiRow + grid;

  loadDashboardData();
});

function kpiCard(id, label, value, sub, accent) {
  return '<div class="kpi-card" id="' + id + '">'
    + '<div class="kpi-label">' + esc(label) + '</div>'
    + '<div class="kpi-value" style="color:' + (accent || 'var(--text)') + '">' + esc(value) + '</div>'
    + '<div class="kpi-sub">' + esc(sub) + '</div></div>';
}

async function loadDashboardData() {
  if (!API.baseUrl) {
    var placeholder = '<div class="view-placeholder" style="padding:24px 0">'
      + '<div class="view-placeholder-sub">Configure API in Settings to see live data</div></div>';
    ['dash-activity', 'dash-by-category'].forEach(function(id) {
      var e = document.getElementById(id);
      if (e) e.innerHTML = placeholder;
    });
    return;
  }

  try {
    var stats = await API.getStats();

    // KPI values
    var statusMap = {};
    (stats.by_status || []).forEach(function(s) { statusMap[s.status] = s.count; });

    setKpi('dash-kpi-total', stats.total || 0);
    setKpi('dash-kpi-deployed', statusMap.deployed || 0);
    setKpi('dash-kpi-available', statusMap.available || 0);
    setKpi('dash-kpi-maintenance', statusMap.maintenance || 0);
    setKpi('dash-kpi-retired', statusMap.retired || 0);

    // Recent Activity
    var actEl = document.getElementById('dash-activity');
    if (stats.recent_activity && stats.recent_activity.length) {
      actEl.innerHTML = stats.recent_activity.map(function(a) {
        var actionColors = { create: 'var(--green)', checkout: 'var(--accent)', checkin: 'var(--amber)', update: 'var(--text3)', dispose: 'var(--red)', maintenance: 'var(--amber)' };
        var color = actionColors[a.action] || 'var(--text3)';
        return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">'
          + '<div style="width:6px;height:6px;border-radius:50%;background:' + color + ';flex-shrink:0"></div>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:12px"><span style="font-weight:600;cursor:pointer" onclick="navigate(\'#/assets/' + esc(a.asset_id || '') + '\')">' + esc(a.asset_name || a.asset_tag || 'Unknown') + '</span>'
          + ' <span style="color:var(--text3)">' + esc(a.action) + '</span></div>'
          + '<div style="font-size:11px;font-family:var(--mono);color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(a.details || '') + '</div>'
          + '</div>'
          + '<div style="font-size:10px;font-family:var(--mono);color:var(--text3);white-space:nowrap">' + fmtDateTime(a.created_at) + '</div>'
          + '</div>';
      }).join('');
    } else {
      actEl.innerHTML = '<div class="table-empty" style="padding:16px 0">No recent activity</div>';
    }

    // By Category — horizontal bars
    var catEl = document.getElementById('dash-by-category');
    if (stats.by_category && stats.by_category.length) {
      var maxCat = Math.max.apply(null, stats.by_category.map(function(c) { return c.count; })) || 1;
      catEl.innerHTML = stats.by_category.filter(function(c) { return c.count > 0; }).map(function(c) {
        var pct = Math.round((c.count / maxCat) * 100);
        return '<div style="margin-bottom:8px">'
          + '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px">'
          + '<span>' + (c.icon ? c.icon + ' ' : '') + esc(c.name) + '</span>'
          + '<span style="font-family:var(--mono);font-weight:600">' + c.count + '</span></div>'
          + '<div style="height:5px;background:var(--surface3);border-radius:3px;overflow:hidden">'
          + '<div style="height:100%;width:' + pct + '%;background:var(--accent);border-radius:3px;transition:width 0.4s ease"></div>'
          + '</div></div>';
      }).join('');
      if (!catEl.innerHTML) catEl.innerHTML = '<div class="table-empty" style="padding:16px 0">No data</div>';
    } else {
      catEl.innerHTML = '<div class="table-empty" style="padding:16px 0">No data</div>';
    }

  } catch(e) {
    // API error
  }
}
window.loadDashboardData = loadDashboardData;
window.kpiCard = kpiCard;

function setKpi(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  var valEl = el.querySelector('.kpi-value');
  if (valEl) {
    valEl.textContent = value;
    valEl.style.animation = 'none';
    valEl.offsetHeight;
    valEl.style.animation = 'kpiPop 0.3s ease';
  }
}
