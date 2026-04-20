// ─── Utility Functions ─────────────────────────

// HTML escape
function esc(str) {
  if (!str) return '';
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
window.esc = esc;

// Toast notifications
function toast(msg, type) {
  type = type || 'info';
  var el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(function() {
    el.classList.add('out');
    setTimeout(function() { el.remove(); }, 200);
  }, 3000);
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

// ─── Search Overlay (Ctrl+K) ───────────────────

function openSearchOverlay() {
  if (!Auth.isLoggedIn) return;

  // Create overlay if it doesn't exist
  var overlay = document.getElementById('search-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'search-overlay';
    overlay.className = 'search-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.classList.remove('open'); };
    overlay.innerHTML = '<div class="search-overlay-card">'
      + '<input type="text" class="search-overlay-input" id="search-overlay-input" placeholder="Search assets by name, tag, serial, or assignee…" oninput="searchOverlayDebounced(this.value)">'
      + '<div class="search-overlay-results" id="search-overlay-results">'
      + '<div class="search-overlay-empty">Type to search across all assets</div>'
      + '</div></div>';
    document.body.appendChild(overlay);
  }

  overlay.classList.add('open');
  setTimeout(function() {
    var input = document.getElementById('search-overlay-input');
    if (input) { input.value = ''; input.focus(); }
  }, 50);
}
window.openSearchOverlay = openSearchOverlay;

var searchOverlayDebounced = debounce(async function(query) {
  var resultsEl = document.getElementById('search-overlay-results');
  if (!resultsEl) return;
  if (!query || query.length < 2) {
    resultsEl.innerHTML = '<div class="search-overlay-empty">Type to search across all assets</div>';
    return;
  }
  if (!API.baseUrl) {
    resultsEl.innerHTML = '<div class="search-overlay-empty">Configure API in Settings first</div>';
    return;
  }

  resultsEl.innerHTML = '<div class="search-overlay-empty">Searching...</div>';

  try {
    var results = await API.getAssets({ search: query, limit: 8 });
    var data = results.data || [];

    if (!data.length) {
      resultsEl.innerHTML = '<div class="search-overlay-empty">No results for "' + esc(query) + '"</div>';
      return;
    }

    resultsEl.innerHTML = data.map(function(a) {
      return '<div class="search-overlay-item" onclick="document.getElementById(\'search-overlay\').classList.remove(\'open\');navigate(\'#/assets/' + esc(a.id) + '\')">'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-weight:500;font-size:13px">' + esc(a.name) + '</div>'
        + '<div style="font-size:11px;font-family:var(--mono);color:var(--text3)">'
        + esc(a.asset_tag) + (a.serial_number ? ' &middot; ' + esc(a.serial_number) : '')
        + (a.assigned_to_name ? ' &middot; ' + esc(a.assigned_to_name) : '')
        + '</div></div>'
        + statusBadge(a.status)
        + '</div>';
    }).join('');
  } catch(e) {
    resultsEl.innerHTML = '<div class="search-overlay-empty">Search failed</div>';
  }
}, 200);
window.searchOverlayDebounced = searchOverlayDebounced;
