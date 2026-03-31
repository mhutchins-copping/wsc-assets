// ─── Step 10: Dashboard View ───────────────────

Router.register('/', function() {
  var el = document.getElementById('view-dashboard');

  // Quick actions row
  var quickActions = '<div style="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap">'
    + '<button class="btn primary sm" onclick="navigate(\'#/assets/new\')">+ New Asset</button>'
    + '<button class="btn sm" onclick="navigate(\'#/people\')">Manage People</button>'
    + '<button class="btn sm" onclick="navigate(\'#/locations\')">Locations</button>'
    + '</div>';

  // KPI row
  var kpiRow = '<div class="kpi-row" id="dash-kpis">'
    + kpiCard('dash-kpi-total', 'Total Assets', '—', 'All tracked assets', 'var(--accent)')
    + kpiCard('dash-kpi-deployed', 'Deployed', '—', 'Currently assigned', '#2563eb')
    + kpiCard('dash-kpi-available', 'Available', '—', 'Ready for use', '#10b981')
    + kpiCard('dash-kpi-maintenance', 'Maintenance', '—', 'Under repair', '#f59e0b')
    + kpiCard('dash-kpi-retired', 'Retired', '—', 'End of life', '#6b7280')
    + '</div>';

  // Two-column grid
  var grid = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px" id="dash-grid">'
    // Recent Activity
    + '<div class="card"><div class="card-header"><span class="card-title">Recent Activity</span>'
    + '<button class="btn sm" onclick="navigate(\'#/assets\')">View All</button></div>'
    + '<div class="card-body" id="dash-activity" style="max-height:400px;overflow-y:auto">' + skeleton(5) + '</div></div>'
    // Warranty Alerts
    + '<div class="card"><div class="card-header"><span class="card-title">Warranty Alerts</span>'
    + '<span style="font-size:11px;font-family:var(--mono);color:var(--text3)">Next 90 days</span></div>'
    + '<div class="card-body" id="dash-warranty" style="max-height:400px;overflow-y:auto">' + skeleton(5) + '</div></div>'
    + '</div>';

  // Second row: by category + by location
  var grid2 = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px">'
    + '<div class="card"><div class="card-header"><span class="card-title">Assets by Category</span></div>'
    + '<div class="card-body" id="dash-by-category">' + skeleton(4) + '</div></div>'
    + '<div class="card"><div class="card-header"><span class="card-title">Assets by Location</span></div>'
    + '<div class="card-body" id="dash-by-location">' + skeleton(4) + '</div></div>'
    + '</div>';

  el.innerHTML = quickActions + kpiRow + grid + grid2;

  loadDashboardData();
});

function kpiCard(id, label, value, sub, accent) {
  return '<div class="kpi-card" id="' + id + '">'
    + '<div class="kpi-label">' + esc(label) + '</div>'
    + '<div class="kpi-value" style="color:' + (accent || 'var(--text)') + '">' + esc(value) + '</div>'
    + '<div class="kpi-sub">' + esc(sub) + '</div></div>';
}

async function loadDashboardData() {
  if (!API.baseUrl || !API.apiKey) {
    var placeholder = '<div class="view-placeholder" style="padding:30px 0">'
      + '<div class="view-placeholder-sub">Configure API in Settings to see live data</div></div>';
    ['dash-activity', 'dash-warranty', 'dash-by-category', 'dash-by-location'].forEach(function(id) {
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
        var actionColors = { create: 'var(--green)', checkout: 'var(--accent)', checkin: 'var(--amber)', update: 'var(--text2)', dispose: 'var(--red)', maintenance: 'var(--amber)' };
        var color = actionColors[a.action] || 'var(--text2)';
        return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">'
          + '<div style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0"></div>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:13px"><span style="font-weight:600;cursor:pointer" onclick="navigate(\'#/assets/' + esc(a.asset_id || '') + '\')">' + esc(a.asset_name || a.asset_tag || 'Unknown') + '</span>'
          + ' <span style="color:var(--text3)">' + esc(a.action) + '</span></div>'
          + '<div style="font-size:11px;font-family:var(--mono);color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(a.details || '') + '</div>'
          + '</div>'
          + '<div style="font-size:10px;font-family:var(--mono);color:var(--text3);white-space:nowrap">' + fmtDateTime(a.created_at) + '</div>'
          + '</div>';
      }).join('');
    } else {
      actEl.innerHTML = '<div class="table-empty" style="padding:20px 0">No recent activity</div>';
    }

    // Warranty alerts
    var wEl = document.getElementById('dash-warranty');
    if (stats.warranty_alerts && stats.warranty_alerts.length) {
      wEl.innerHTML = stats.warranty_alerts.map(function(w) {
        var urgency = w.days_remaining <= 30 ? 'var(--red)' : (w.days_remaining <= 60 ? 'var(--amber)' : 'var(--text2)');
        var bgColor = w.days_remaining <= 30 ? 'var(--red-l, #fee2e2)' : 'transparent';
        return '<div style="display:flex;align-items:center;gap:12px;padding:10px 8px;border-bottom:1px solid var(--border);border-radius:6px;background:' + bgColor + '">'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:13px;font-weight:500;cursor:pointer" onclick="navigate(\'#/assets/' + esc(w.id) + '\')">' + esc(w.name) + '</div>'
          + '<div style="font-size:11px;font-family:var(--mono);color:var(--text3)">' + esc(w.asset_tag) + ' &middot; expires ' + fmtDate(w.warranty_expiry) + '</div>'
          + '</div>'
          + '<div style="font-size:13px;font-weight:700;font-family:var(--mono);color:' + urgency + ';white-space:nowrap">' + w.days_remaining + 'd</div>'
          + '</div>';
      }).join('');
    } else {
      wEl.innerHTML = '<div class="table-empty" style="padding:20px 0">No warranties expiring soon</div>';
    }

    // By Category — horizontal bars
    var catEl = document.getElementById('dash-by-category');
    if (stats.by_category && stats.by_category.length) {
      var maxCat = Math.max.apply(null, stats.by_category.map(function(c) { return c.count; })) || 1;
      catEl.innerHTML = stats.by_category.filter(function(c) { return c.count > 0; }).map(function(c) {
        var pct = Math.round((c.count / maxCat) * 100);
        return '<div style="margin-bottom:10px">'
          + '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">'
          + '<span>' + (c.icon ? c.icon + ' ' : '') + esc(c.name) + '</span>'
          + '<span style="font-family:var(--mono);font-weight:600">' + c.count + '</span></div>'
          + '<div style="height:6px;background:var(--surface3);border-radius:3px;overflow:hidden">'
          + '<div style="height:100%;width:' + pct + '%;background:var(--accent);border-radius:3px;transition:width 0.5s ease"></div>'
          + '</div></div>';
      }).join('');
      if (!catEl.innerHTML) catEl.innerHTML = '<div class="table-empty" style="padding:20px 0">No data</div>';
    } else {
      catEl.innerHTML = '<div class="table-empty" style="padding:20px 0">No data</div>';
    }

    // By Location — horizontal bars
    var locEl = document.getElementById('dash-by-location');
    if (stats.by_location && stats.by_location.length) {
      var maxLoc = Math.max.apply(null, stats.by_location.map(function(l) { return l.count; })) || 1;
      locEl.innerHTML = stats.by_location.filter(function(l) { return l.count > 0; }).map(function(l) {
        var pct = Math.round((l.count / maxLoc) * 100);
        return '<div style="margin-bottom:10px">'
          + '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">'
          + '<span>' + esc(l.name) + '</span>'
          + '<span style="font-family:var(--mono);font-weight:600">' + l.count + '</span></div>'
          + '<div style="height:6px;background:var(--surface3);border-radius:3px;overflow:hidden">'
          + '<div style="height:100%;width:' + pct + '%;background:var(--green);border-radius:3px;transition:width 0.5s ease"></div>'
          + '</div></div>';
      }).join('');
      if (!locEl.innerHTML) locEl.innerHTML = '<div class="table-empty" style="padding:20px 0">No data</div>';
    } else {
      locEl.innerHTML = '<div class="table-empty" style="padding:20px 0">No data</div>';
    }

  } catch(e) {
    // API error — leave skeletons or show message
  }
}
window.loadDashboardData = loadDashboardData;

function setKpi(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  var valEl = el.querySelector('.kpi-value');
  if (valEl) {
    valEl.textContent = value;
    valEl.style.animation = 'none';
    valEl.offsetHeight; // force reflow
    valEl.style.animation = 'kpiPop 0.3s ease';
  }
}
