// ─── Account view ────────────────────────────────────
// Shown when the user clicks their name in the sidebar. Read-only summary
// of the signed-in identity plus a sign-out action. Admins also see a
// shortcut to the User Management section of Settings.

Router.register('/account', renderAccount);

function renderAccount() {
  var el = document.getElementById('view-account');
  var u = (typeof Auth !== 'undefined' && Auth.user) ? Auth.user : null;

  if (!u) {
    el.innerHTML = '<div class="view-placeholder"><div class="view-placeholder-sub">Sign in to see your account details.</div></div>';
    return;
  }

  var initials = (u.display_name || u.email || '?').split(/\s+/).map(function(w){return w[0];}).join('').toUpperCase().slice(0,2);
  var lastLogin = u.last_login ? fmtDateTime(u.last_login) : '—';
  var isAdmin = u.role === 'admin';

  el.innerHTML = ''
    + '<div class="acct-wrap">'
    // Header card with avatar and primary identity
    + '<div class="card acct-header">'
    + '<div class="acct-avatar">' + esc(initials) + '</div>'
    + '<div class="acct-headline">'
    + '<div class="acct-name">' + esc(u.display_name || '—') + '</div>'
    + '<div class="acct-email">' + esc(u.email || '—') + '</div>'
    + '</div>'
    + '<div class="acct-role-badge" data-role="' + esc(u.role) + '">' + esc(u.role || 'user') + '</div>'
    + '</div>'

    // Details card
    + '<div class="card acct-details">'
    + '<div class="card-header"><span class="card-title">Account</span></div>'
    + '<div class="card-body">'
    + '<div class="acct-row"><span class="acct-label">Display name</span><span class="acct-value">' + esc(u.display_name || '—') + '</span></div>'
    + '<div class="acct-row"><span class="acct-label">Email</span><span class="acct-value mono">' + esc(u.email || '—') + '</span></div>'
    + '<div class="acct-row"><span class="acct-label">Role</span><span class="acct-value">' + esc(u.role || 'user') + (isAdmin ? ' — full access' : '') + '</span></div>'
    + '<div class="acct-row"><span class="acct-label">Last sign-in</span><span class="acct-value mono">' + esc(lastLogin) + '</span></div>'
    + '<div class="acct-row"><span class="acct-label">Sign-in method</span><span class="acct-value">' + (Auth && Auth._sessionToken ? 'Master key session (break-glass)' : 'Microsoft SSO') + '</span></div>'
    + '</div>'
    + '</div>'

    // Actions card
    + '<div class="card acct-actions-card">'
    + '<div class="card-header"><span class="card-title">Actions</span></div>'
    + '<div class="card-body acct-actions">'
    + (isAdmin
        ? '<button class="btn" onclick="navigate(\'#/settings\')">Open Settings</button>'
        : '<div class="acct-hint">To request a change to your role or to be removed from the system, contact your administrator.</div>')
    + '<button class="btn danger" onclick="accountSignOut()">Sign Out</button>'
    + '</div>'
    + '</div>'

    + '</div>';
}
window.renderAccount = renderAccount;

function accountSignOut() {
  if (typeof Auth !== 'undefined' && Auth.logout) {
    Auth.logout();
  } else {
    window.location.href = '/cdn-cgi/access/logout';
  }
}
window.accountSignOut = accountSignOut;
