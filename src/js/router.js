// ─── Hash-based Router ─────────────────────────

var Router = {
  routes: {},
  current: null,

  register: function(path, handler) {
    this.routes[path] = handler;
  },

  handleRoute: function() {
    if (!Auth.isLoggedIn) return;

    var hash = location.hash || '#/';
    var parts = hash.replace('#', '').split('/').filter(Boolean);
    var route = '/' + (parts[0] || '');
    var param = parts.slice(1).join('/');

    // Role-based view gating. Matches the sidebar nav data-require
    // attributes - if you add a new sidebar item with a role gate, add
    // its route here too. (Defence in depth: even without this the
    // route handlers re-check role and the API rejects unauthorised
    // calls; this just keeps URL-typers from landing on a half-rendered
    // empty view.)
    var role = Auth.user ? Auth.user.role : '';
    if (role !== 'admin') {
      var blocked = [];
      if (role === 'viewer' || role === 'user') {
        blocked = ['/', '/people', '/categories', '/audits', '/reports', '/issues', '/flags', '/loans'];
      }
      // /consumables: viewers can read but the sidebar exposes it at
      // user+ for write actions. Keep the gate at viewer-blocked so the
      // route is reachable for users (consumables.read is in VIEWER_PERMS
      // server-side, but the wider read-list here keeps the UI flow
      // consistent with the sidebar).
      if (role === 'viewer') {
        blocked.push('/consumables');
      }
      // /runbook is admin-only - matches data-require="admin" in the sidebar.
      if (role !== 'admin') {
        blocked.push('/runbook');
      }
      // Settings is allowed for user+ but individual tabs are gated in renderSettings
      if (blocked.indexOf(route) !== -1) {
        location.hash = '#/assets';
        return;
      }
    }

    // Find the matching view
    var viewId = this.routeToView(route, param);
    this.showView(viewId);

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(function(el) {
      el.classList.toggle('active', el.getAttribute('href') === '#' + route);
    });

    // Update page title
    var viewEl = document.getElementById('view-' + viewId);
    if (viewEl && viewEl.dataset.title) {
      document.getElementById('page-title').textContent = viewEl.dataset.title;
    }

    // Call route handler
    var handler = this.routes[route];
    if (handler) {
      handler(param);
    }

    this.current = hash;
  },

  routeToView: function(route, param) {
    var map = {
      '/': 'dashboard',
      '/assets': param === 'new' ? 'asset-form'
        : param === 'bulk-new' ? 'asset-bulk-new'
        : (param && param.indexOf('edit/') === 0 ? 'asset-form'
        : (param ? 'asset-detail' : 'assets')),
      '/people': param ? 'person-detail' : 'people',
      '/categories': 'categories',
      '/audits': param ? 'audit-detail' : 'audits',
      '/reports': 'reports',
      '/issues': 'issues',
      '/flags': 'flags',
      '/loans': 'loans',
      '/consumables': 'consumables',
      '/phone-enrol': 'phone-enrol',
      '/phone-enrol-batch': 'phone-enrol',
      '/runbook': 'runbook',
      '/settings': 'settings',
      '/account': 'account'
    };
    return map[route] || 'dashboard';
  },

  showView: function(viewId) {
    document.querySelectorAll('.view').forEach(function(v) {
      v.classList.remove('active');
    });
    var el = document.getElementById('view-' + viewId);
    if (el) el.classList.add('active');

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    var overlay = document.getElementById('sidebar-overlay');
    if (overlay) overlay.classList.remove('active');

    // Scroll to top on view change
    window.scrollTo(0, 0);
  }
};

function navigate(hash) {
  location.hash = hash;
}
window.navigate = navigate;

function globalSearch(query) {
  if (!query || !query.trim()) return;
  openSearchOverlay();
  setTimeout(function() {
    var input = document.getElementById('search-overlay-input');
    if (input) { input.value = query.trim(); searchOverlayDebounced(query.trim()); }
  }, 100);
}
window.globalSearch = globalSearch;

function toggleSidebar() {
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('active');
}
window.toggleSidebar = toggleSidebar;

// Short route scanned from a printed QR sticker. Encoded as `#/a/<tag>` to
// keep the QR payload small. Resolves tag → asset id and forwards to the
// standard asset-detail route so we don't maintain a parallel render path.
Router.register('/a', async function(tag) {
  if (!tag) { navigate('#/assets'); return; }
  try {
    var asset = await API.getAssetByTag(tag);
    if (asset && asset.id) {
      navigate('#/assets/' + asset.id);
    } else {
      toast('Asset not found: ' + tag, 'error');
      navigate('#/assets');
    }
  } catch (e) {
    // API.fetch already toasted a message; just bounce back to the list.
    navigate('#/assets');
  }
});

// Listen for hash changes
window.addEventListener('hashchange', function() { Router.handleRoute(); });
window.addEventListener('DOMContentLoaded', function() {
  // Small delay to let auth init first
  setTimeout(function() { Router.handleRoute(); }, 50);
});

window.Router = Router;
