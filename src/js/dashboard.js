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
  return renderDashWelcome()
    + '<div class="dash-kpi-row" id="dash-kpis">' + kpi + '</div>'
    + '<div class="dash-grid">'
    + '<div class="dash-section"><div class="dash-section-title">Status Breakdown</div><div id="dash-status">' + renderSkeletonBlock(110) + '</div></div>'
    + '<div class="dash-section"><div class="dash-section-title">Recent Activity</div><div id="dash-activity">' + renderSkeletonBlock(210) + '</div></div>'
    + '</div>'
    + '<div class="dash-section"><div class="dash-section-title">Top Categories</div><div id="dash-category" class="dash-minibar-area">' + renderSkeletonBlock(140) + '</div></div>'
    + '<div class="dash-grid" style="margin-top:20px">'
    + '<div class="dash-section"><div class="dash-section-title">Warranty Alerts</div><div id="dash-warranty">' + renderSkeletonBlock(120) + '</div></div>'
    + '<div class="dash-section"><div class="dash-section-title">Recent Checkouts</div><div id="dash-checkouts">' + renderSkeletonBlock(120) + '</div></div>'
    + '</div>'
    + '<div class="dash-section dash-mosaic-section">'
    +   '<div class="dash-section-head">'
    +     '<div class="dash-section-title">Assets at a glance</div>'
    +     '<div id="dash-mosaic-legend" class="dash-mosaic-legend"></div>'
    +   '</div>'
    +   '<div id="dash-mosaic">' + renderSkeletonBlock(120) + '</div>'
    +   '<div id="dash-funfact" class="dash-funfact">&nbsp;</div>'
    + '</div>';
}

// Welcome strip at the top of the dashboard. Echoes the "Welcome to
// Walgett Shire Council" hero on the public council site, scaled down
// so it reads as a friendly greeting rather than a marketing banner.
function renderDashWelcome() {
  var name = (Auth && Auth.user && Auth.user.display_name) ? Auth.user.display_name : '';
  var first = name.split(' ')[0];
  var hour = new Date().getHours();
  var greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  var title = first ? greet + ', ' + esc(first) : 'Welcome';
  return '<div class="dash-welcome">'
    + '<div class="dash-welcome-eyebrow">Asset Register</div>'
    + '<h1 class="dash-welcome-title">' + title + '</h1>'
    + '<p class="dash-welcome-sub">Here\'s how the council asset pool is tracking right now.</p>'
    + '</div>';
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
  // Mosaic + fun fact load separately so the KPIs paint first. Fire
  // this even if the stats request failed -- different endpoint,
  // might still work.
  loadFleetMosaic();
}

// Walks the paginated asset list and builds the Assets-at-a-glance
// mosaic. Caps at 10 pages (1,000 rows) which is comfortably more
// than the council asset pool.
async function loadFleetMosaic() {
  var mosaicEl = document.getElementById('dash-mosaic');
  var factEl = document.getElementById('dash-funfact');
  var legendEl = document.getElementById('dash-mosaic-legend');
  if (!mosaicEl) return;
  try {
    var all = [];
    var page = 1;
    while (page <= 10) {
      var res = await API.getAssets({ page: page, limit: 100, sort: 'a.asset_tag', dir: 'asc' });
      all = all.concat(res.data || []);
      if (!res.data || res.data.length < 100 || all.length >= (res.total || 0)) break;
      page++;
    }
    if (!all.length) {
      mosaicEl.innerHTML = '<div class="dash-empty-subtle">No assets yet. Once you register some, each one shows up as a tile here.</div>';
      if (factEl) factEl.innerHTML = '';
      return;
    }
    mosaicEl.innerHTML = renderMosaic(all);
    if (legendEl) legendEl.innerHTML = renderMosaicLegend();
    if (factEl) {
      var fact = pickFunFact(all);
      factEl.innerHTML = fact ? '<span class="dash-funfact-dot"></span> ' + fact : '';
    }
  } catch (e) {
    mosaicEl.innerHTML = '<div class="dash-empty-subtle">Couldn\'t load the mosaic.</div>';
  }
}

// Color per asset status. Deployed pops in the accent green, available
// sits in a paler sage, warnings take amber/red. Disposed is omitted
// from the mosaic entirely (out of pool).
var MOSAIC_COLORS = {
  deployed:    'var(--status-deployed)',
  available:   'var(--status-available)',
  maintenance: 'var(--status-maintenance)',
  retired:     'var(--status-retired)',
  lost:        'var(--status-lost)'
};
var MOSAIC_LABELS = {
  deployed: 'Deployed', available: 'Available',
  maintenance: 'Maintenance', retired: 'Retired', lost: 'Lost'
};

function renderMosaic(assets) {
  var visible = assets.filter(function(a) { return a.status !== 'disposed'; });
  return '<div class="dash-mosaic-grid">' + visible.map(function(a) {
    var color = MOSAIC_COLORS[a.status] || 'var(--gray)';
    var label = (a.asset_tag || '') + ' \u00b7 ' + (a.name || '') + ' \u00b7 ' + (MOSAIC_LABELS[a.status] || a.status || 'unknown');
    return '<a class="dash-mosaic-tile" href="#/assets/' + esc(a.id) + '" '
      + 'style="background:' + color + '" '
      + 'title="' + esc(label) + '" aria-label="' + esc(label) + '"></a>';
  }).join('') + '</div>';
}

function renderMosaicLegend() {
  return Object.keys(MOSAIC_COLORS).map(function(k) {
    return '<span class="dash-mosaic-leg">'
      + '<span class="dash-mosaic-leg-dot" style="background:' + MOSAIC_COLORS[k] + '"></span>'
      + (MOSAIC_LABELS[k] || k)
      + '</span>';
  }).join('');
}

// Build a pool of true statements about the asset pool, pick one at random.
// Short, factual, vaguely interesting. Only uses data we've already
// fetched so no extra network.
function pickFunFact(assets) {
  var facts = [];
  var now = Date.now();

  // Oldest registered asset
  var oldest = null;
  assets.forEach(function(a) {
    if (!a.created_at) return;
    if (!oldest || a.created_at < oldest.created_at) oldest = a;
  });
  if (oldest) {
    var days = Math.max(1, Math.floor((now - new Date(oldest.created_at).getTime()) / 86400000));
    facts.push('Oldest record: <strong>' + esc(oldest.asset_tag) + '</strong>, on the register for ' + days + ' day' + (days === 1 ? '' : 's') + '.');
  }

  // Most common manufacturer
  var mf = {};
  assets.forEach(function(a) { if (a.manufacturer) mf[a.manufacturer] = (mf[a.manufacturer] || 0) + 1; });
  var top = Object.keys(mf).map(function(k){return [k, mf[k]];}).sort(function(a,b){return b[1]-a[1];})[0];
  if (top) facts.push('<strong>' + esc(top[0]) + '</strong> is the most common make, with ' + top[1] + ' asset' + (top[1] === 1 ? '' : 's') + '.');

  // Registered in the last 7 days
  var weekAgo = now - 7 * 86400000;
  var thisWeek = assets.filter(function(a) { return a.created_at && new Date(a.created_at).getTime() > weekAgo; }).length;
  if (thisWeek > 0) facts.push('<strong>' + thisWeek + '</strong> asset' + (thisWeek === 1 ? '' : 's') + ' added in the last 7 days.');

  // Deployment ratio
  var deployed = assets.filter(function(a) { return a.status === 'deployed'; }).length;
  if (assets.length && deployed > 0) {
    var pct = Math.round((deployed / assets.length) * 100);
    facts.push(pct + '% of assets are currently assigned.');
  }

  // Retiring in the next 6 months
  var sixMo = now + 183 * 86400000;
  var dueSoon = assets.filter(function(a) {
    if (!a.retirement_date) return false;
    var t = new Date(a.retirement_date).getTime();
    return !isNaN(t) && t > now && t < sixMo;
  }).length;
  if (dueSoon > 0) facts.push('<strong>' + dueSoon + '</strong> asset' + (dueSoon === 1 ? ' is' : 's are') + ' due for replacement in the next 6 months.');

  if (!facts.length) return null;
  return facts[Math.floor(Math.random() * facts.length)];
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
    renderKPI('Deployed', deployed, total > 0 ? deployedPct + '% of pool' : '—'),
    renderKPI('Available', available, total > 0 ? availPct + '% of pool' : '—'),
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

  // ── Warranty Alerts ──
  var alerts = stats.warranty_alerts || [];
  if (alerts.length) {
    var alertRows = alerts.slice(0, 6).map(function(a) {
      var days = a.days_remaining;
      var urgent = days <= 30;
      return '<a class="dash-alert-row' + (urgent ? ' urgent' : '') + '" href="#/assets/' + esc(a.id) + '">'
        + '<span class="dash-alert-tag">' + esc(a.asset_tag) + '</span>'
        + '<span class="dash-alert-name">' + esc(a.name) + '</span>'
        + '<span class="dash-alert-meta' + (urgent ? ' urgent' : '') + '">' + (days <= 0 ? 'Expires today' : days + 'd left') + '</span>'
        + '</a>';
    }).join('');
    setSection('dash-warranty', alertRows);
  } else {
    setSection('dash-warranty', '<div class="dash-empty-subtle">No warranties expiring in the next 90 days.</div>');
  }

  // ── Recent Checkouts ──
  var checkouts = (stats.recent_activity || []).filter(function(a) { return a.action === 'checkout'; }).slice(0, 6);
  if (checkouts.length) {
    setSection('dash-checkouts', checkouts.map(function(a) {
      return '<a class="dash-alert-row" href="#/assets/' + esc(a.asset_id) + '">'
        + '<span class="dash-alert-tag">' + esc(a.asset_tag || '—') + '</span>'
        + '<span class="dash-alert-name">' + esc(a.person_name || 'Someone') + '</span>'
        + '<span class="dash-alert-meta">' + esc(fmtRelative(a.created_at)) + '</span>'
        + '</a>';
    }).join(''));
  } else {
    setSection('dash-checkouts', '<div class="dash-empty-subtle">No recent checkouts.</div>');
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
