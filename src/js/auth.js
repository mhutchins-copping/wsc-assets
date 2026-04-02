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
    this.isLoggedIn = false;
    this.user = null;
    sessionStorage.removeItem('wsc_user');
    // Redirect to Cloudflare Access logout
    window.location.href = '/cdn-cgi/access/logout';
  },

  showDenied: function(message) {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.getElementById('login-setup').style.display = 'none';
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('login-denied').style.display = 'block';
    document.getElementById('login-denied-msg').textContent = message;
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
