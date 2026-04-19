// ─── Authentication ────────────────────────────
// SSO identity (Cloudflare Access) mapped to internal app users
// No separate password — SSO handles authentication,
// internal user record handles authorisation

var Auth = {
  isLoggedIn: false,
  user: null, // { id, email, display_name, role }
  _sessionToken: '',  // bearer token for master-key sessions; SSO sessions rely on the CF cookie instead

  init: async function() {
    // One-time cleanup: earlier builds stored the raw master key in
    // sessionStorage. The new flow exchanges it for a bearer token on
    // login, so the raw key is no longer needed. Clear any leftover.
    sessionStorage.removeItem('wsc_master_key');

    // Restore cached session first — fast path for already-authenticated users.
    var cached = sessionStorage.getItem('wsc_user');
    if (cached) {
      try {
        this.user = JSON.parse(cached);
        this._sessionToken = sessionStorage.getItem('wsc_session_token') || '';
        this.isLoggedIn = true;
        showApp();
        return;
      } catch(e) { sessionStorage.removeItem('wsc_user'); }
    }

    // No cached session — ask the worker to resolve our identity from the
    // Cloudflare Access header. The frontend intentionally does NOT supply
    // an email; trusting client input would defeat the purpose of CF Access.
    try {
      var res = await fetch(API.baseUrl + '/api/auth/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'include'
      });
      var data = await res.json();

      if (data.needs_migration) {
        this.showDenied('Database migration needed. Contact IT administrator.');
        return;
      }

      if (!data.authorized) {
        this.showDenied(data.error || 'You do not have access to this application. Contact your IT administrator to request access.');
        return;
      }

      this.user = data.user;
      this.isLoggedIn = true;
      sessionStorage.setItem('wsc_user', JSON.stringify(data.user));
      showApp();

    } catch(e) {
      this.showDenied('Cannot connect to API: ' + e.message);
    }
  },

  logout: async function() {
    var hadToken = !!this._sessionToken;

    // Best-effort server-side revocation so the token can't be reused if
    // someone extracts it from an open tab later.
    if (hadToken) {
      try { await API.signOut(); } catch(e) { /* continue regardless */ }
    }

    this.isLoggedIn = false;
    this.user = null;
    this._sessionToken = '';
    sessionStorage.removeItem('wsc_user');
    sessionStorage.removeItem('wsc_session_token');

    if (hadToken) {
      location.reload();
    } else {
      window.location.href = '/cdn-cgi/access/logout';
    }
  },

  showDenied: function(message) {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.getElementById('login-setup').style.display = 'none';
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('login-denied').style.display = 'block';
    document.getElementById('login-denied-msg').textContent = message;
  },

  showMasterKey: function() {
    document.getElementById('login-loading').style.display = 'none';
    document.getElementById('login-denied').style.display = 'none';
    document.getElementById('login-master-key').style.display = 'block';
    document.getElementById('master-key-input').focus();
  },

  loginWithMasterKey: async function() {
    var key = document.getElementById('master-key-input').value.trim();
    var errEl = document.getElementById('master-key-error');
    errEl.style.display = 'none';

    if (!key) {
      errEl.textContent = 'Enter your master key';
      errEl.style.display = 'block';
      return;
    }

    try {
      var res = await fetch(API.baseUrl + '/api/auth/master-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key })
      });
      var data = await res.json();

      if (!data.authorized) {
        errEl.textContent = data.error || 'Invalid master key';
        errEl.style.display = 'block';
        return;
      }

      // Swap the raw master key for the short-lived token and immediately
      // drop the key from memory. If the worker didn't return a token
      // (older build), fall back to the key so the session still works —
      // that path will disappear once the new worker is deployed.
      this.user = data.user;
      this.isLoggedIn = true;
      if (data.token) {
        this._sessionToken = data.token;
        sessionStorage.setItem('wsc_session_token', data.token);
      } else {
        // Transitional: old worker without session support.
        this._sessionToken = '';
        API.apiKey = key;  // in-memory only; not persisted
      }
      // Always wipe the input so the raw key doesn't linger in the DOM.
      document.getElementById('master-key-input').value = '';
      key = '';
      sessionStorage.setItem('wsc_user', JSON.stringify(data.user));
      showApp();
    } catch(e) {
      errEl.textContent = 'Connection failed: ' + e.message;
      errEl.style.display = 'block';
    }
  },

  isAdmin: function() {
    return this.user && this.user.role === 'admin';
  },

  getEmail: function() {
    return this.user ? this.user.email : '';
  }
};

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  // Update sidebar user profile
  if (Auth.user) {
    var nameEl = document.getElementById('sidebar-user-name');
    var roleEl = document.getElementById('sidebar-user-role');
    var avatarEl = document.getElementById('sidebar-avatar');
    if (nameEl) nameEl.textContent = Auth.user.display_name || Auth.user.email;
    if (roleEl) roleEl.textContent = Auth.user.role;
    if (avatarEl) {
      var initials = (Auth.user.display_name || Auth.user.email || '?').split(' ').map(function(w) { return w[0]; }).join('').toUpperCase().slice(0, 2);
      avatarEl.textContent = initials;
    }
  }
  if (typeof Router !== 'undefined') Router.handleRoute();
}
window.showApp = showApp;

function logout() { Auth.logout(); }
window.logout = logout;

// Init on load
document.addEventListener('DOMContentLoaded', function() { Auth.init(); });

window.Auth = Auth;
