// ─── Authentication ────────────────────────────
// PBKDF2 password hashing, session management
// Abstracted for easy swap to Entra ID later

var Auth = {
  isLoggedIn: false,

  init: function() {
    var hash = localStorage.getItem('wsc_pw_hash');
    if (!hash) {
      // First-time setup
      document.getElementById('login-setup').style.display = 'block';
      document.getElementById('login-form').style.display = 'none';
    } else {
      document.getElementById('login-setup').style.display = 'none';
      document.getElementById('login-form').style.display = 'block';
    }

    // Check if session is still valid
    if (sessionStorage.getItem('wsc_session') === 'active') {
      this.isLoggedIn = true;
      showApp();
    }
  },

  hashPassword: async function(password, salt) {
    var enc = new TextEncoder();
    var keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
      keyMaterial, 256
    );
    return Array.from(new Uint8Array(bits)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  },

  setup: async function(password) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var saltHex = Array.from(salt).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    var hash = await this.hashPassword(password, saltHex);
    localStorage.setItem('wsc_pw_salt', saltHex);
    localStorage.setItem('wsc_pw_hash', hash);
    this.login();
  },

  verify: async function(password) {
    var salt = localStorage.getItem('wsc_pw_salt');
    var stored = localStorage.getItem('wsc_pw_hash');
    var hash = await this.hashPassword(password, salt);
    return hash === stored;
  },

  login: function() {
    this.isLoggedIn = true;
    sessionStorage.setItem('wsc_session', 'active');
    showApp();
    toast('Signed in', 'success');
  },

  logout: function() {
    this.isLoggedIn = false;
    sessionStorage.removeItem('wsc_session');
    document.getElementById('app').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('login-setup').style.display = 'none';
    document.getElementById('login-pw').value = '';
    document.getElementById('login-pw').focus();
  }
};

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  // Trigger initial route
  if (typeof Router !== 'undefined') Router.handleRoute();
}
window.showApp = showApp;

async function setupAccount() {
  var pw = document.getElementById('setup-pw').value;
  var pw2 = document.getElementById('setup-pw2').value;
  if (!pw) { toast('Enter a password', 'error'); return; }
  if (pw.length < 4) { toast('Password too short', 'error'); return; }
  if (pw !== pw2) { toast('Passwords don\'t match', 'error'); return; }
  await Auth.setup(pw);
}
window.setupAccount = setupAccount;

async function doLogin() {
  var pw = document.getElementById('login-pw').value;
  if (!pw) { toast('Enter your password', 'error'); return; }
  var ok = await Auth.verify(pw);
  if (ok) {
    Auth.login();
  } else {
    toast('Wrong password', 'error');
    document.getElementById('login-pw').value = '';
    document.getElementById('login-pw').focus();
  }
}
window.doLogin = doLogin;

function logout() { Auth.logout(); }
window.logout = logout;

// Init on load
document.addEventListener('DOMContentLoaded', function() { Auth.init(); });

window.Auth = Auth;
