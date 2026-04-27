// ─── Utility Functions ─────────────────────────

// HTML escape
function esc(str) {
  if (!str) return '';
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
window.esc = esc;

// Short celebratory confetti burst. Dropped in for genuinely-rare "nice
// moment" events (clean-sweep audit complete etc.) so it doesn't become
// wallpaper. Council palette + gold, no dependencies.
function confetti(opts) {
  opts = opts || {};
  var respectMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (respectMotion) return; // be kind on reduced-motion systems
  var canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9999';
  document.body.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var w = canvas.width = window.innerWidth * dpr;
  var h = canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.scale(dpr, dpr);
  var colors = opts.colors || ['#2e5842', '#d4a017', '#c6d5c8', '#d97706', '#234433'];
  var originX = (opts.originX || 0.5) * window.innerWidth;
  var originY = (opts.originY || 0.5) * window.innerHeight;
  var count = opts.count || 140;
  var particles = [];
  for (var i = 0; i < count; i++) {
    var angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.7;
    var speed = 8 + Math.random() * 12;
    particles.push({
      x: originX + (Math.random() - 0.5) * 40,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.25,
      g: 0.35 + Math.random() * 0.25
    });
  }
  var duration = opts.duration || 2600;
  var start = performance.now();
  function frame(t) {
    var elapsed = t - start;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    var fade = elapsed > duration - 600 ? Math.max(0, (duration - elapsed) / 600) : 1;
    particles.forEach(function(p) {
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size / 1.5);
      ctx.restore();
    });
    if (elapsed < duration) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
window.confetti = confetti;

// Toast notifications. Polished card-style with a leading icon, colour
// pulled from semantic state, and a dismiss button so long-lived toasts
// don't block anything. Stacks in a fixed-position container and
// auto-dismisses after 3.5s (or immediately on click of the close
// button). Keeps the existing simple API: toast(msg, type).
function toast(msg, type) {
  type = type || 'info';
  var icons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  var el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.innerHTML = '<span class="toast-icon">' + (icons[type] || icons.info) + '</span>'
    + '<span class="toast-msg"></span>'
    + '<button type="button" class="toast-close" aria-label="Dismiss">&times;</button>';
  el.querySelector('.toast-msg').textContent = msg;
  var dismiss = function() {
    if (!el.parentNode) return;
    el.classList.add('out');
    setTimeout(function() { el.remove(); }, 200);
  };
  el.querySelector('.toast-close').addEventListener('click', dismiss);
  document.getElementById('toast-container').appendChild(el);
  setTimeout(dismiss, 3500);
}
window.toast = toast;

// Modal open/close
function openModal(title, html) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('open');
}
window.openModal = openModal;

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}
window.closeModal = closeModal;

// Confirm dialog. Uses the .open class (not inline display) so the later
// .modal-overlay rule — which hides the overlay via opacity:0 and
// pointer-events:none — actually unhides it. Setting style.display
// leaves the element invisible and unclickable.
var _confirmCb = null;
function confirmDialog(msg, okText) {
  document.getElementById('confirm-body').innerHTML = msg;
  if (okText) document.getElementById('confirm-ok-btn').textContent = okText;
  document.getElementById('confirm-overlay').classList.add('open');
  return new Promise(function(resolve) { _confirmCb = resolve; });
}
window.confirmDialog = confirmDialog;

function confirmResolve(val) {
  document.getElementById('confirm-overlay').classList.remove('open');
  if (_confirmCb) { _confirmCb(val); _confirmCb = null; }
}
window.confirmResolve = confirmResolve;

// Date formatting
function fmtDate(iso) {
  if (!iso) return '—';
  // All timestamps stored in Australia/Sydney time
  var d = new Date(iso);
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' });
}
window.fmtDate = fmtDate;

function fmtDateTime(iso) {
  if (!iso) return '—';
  var d = new Date(iso);
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' })
    + ' ' + d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney' });
}
window.fmtDateTime = fmtDateTime;

function fmtCurrency(val) {
  if (val === null || val === undefined || val === '') return '—';
  return '$' + Number(val).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
window.fmtCurrency = fmtCurrency;

// Debounce
function debounce(fn, ms) {
  var t;
  return function() {
    var args = arguments;
    var ctx = this;
    clearTimeout(t);
    t = setTimeout(function() { fn.apply(ctx, args); }, ms);
  };
}
window.debounce = debounce;

// Status badge HTML
function statusBadge(status) {
  return '<span class="badge ' + esc(status) + '">' + esc(status) + '</span>';
}
window.statusBadge = statusBadge;

// Loading skeleton
function skeleton(lines) {
  lines = lines || 5;
  var html = '';
  for (var i = 0; i < lines; i++) {
    var w = i === 0 ? 'short' : (i % 2 === 0 ? 'med' : '');
    html += '<div class="skeleton skeleton-line ' + w + '" style="width:' + (40 + Math.random() * 50) + '%"></div>';
  }
  return html;
}
window.skeleton = skeleton;

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
  // Ctrl+K → open search overlay
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    openSearchOverlay();
    return;
  }
  // Ctrl+N → new asset
  if ((e.ctrlKey || e.metaKey) && e.key === 'n' && Auth.isLoggedIn) {
    e.preventDefault();
    navigate('#/assets/new');
    return;
  }
  // Escape → close overlays
  if (e.key === 'Escape') {
    var search = document.getElementById('search-overlay');
    if (search && search.classList.contains('open')) {
      search.classList.remove('open');
      return;
    }
    closeModal();
    document.getElementById('confirm-overlay').classList.remove('open');
  }
});

// ─── Command Palette (Ctrl+K / Cmd+K) ──────────
// What started as a plain asset search has grown into a proper command
// palette: quick actions (new asset, jump to view, sync Entra, sign out)
// live above live-search results, and arrow keys + Enter work throughout.
// The overlay is still id="search-overlay" so anything else on the page
// that toggled it keeps working.

// Items shown when the palette is empty or as the "actions" block above
// asset results. Each entry declares its admin-ness so non-admins only
// see actions they can actually take.
function commandPaletteActions() {
  var admin = Auth.isAdmin && Auth.isAdmin();
  var items = [
    { label: 'Go to Assets', hint: 'a', icon: 'assets', run: function() { navigate('#/assets'); } },
    { label: 'Your account', hint: 'me', icon: 'user', run: function() { navigate('#/account'); } }
  ];
  if (admin) {
    items.unshift(
      { label: 'New asset', hint: 'ctrl+n', icon: 'plus', run: function() { navigate('#/assets/new'); } },
      { label: 'Go to Dashboard', hint: 'home', icon: 'grid', run: function() { navigate('#/'); } }
    );
    items.push(
      { label: 'Go to People', icon: 'people', run: function() { navigate('#/people'); } },
      { label: 'Go to Categories', icon: 'list', run: function() { navigate('#/categories'); } },
      { label: 'Go to Audits', icon: 'check', run: function() { navigate('#/audits'); } },
      { label: 'Go to Reports', icon: 'chart', run: function() { navigate('#/reports'); } },
      { label: 'Go to Receipts', icon: 'file', run: function() { navigate('#/issues'); } },
      { label: 'Go to Flags', icon: 'flag', run: function() { navigate('#/flags'); } },
      { label: 'Register a phone', icon: 'phone', run: function() { navigate('#/phone-enrol'); } },
      { label: 'Settings', icon: 'gear', run: function() { navigate('#/settings'); } },
      { label: 'Sync Entra users', hint: 'from Settings', icon: 'sync', run: function() {
        navigate('#/settings');
        setTimeout(function() {
          if (typeof syncEntraUsers === 'function') syncEntraUsers();
        }, 300);
      }}
    );
  }
  items.push({ label: 'Sign out', icon: 'out', run: function() { if (typeof Auth !== 'undefined') Auth.logout(); } });
  return items;
}

var paletteIconSvgs = {
  plus:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  grid:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  assets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><polyline points="16 7 16 2 8 2 8 7"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
  list:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
  check:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  chart:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  file:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  flag:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
  phone:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>',
  gear:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v3m0 16v3M4.22 4.22l2.12 2.12m11.32 11.32l2.12 2.12M1 12h3m16 0h3M4.22 19.78l2.12-2.12m11.32-11.32l2.12-2.12"/></svg>',
  sync:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  user:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  out:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
};

// Palette state. `items` is the flat list of currently-visible actionable
// entries (actions + asset rows). `active` is the keyboard-selected index.
// Both reset every time the palette reopens or the query changes.
var paletteState = { items: [], active: 0, query: '' };
window.paletteState = paletteState;
window.updatePaletteActive = function() { updatePaletteActive(); };

function openSearchOverlay() {
  if (!Auth.isLoggedIn) return;

  var overlay = document.getElementById('search-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'search-overlay';
    overlay.className = 'search-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.classList.remove('open'); };
    overlay.innerHTML = '<div class="search-overlay-card">'
      + '<input type="text" class="search-overlay-input" id="search-overlay-input" placeholder="Type a command or search assets\u2026" oninput="paletteOnInput(this.value)" onkeydown="paletteOnKeyDown(event)" autocomplete="off">'
      + '<div class="search-overlay-results" id="search-overlay-results"></div>'
      + '<div class="palette-footer">'
      + '<span><kbd>\u2191</kbd><kbd>\u2193</kbd> navigate</span>'
      + '<span><kbd>\u21B5</kbd> select</span>'
      + '<span><kbd>Esc</kbd> close</span>'
      + '</div>'
      + '</div>';
    document.body.appendChild(overlay);
  }

  overlay.classList.add('open');
  paletteState.query = '';
  setTimeout(function() {
    var input = document.getElementById('search-overlay-input');
    if (input) { input.value = ''; input.focus(); }
    renderPalette('');
  }, 50);
}
window.openSearchOverlay = openSearchOverlay;

function paletteOnInput(value) {
  paletteState.query = value || '';
  renderPalette(paletteState.query);
}
window.paletteOnInput = paletteOnInput;

function paletteOnKeyDown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    paletteState.active = Math.min(paletteState.items.length - 1, paletteState.active + 1);
    updatePaletteActive();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    paletteState.active = Math.max(0, paletteState.active - 1);
    updatePaletteActive();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    var item = paletteState.items[paletteState.active];
    if (item) paletteActivate(item);
  }
}
window.paletteOnKeyDown = paletteOnKeyDown;

function updatePaletteActive() {
  var nodes = document.querySelectorAll('#search-overlay-results .palette-item');
  nodes.forEach(function(n, i) {
    n.classList.toggle('active', i === paletteState.active);
    if (i === paletteState.active) n.scrollIntoView({ block: 'nearest' });
  });
}

function paletteActivate(item) {
  document.getElementById('search-overlay').classList.remove('open');
  try { item.run(); } catch (e) { console.error('palette action failed', e); }
}
window.paletteActivate = paletteActivate;

// Index for onclick activation — the markup references items by their
// palette index rather than carrying a closure through innerHTML.
window.__paletteItemAt = function(i) {
  var item = paletteState.items[i];
  if (item) paletteActivate(item);
};

function paletteItemMarkup(item, index) {
  var icon = paletteIconSvgs[item.icon] || paletteIconSvgs.search;
  return '<div class="palette-item' + (index === paletteState.active ? ' active' : '') + '"'
    + ' onmousemove="paletteState.active=' + index + ';updatePaletteActive()"'
    + ' onclick="__paletteItemAt(' + index + ')">'
    + '<div class="palette-item-icon">' + icon + '</div>'
    + '<div class="palette-item-main">'
    + '<div class="palette-item-label">' + esc(item.label) + '</div>'
    + (item.sub ? '<div class="palette-item-sub">' + item.sub + '</div>' : '')
    + '</div>'
    + (item.hint ? '<div class="palette-item-hint">' + esc(item.hint) + '</div>' : '')
    + '</div>';
}

async function renderPalette(query) {
  var resultsEl = document.getElementById('search-overlay-results');
  if (!resultsEl) return;

  var q = (query || '').trim().toLowerCase();
  var actions = commandPaletteActions();
  var matchedActions = q
    ? actions.filter(function(a) { return a.label.toLowerCase().indexOf(q) !== -1; })
    : actions;

  paletteState.items = matchedActions.slice();
  paletteState.active = 0;

  var html = '';
  if (matchedActions.length) {
    html += '<div class="palette-group-label">Actions</div>';
    matchedActions.forEach(function(item, i) { html += paletteItemMarkup(item, i); });
  }

  // Show a loading row for assets while we fetch, then replace.
  if (q.length >= 2 && API.baseUrl) {
    html += '<div class="palette-group-label">Assets</div>'
      + '<div class="search-overlay-empty" id="palette-assets-loading">Searching\u2026</div>';
  }

  resultsEl.innerHTML = html;

  if (q.length >= 2 && API.baseUrl) {
    try {
      var results = await API.getAssets({ search: query, limit: 8 });
      // Guard against a stale response racing a newer query.
      if (paletteState.query.trim().toLowerCase() !== q) return;

      var data = results.data || [];
      var assetItems = data.map(function(a) {
        return {
          label: a.name,
          sub: '<span class="mono">' + esc(a.asset_tag) + '</span>'
             + (a.serial_number ? ' &middot; ' + esc(a.serial_number) : '')
             + (a.assigned_to_name ? ' &middot; ' + esc(a.assigned_to_name) : ''),
          icon: 'assets',
          hint: a.status,
          run: (function(id) { return function() { navigate('#/assets/' + id); }; })(a.id)
        };
      });

      paletteState.items = matchedActions.concat(assetItems);

      var offset = matchedActions.length;
      var assetsHtml = assetItems.length
        ? assetItems.map(function(it, i) { return paletteItemMarkup(it, offset + i); }).join('')
        : '<div class="search-overlay-empty">No asset matches</div>';

      resultsEl.innerHTML = (matchedActions.length
        ? '<div class="palette-group-label">Actions</div>'
          + matchedActions.map(function(it, i) { return paletteItemMarkup(it, i); }).join('')
        : '')
        + '<div class="palette-group-label">Assets</div>' + assetsHtml;
    } catch (e) {
      var loading = document.getElementById('palette-assets-loading');
      if (loading) loading.textContent = 'Search failed';
    }
  } else if (!matchedActions.length) {
    resultsEl.innerHTML = '<div class="search-overlay-empty">No matches for "' + esc(query) + '"</div>';
  }
}
window.renderPalette = renderPalette;

// Back-compat shim: globalSearch() in router.js used to call this debounced
// search directly. Forward to the palette's query handler so that one-off
// path still works.
var searchOverlayDebounced = function(query) {
  paletteState.query = query || '';
  renderPalette(paletteState.query);
};
window.searchOverlayDebounced = searchOverlayDebounced;
