// ─── Authentication ────────────────────────────
// SSO identity (Cloudflare Access) mapped to internal app users
// No separate password — SSO handles authentication,
// internal user record handles authorisation

var Auth = {
  isLoggedIn: false,
  user: null, // { id, email, display_name, role }

  init: async function() {
    // Check for cached user
    var cached = sessionStorage.getItem('wsc_user');
    if (cached) {
      try {
        this.user = JSON.parse(cached);
        this._masterKey = sessionStorage.getItem('wsc_master_key') || '';
        this.isLoggedIn = true;
        showApp();
        return;
      } catch(e) { sessionStorage.removeItem('wsc_user'); }
    }

    // Get SSO email from Cloudflare Access
    var email = await this.getSSOEmail();
    if (!email) {
      this.showDenied('SSO identity not found. Make sure you are accessing this site through Cloudflare Access.');
      return;
    }

    // Look up internal user by SSO email
    try {
      var res = await fetch(API.baseUrl + '/api/auth/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
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

      // Authorised — log in
      this.user = data.user;
      this.isLoggedIn = true;
      sessionStorage.setItem('wsc_user', JSON.stringify(data.user));
      showApp();

    } catch(e) {
      this.showDenied('Cannot connect to API: ' + e.message);
    }
  },

  getSSOEmail: async function() {
    // Cloudflare Access sets user identity in a JWT cookie (CF_Authorization)
    // We can get the email from the /cdn-cgi/access/get-identity endpoint
    try {
      var res = await fetch('/cdn-cgi/access/get-identity');
      if (res.ok) {
        var identity = await res.json();
        return identity.email || null;
      }
    } catch(e) { /* not behind Access */ }

    // Fallback: check if email was passed via header (for development)
    return null;
  },

  logout: function() {
    var wasMasterKey = !!this._masterKey;
    this.isLoggedIn = false;
    this.user = null;
    this._masterKey = '';
    sessionStorage.removeItem('wsc_user');
    sessionStorage.removeItem('wsc_master_key');
    if (wasMasterKey) {
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

      this.user = data.user;
      this.isLoggedIn = true;
      this._masterKey = key;
      sessionStorage.setItem('wsc_user', JSON.stringify(data.user));
      sessionStorage.setItem('wsc_master_key', key);
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
  // Update sidebar with user info
  var footer = document.querySelector('.sidebar-footer-text');
  if (footer && Auth.user) {
    footer.textContent = Auth.user.display_name + ' \u00b7 ' + Auth.user.role;
  }
  if (typeof Router !== 'undefined') Router.handleRoute();
}
window.showApp = showApp;

function logout() { Auth.logout(); }
window.logout = logout;

// Init on load
document.addEventListener('DOMContentLoaded', function() { Auth.init(); });

window.Auth = Auth;
