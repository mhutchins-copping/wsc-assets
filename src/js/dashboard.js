// ─── Dashboard ────────────────────────────────────

Router.register('/', function() {
  var el = document.getElementById('view-dashboard');
  el.innerHTML = renderDashboardSkeleton();
  el.setAttribute('aria-busy', 'true');
  loadDashboardData();
});

function renderDashboardSkeleton() {
  var kpi = '';
  for (var i = 0; i < 4; i++) {
    kpi += '<div class="dash-kpi"><div class="dash-kpi-label">&nbsp;</div><div class="dash-kpi-value"><span class="dash-skeleton-text" style="width:80px"></span></div><div class="dash-kpi-sub">&nbsp;</div></div>';
  }
  return '<div class="dash-kpi-row" id="dash-kpis">' + kpi + '</div>'
    + '<div class="dash-grid">'
    + '<div class="dash-section"><div class="dash-section-title">Status Breakdown</div><div id="dash-status">' + renderSkeletonBlock(110) + '</div></div>'
    + '<div class="dash-section"><div class="dash-section-title">Recent Activity</div><div id="dash-activity">' + renderSkeletonBlock(210) + '</div></div>'
    + '</div>'
    + '<div class="dash-section"><div class="dash-section-title">Top Categories</div><div id="dash-category" class="dash-minibar-area">' + renderSkeletonBlock(140) + '</div></div>';
}

function renderSkeletonBlock(h) {
  return '<div class="dash-skeleton-block" style="height:' + h + 'px" aria-hidden="true"></div>';
}

async function loadDashboardData() {
  if (!API.baseUrl) return;
  var root = document.getElementById('view-dashboard');
  try {
    var stats = await API.getStats();
    renderDashboard(stats);
    if (root) root.removeAttribute('aria-busy');
  } catch(e) {
    console.error('dashboard load error:', e);
    renderDashboardError();
    if (root) root.removeAttribute('aria-busy');
  }
}

function renderDashboardError() {
  var kEl = document.getElementById('dash-kpis');
  if (kEl) {
    kEl.innerHTML = [
      renderKPI('Total Assets', '—', 'data unavailable'),
      renderKPI('Deployed', '—', 'data unavailable'),
      renderKPI('Available', '—', 'data unavailable'),
      renderKPI('Needs Attention', '—', 'data unavailable')
    ].join('');
  }
  setSection('dash-status', '<div class="dash-error">Could not load dashboard data. <a href="#/" onclick="loadDashboardData();return false;">Retry</a></div>');
  setSection('dash-activity', '<div class="dash-empty-subtle">—</div>');
  setSection('dash-category', '<div class="dash-empty-subtle">—</div>');
}

function setSection(id, html) {
  var el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function renderDashboard(stats) {
  var byStatus = stats.by_status || [];
  var statusCount = function(s) { var r = byStatus.find(function(x){return x.status===s;}); return r ? r.count : 0; };

  var total = stats.total || 0;
  var deployed = statusCount('deployed');
  var available = statusCount('available');
  var maintenance = statusCount('maintenance');
  var lost = statusCount('lost');
  var needsAttention = maintenance + lost;

  // ── KPIs ──
  var deployedPct = total > 0 ? Math.round((deployed / total) * 100) : 0;
  var availPct = total > 0 ? Math.round((available / total) * 100) : 0;
  var attnSub = needsAttention === 0
    ? 'All clear'
    : (maintenance + ' in maintenance' + (lost ? ', ' + lost + ' lost' : ''));

  document.getElementById('dash-kpis').innerHTML = [
    renderKPI('Total Assets', total, total === 0 ? 'No assets yet' : '—'),
    renderKPI('Deployed', deployed, total > 0 ? deployedPct + '% of fleet' : '—'),
    renderKPI('Available', available, total > 0 ? availPct + '% of fleet' : '—'),
    renderKPI('Needs Attention', needsAttention, attnSub, needsAttention > 0 ? 'warn' : null)
  ].join('');

  // ── Status Breakdown ──
  if (total === 0) {
    setSection('dash-status', '<div class="dash-empty">No assets registered yet.<button class="btn primary sm" onclick="navigate(\'#/assets/new\')">Add first asset</button></div>');
  } else {
    var displayStatuses = byStatus.filter(function(s) { return s.status !== 'disposed'; });
    var shownTotal = displayStatuses.reduce(function(t, s) { return t + s.count; }, 0);
    var statusColor = { deployed: 'var(--green)', available: 'var(--accent)', maintenance: 'var(--amber)', retired: 'var(--gray)', lost: 'var(--red)' };
    var statusLabel = { deployed: 'Deployed', available: 'Available', maintenance: 'Maintenance', retired: 'Retired', lost: 'Lost' };

    // Sort: biggest first for visual stacking
    displayStatuses.sort(function(a, b) { return b.count - a.count; });

    var bar = displayStatuses.map(function(s) {
      var pct = shownTotal > 0 ? (s.count / shownTotal) * 100 : 0;
      // Ensure visible sliver for non-zero counts
      var displayPct = s.count > 0 && pct < 1.5 ? 1.5 : pct;
      var color = statusColor[s.status] || 'var(--gray)';
      return '<div class="dash-bar-fill" style="width:' + displayPct.toFixed(2) + '%;background:' + color + '" title="' + esc(statusLabel[s.status] || s.status) + ': ' + s.count + '"></div>';
    }).join('');

    var legend = displayStatuses.map(function(s) {
      var pct = shownTotal > 0 ? Math.round((s.count / shownTotal) * 100) : 0;
      var color = statusColor[s.status] || 'var(--gray)';
      var label = statusLabel[s.status] || s.status;
      return '<div class="dash-legend-row">'
        + '<span class="dash-legend-dot" style="background:' + color + '"></span>'
        + '<span class="dash-legend-label">' + esc(label) + '</span>'
        + '<span class="dash-legend-value">' + s.count + '<span class="dash-legend-pct">' + pct + '%</span></span>'
        + '</div>';
    }).join('');

    setSection('dash-status', '<div class="dash-bar-track">' + bar + '</div><div class="dash-legend">' + legend + '</div>');
  }

  // ── Recent Activity ──
  var acts = (stats.recent_activity || []).slice(0, 8);
  if (acts.length) {
    setSection('dash-activity', acts.map(renderActivityRow).join('')
      + '<div class="dash-activity-more"><a href="#/reports" onclick="navigate(\'#/reports\');return false;">View all activity →</a></div>');
  } else {
    setSection('dash-activity', '<div class="dash-empty-subtle">Activity will appear here once assets are created or assigned.</div>');
  }

  // ── Top Categories ──
  var cats = (stats.by_category || []).filter(function(c) { return c.count > 0; });
  if (cats.length && total > 0) {
    var top = cats.slice(0, 8);
    var maxCount = Math.max.apply(null, top.map(function(c) { return c.count; })) || 1;
    var rows = top.map(function(c) {
      var pct = Math.round((c.count / maxCount) * 100);
      return '<div class="dash-minibar-row">'
        + '<span class="dash-minibar-label" title="' + esc(c.name) + '">' + esc(c.name) + '</span>'
        + '<div class="dash-minibar-track"><div class="dash-minibar-fill" style="width:' + Math.max(pct, 2) + '%"></div></div>'
        + '<span class="dash-minibar-value">' + c.count + '</span>'
        + '</div>';
    }).join('');
    var more = cats.length > 8
      ? '<div class="dash-minibar-more"><a href="#/categories" onclick="navigate(\'#/categories\');return false;">+ ' + (cats.length - 8) + ' more →</a></div>'
      : '';
    setSection('dash-category', rows + more);
  } else {
    setSection('dash-category', '<div class="dash-empty-subtle">No categories with assets yet.</div>');
  }
}

function renderKPI(label, value, sub, flag) {
  var sub_html = sub ? ('<div class="dash-kpi-sub' + (flag === 'warn' ? ' dash-kpi-sub-warn' : '') + '">' + esc(sub) + '</div>') : '<div class="dash-kpi-sub">&nbsp;</div>';
  return '<div class="dash-kpi">'
    + '<div class="dash-kpi-label">' + esc(label) + '</div>'
    + '<div class="dash-kpi-value' + (flag === 'warn' && value > 0 ? ' dash-kpi-value-warn' : '') + '">' + esc(value) + '</div>'
    + sub_html
    + '</div>';
}

function renderActivityRow(a) {
  var icon = activityIcon(a.action);
  var text = activityText(a);
  var time = fmtRelative(a.created_at);
  return '<div class="dash-activity-row">'
    + '<div class="dash-activity-icon">' + icon + '</div>'
    + '<div class="dash-activity-content">' + text + '</div>'
    + '<div class="dash-activity-time">' + esc(time) + '</div>'
    + '</div>';
}

function activityIcon(action) {
  var icons = {
    create:      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    checkout:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>',
    checkin:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 19l-7-7 7-7"/></svg>',
    update:      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
    dispose:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
    maintenance: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>'
  };
  return icons[action] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>';
}

function activityText(a) {
  var who = a.person_name ? esc(a.person_name) : null;
  var tag = a.asset_tag ? esc(a.asset_tag) : null;
  var lbl = tag ? ('<span class="dash-activity-tag">' + tag + '</span>') : 'an asset';

  switch (a.action) {
    case 'create':
      return (who ? who + ' added ' : 'Added ') + lbl;
    case 'checkout':
      return (who ? who + ' was assigned ' : 'Checked out ') + lbl;
    case 'checkin':
      return (who ? who + ' returned ' : 'Returned ') + lbl;
    case 'dispose':
      return 'Disposed ' + lbl;
    case 'maintenance':
      return 'Maintenance on ' + lbl;
    case 'update': {
      var changes = a.details ? String(a.details).replace(/^Updated:\s*/i, '') : '';
      return 'Updated ' + lbl + (changes ? ' · <span class="dash-activity-detail">' + esc(changes) + '</span>' : '');
    }
    default:
      return esc(a.action) + ' · ' + lbl;
  }
}

function fmtRelative(dateStr) {
  if (!dateStr) return '';
  var d = new Date(String(dateStr).replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  var diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 45) return 'just now';
  if (diff < 3600) return Math.round(diff / 60) + 'm ago';
  if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
  if (diff < 172800) return '1d ago';
  if (diff < 2592000) return Math.round(diff / 86400) + 'd ago';
  return fmtDate(dateStr);
}

// Legacy helper kept for reports.js
function kpiCard(id, label, value, sub, accent) {
  return '<div class="kpi-card" id="' + id + '">'
    + '<div class="kpi-label">' + esc(label) + '</div>'
    + '<div class="kpi-value" style="color:' + (accent || 'var(--text)') + '">' + esc(value) + '</div>'
    + '<div class="kpi-sub">' + esc(sub) + '</div></div>';
}

window.loadDashboardData = loadDashboardData;
window.kpiCard = kpiCard;
