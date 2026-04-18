// ─── Dashboard View v2 ────────────────────────────

Router.register('/', function() {
  var el = document.getElementById('view-dashboard');
  el.innerHTML = renderDashboardSkeleton();
  loadDashboardData();
});

function renderDashboardSkeleton() {
  return '<div class="dash-kpi-row" id="dash-kpis">' + renderKPISkeleton() + renderKPISkeleton() + renderKPISkeleton() + renderKPISkeleton() + '</div>'
    + '<div class="dash-grid">'
    + '<div class="dash-section"><div class="dash-section-title">Status Breakdown</div><div class="dash-bar-area" id="dash-status">' + renderSkeletonBlock(120) + '</div></div>'
    + '<div class="dash-section"><div class="dash-section-title">Recent Activity</div><div class="dash-activity-list" id="dash-activity">' + renderSkeletonBlock(200) + '</div></div>'
    + '</div>'
    + '<div class="dash-grid">'
    + '<div class="dash-section"><div class="dash-section-title">Assets by Category</div><div class="dash-minibar-area" id="dash-category">' + renderSkeletonBlock(160) + '</div></div>'
    + '<div class="dash-section"><div class="dash-section-title">Assets by Location</div><div class="dash-minibar-area" id="dash-location">' + renderSkeletonBlock(160) + '</div></div>'
    + '</div>';
}

function renderKPISkeleton() {
  return '<div class="dash-kpi"><div class="dash-kpi-label">Loading</div><div class="dash-kpi-value dash-skeleton"></div><div class="dash-kpi-sub"></div></div>';
}

function renderSkeletonBlock(height) {
  return '<div class="dash-skeleton-block" style="height:' + height + 'px"></div>';
}

async function loadDashboardData() {
  if (!API.baseUrl) return;
  try {
    var stats = await API.getStats();
    renderDashboard(stats);
  } catch(e) {
    console.error('dashboard load error:', e);
  }
}

function renderDashboard(stats) {
  var kpiTotal = stats.total || 0;
  var inService = ((stats.by_status || []).reduce(function(t, s) { return t + (s.status === 'deployed' ? s.count : 0); }, 0))
    + ((stats.by_status || []).reduce(function(t, s) { return t + (s.status === 'available' ? s.count : 0); }, 0));
  var unassigned = ((stats.by_status || []).find(function(s) { return s.status === 'available'; }) || {}).count || 0;
  var warrantyDue = (stats.warranty_alerts || []).filter(function(a) { return a.days_remaining <= 30; }).length;
  var inMaintenance = ((stats.by_status || []).find(function(s) { return s.status === 'maintenance'; }) || {}).count || 0;
  var totalMaintenance = warrantyDue + inMaintenance;

  document.getElementById('dash-kpis').innerHTML =
    renderKPI('Total Assets', kpiTotal, '—') +
    renderKPI('In Service', inService + ' of ' + kpiTotal, inService > 0 ? Math.round((inService / kpiTotal) * 100) + '%' : '—') +
    renderKPI('Unassigned', unassigned, unassigned > kpiTotal * 0.1 ? 'High' : 'OK', unassigned > kpiTotal * 0.1) +
    renderKPI('Maintenance Due', totalMaintenance, warrantyDue > 0 ? 'Warranty' : 'Scheduled', totalMaintenance > 0);

  // Status breakdown
  if (kpiTotal === 0) {
    document.getElementById('dash-status').innerHTML = '<div class="dash-empty">No assets registered yet. <button class="btn primary sm" onclick="navigate(\'#/assets/new\')">+ Add first asset</button></div>';
  } else {
    var statusData = (stats.by_status || []).filter(function(s) { return s.status !== 'disposed'; });
    var total = statusData.reduce(function(t, s) { return t + s.count; }, 0);
    var colorMap = { deployed: 'var(--green)', available: 'var(--accent)', maintenance: 'var(--amber)', retired: 'var(--gray)', lost: 'var(--red)' };
    var bar = statusData.map(function(s) {
      var pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
      return '<div class="dash-bar-fill" style="width:' + pct + '%;background:' + (colorMap[s.status] || 'var(--gray)') + '"></div>';
    }).join('');

    var legend = statusData.map(function(s) {
      var pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
      return '<div class="dash-legend-row"><span class="dash-legend-dot" style="background:' + (colorMap[s.status] || 'var(--gray)') + '"></span><span class="dash-legend-label">' + esc(s.status.charAt(0).toUpperCase() + s.status.slice(1)) + '</span><span class="dash-legend-value">' + s.count + ' (' + pct + '%)</span></div>';
    }).join('');

    document.getElementById('dash-status').innerHTML = '<div class="dash-bar-track">' + bar + '</div><div class="dash-legend">' + legend + '</div>';
  }

  // Recent activity
  var actEl = document.getElementById('dash-activity');
  if (stats.recent_activity && stats.recent_activity.length) {
    var activities = stats.recent_activity.slice(0, 8);
    actEl.innerHTML = activities.map(function(a) {
      var actionIcon = getActivityIcon(a.action);
      var actionText = getActivityText(a);
      var time = fmtRelative(a.created_at);
      return '<div class="dash-activity-row">'
        + '<div class="dash-activity-icon" style="background:var(--surface3)">' + actionIcon + '</div>'
        + '<div class="dash-activity-content">' + actionText + '</div>'
        + '<div class="dash-activity-time">' + time + '</div>'
        + '</div>';
    }).join('') + '<div class="dash-activity-more"><a href="#/reports" onclick="navigate(\'#/reports\')">View all activity →</a></div>';
  } else {
    actEl.innerHTML = '<div class="dash-empty-subtle">Activity will appear here once assets are created or assigned.</div>';
  }

  // Category bars
  var catEl = document.getElementById('dash-category');
  var topCats = (stats.by_category || []).slice(0, 6);
  if (topCats.length && kpiTotal > 0) {
    var maxCat = Math.max.apply(null, topCats.map(function(c) { return c.count; })) || 1;
    catEl.innerHTML = topCats.map(function(c) {
      var pct = Math.round((c.count / maxCat) * 100);
      return '<div class="dash-minibar-row"><span class="dash-minibar-label">' + (c.icon || '') + ' ' + esc(c.name) + '</span><div class="dash-minibar-track"><div class="dash-minibar-fill" style="width:' + pct + '%"></div></div><span class="dash-minibar-value">' + c.count + '</span></div>';
    }).join('');
    if ((stats.by_category || []).length > 6) {
      catEl.innerHTML += '<div class="dash-minibar-more"><a href="#/assets" onclick="navigate(\'#/assets\')">+ ' + ((stats.by_category || []).length - 6) + ' more →</a></div>';
    }
  } else {
    catEl.innerHTML = '<div class="dash-empty-subtle">No data</div>';
  }

  // Location bars
  var locEl = document.getElementById('dash-location');
  var topLocs = (stats.by_location || []).slice(0, 6);
  if (topLocs.length && kpiTotal > 0) {
    var maxLoc = Math.max.apply(null, topLocs.map(function(l) { return l.count; })) || 1;
    locEl.innerHTML = topLocs.map(function(l) {
      var pct = Math.round((l.count / maxLoc) * 100);
      return '<div class="dash-minibar-row"><span class="dash-minibar-label">' + esc(l.name) + '</span><div class="dash-minibar-track"><div class="dash-minibar-fill" style="width:' + pct + '%;background:var(--gray)"></div></div><span class="dash-minibar-value">' + l.count + '</span></div>';
    }).join('');
    if ((stats.by_location || []).length > 6) {
      locEl.innerHTML += '<div class="dash-minibar-more"><a href="#/assets" onclick="navigate(\'#/assets\')">+ ' + ((stats.by_location || []).length - 6) + ' more →</a></div>';
    }
  } else {
    locEl.innerHTML = '<div class="dash-empty-subtle">No data</div>';
  }
}

function renderKPI(label, value, delta, isWarning) {
  return '<div class="dash-kpi"><div class="dash-kpi-label">' + label + '</div><div class="dash-kpi-value">' + value + '</div><div class="dash-kpi-delta' + (isWarning ? ' dash-kpi-delta-warn' : '') + '">' + delta + '</div></div>';
}

function getActivityIcon(action) {
  var icons = {
    create: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    checkout: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h14M21 15l-5-5-5 5"/></svg>',
    checkin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h14M21 15l-5-5-5 5"/></svg>',
    update: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/></svg>',
    dispose: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
    maintenance: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 00-7.94 7.94l-6.91 6.91a2 2 0 01-.9.5H7a2 2 0 01-2-2v-.9a2 2 0 01.5-.9l6.91-6.91a6 6 0 007.94-7.94l-3.76 3.76z"/></svg>'
  };
  return icons[action] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
}

function getActivityText(a) {
  var text = '';
  if (a.person_name) text += esc(a.person_name);
  if (a.action === 'create') text += (text ? ' added ' : 'Added ') + esc(a.asset_tag || 'an asset');
  else if (a.action === 'checkout') text += (text ? ' checked out ' : 'Checked out ') + esc(a.asset_tag || 'an asset');
  else if (a.action === 'checkin') text += (text ? ' returned ' : 'Returned ') + esc(a.asset_tag || 'an asset');
  else if (a.action === 'update') text += (text ? ' updated ' : 'Updated ') + esc(a.asset_tag || 'an asset');
  else if (a.action === 'dispose') text += (text ? ' disposed ' : 'Disposed ') + esc(a.asset_tag || 'an asset');
  else if (a.action === 'maintenance') text += (text ? ' logged maintenance on ' : 'Maintenance on ') + esc(a.asset_tag || 'an asset');
  else text += (text ? ' ' + esc(a.action) : esc(a.action));
  if (a.details && a.action === 'update') text = esc(a.person_name || 'Updated') + ' ' + esc(a.details.replace('Updated: ', ''));
  return text;
}

function fmtRelative(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr.replace(/ /, 'T'));
  var now = new Date();
  var diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 172800) return 'yesterday';
  return Math.floor(diff / 86400) + 'd ago';
}

function kpiCard(id, label, value, sub, accent) {
  return '<div class="kpi-card" id="' + id + '">'
    + '<div class="kpi-label">' + esc(label) + '</div>'
    + '<div class="kpi-value" style="color:' + (accent || 'var(--text)') + '">' + esc(value) + '</div>'
    + '<div class="kpi-sub">' + esc(sub) + '</div></div>';
}

window.loadDashboardData = loadDashboardData;
window.kpiCard = kpiCard;