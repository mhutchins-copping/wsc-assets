// ─── Settings View ─────────────────────────
// Split into tabs: General, Users, Sync, Import-Export.
// Active tab persists in sessionStorage so a refresh lands back where
// the user was.

Router.register('/settings', function() {
  var el = document.getElementById('view-settings');
  if (!el) return;
  try {
    var activeTab = sessionStorage.getItem('wsc_settings_tab') || 'general';
    el.innerHTML = renderSettings(activeTab);
    if (activeTab === 'users') loadUserList();
    if (activeTab === 'sync') checkEntraStatus();
  } catch(err) {
    console.error('[settings] render failed:', err);
    el.innerHTML = '<div class="settings-error" style="padding:16px">Settings failed to render: '
      + esc(err && err.message ? err.message : String(err)) + '</div>';
  }
});

function renderSettings(activeTab) {
  activeTab = activeTab || 'general';
  var tagPrefix = localStorage.getItem('wsc_tag_prefix') || 'WSC';
  var displayName = Auth.user ? Auth.user.display_name : '—';
  var role = Auth.user ? Auth.user.role : '—';

  var tabs = [
    { id: 'general', label: 'General' }
  ];
  if (Auth.isAdmin()) {
    tabs.push({ id: 'users', label: 'Users' });
    tabs.push({ id: 'sync', label: 'Sync' });
  }
  if (Auth.isManager()) {
    tabs.push({ id: 'import-export', label: 'Import-Export' });
  }

  // If the persisted active tab is no longer visible, fall back to general
  var tabIds = tabs.map(function(t) { return t.id; });
  if (tabIds.indexOf(activeTab) === -1) activeTab = 'general';

  var html = '<div class="settings-page">';

  // Identity strip — always visible above the tabs
  html += '<div class="settings-identity">'
    + '<div>'
    + '<strong>' + esc(displayName) + '</strong>'
    + '<span class="settings-identity-role">' + esc(role) + '</span>'
    + '</div>'
    + '<button class="btn danger sm" onclick="doLogout()">Sign Out</button>'
    + '</div>';

  // Tab bar
  html += '<div class="tabs" id="settings-tabs">';
  tabs.forEach(function(t) {
    var isActive = t.id === activeTab;
    html += '<button class="tab' + (isActive ? ' active' : '') + '" onclick="switchSettingsTab(this,\'settings-tab-' + t.id + '\')">' + esc(t.label) + '</button>';
  });
  html += '</div>';

  var currentTheme = document.documentElement.getAttribute('data-theme') || 'light';

  // ── General ──
  html += '<div id="settings-tab-general" class="settings-tab-content"' + (activeTab === 'general' ? '' : ' style="display:none"') + '>'
    + '<div class="settings-section">'
    + '<div class="settings-section-title">Preferences</div>'
    + '<div class="settings-card">'
    + '<div class="settings-card-body">'
    + '<div class="form-group">'
    + '<label class="form-label">Asset Tag Prefix</label>'
    + '<input type="text" id="settings-tag-prefix" class="form-input" value="' + esc(tagPrefix) + '" placeholder="WSC" maxlength="10">'
    + '<div class="form-hint">Used for auto-generated tags (e.g. ' + esc(tagPrefix) + '-L-0001)</div>'
    + '</div>'
    + '<div class="form-group">'
    + '<label class="form-label">Theme</label>'
    + '<select id="settings-theme" class="form-select" onchange="saveTheme()">'
    + '<option value="light"' + (currentTheme === 'light' ? ' selected' : '') + '>Light</option>'
    + '<option value="dark"' + (currentTheme === 'dark' ? ' selected' : '') + '>Dark</option>'
    + '</select>'
    + '</div>'
    + '<button class="btn primary" onclick="saveDefaults()">Save</button>'
    + '</div></div>'
    + '</div>'

    + '<div class="settings-section">'
    + '<div class="settings-section-title">Asset Registration</div>'
    + '<div class="settings-card">'
    + '<div class="settings-card-header">Register a new asset</div>'
    + '<div class="settings-card-body">'
    + '<div class="form-hint" style="margin-bottom:12px"><strong>Computers (Windows):</strong> on each council computer, open PowerShell and visit <a href="https://api.it-wsc.com/enrol" target="_blank" rel="noopener">api.it-wsc.com/enrol</a>. Enter the registration password; the page hands over a one-line command that registers the asset. Safe to re-run — dedupes on serial number.</div>'
    + '<a class="btn primary" href="https://api.it-wsc.com/enrol" target="_blank" rel="noopener" style="margin-right:8px">Computer registration page</a>'
    + '<div class="form-hint" style="margin:16px 0 12px"><strong>Mobile devices (iPhone &amp; Android):</strong> open on the device being registered (or yours, if you\'re registering someone else\'s). Uses the IMEI as the serial — dial <code>*#06#</code> on the target phone to see it. Barcode scan on supported browsers.</div>'
    + '<button class="btn primary" onclick="navigate(\'#/phone-enrol\')" style="margin-right:8px">Register a phone</button>'
    + '<button class="btn" onclick="navigate(\'#/phone-enrol-batch\')">Batch register phones</button>'
    + '</div></div>'
    + '</div>'
    + '</div>';

  // ── Users ──
  if (Auth.isAdmin()) {
    html += '<div id="settings-tab-users" class="settings-tab-content"' + (activeTab === 'users' ? '' : ' style="display:none"') + '>'
      + '<div class="settings-section">'
      + '<div class="settings-card">'
      + '<div class="settings-card-header">User Management'
      + '<button class="btn sm primary" style="margin-left:auto" onclick="openAddUserModal()">+ Add</button>'
      + '</div>'
      + '<div class="settings-card-body">'
      + '<div id="user-list-container">Loading...</div>'
      + '</div></div>'
      + '</div>'
      + '</div>';
  }

  // ── Sync ──
  if (Auth.isAdmin()) {
    html += '<div id="settings-tab-sync" class="settings-tab-content"' + (activeTab === 'sync' ? '' : ' style="display:none"') + '>'
      + '<div class="settings-section">'
      + '<div class="settings-card">'
      + '<div class="settings-card-header">Entra ID Sync</div>'
      + '<div class="settings-card-body">'
      + '<div class="form-hint" style="margin-bottom:12px">Pulls active council staff from Microsoft Entra into the People directory. Credentials live on the server as Wrangler secrets — set with <code>wrangler secret put ENTRA_TENANT_ID</code>, <code>ENTRA_CLIENT_ID</code>, and <code>ENTRA_CLIENT_SECRET</code>. The app only triggers the sync; it never holds the client secret in the browser.</div>'
      + '<div id="entra-status" class="entra-status pending">Checking configuration…</div>'
      + '<div style="display:flex;gap:8px;margin-top:12px">'
      + '<button id="entra-sync-btn" class="btn primary sm" onclick="syncEntraUsers()" disabled>Sync Users</button>'
      + '</div>'
      + '<div id="entra-sync-result" style="margin-top:12px"></div>'
      + '</div></div>'
      + '</div>'
      + '</div>';
  }

  // ── Import-Export ──
  if (Auth.isManager()) {
    html += '<div id="settings-tab-import-export" class="settings-tab-content"' + (activeTab === 'import-export' ? '' : ' style="display:none"') + '>'
    + '<div class="settings-section">'
    + '<div class="settings-card">'
    + '<div class="settings-card-header">Import from CSV</div>'
    + '<div class="settings-card-body">'
    + '<div class="form-group">'
    + '<label class="form-label">CSV file</label>'
    + '<input type="file" id="csv-import-file" accept=".csv" class="form-input" onchange="previewCSV(this)">'
    + '<div id="csv-preview" style="margin-top:8px"></div>'
    + '<div id="csv-mapping" style="display:none;margin-top:12px">'
    + '<label class="form-label">Column Mapping</label>'
    + '<div id="csv-mapping-fields"></div>'
    + '<div style="display:flex;gap:8px;margin-top:8px">'
    + '<button class="btn primary sm" onclick="runCSVImport()">Import</button>'
    + '<button class="btn sm" onclick="cancelCSVImport()">Cancel</button>'
    + '</div>'
    + '</div>'
    + '<div id="csv-import-result"></div>'
    + '</div>'
    + '</div></div>'

    + '<div class="settings-card" style="margin-top:16px">'
    + '<div class="settings-card-header">Export</div>'
    + '<div class="settings-card-body">'
    + '<div style="display:flex;gap:8px">'
    + '<button class="btn sm" onclick="exportAssetCSV()">Export CSV</button>'
    + '<button class="btn sm" onclick="window.print()">Print PDF</button>'
    + '</div>'
    + '</div></div>'
    + '</div>'
    + '</div>';
  }

  html += '</div>';
  return html;
}

function switchSettingsTab(btn, tabId) {
  document.querySelectorAll('.settings-tab-content').forEach(function(t) { t.style.display = 'none'; });
  document.querySelectorAll('#settings-tabs .tab').forEach(function(t) { t.classList.remove('active'); });
  document.getElementById(tabId).style.display = 'block';
  btn.classList.add('active');
  var tabName = tabId.replace('settings-tab-', '');
  sessionStorage.setItem('wsc_settings_tab', tabName);
  if (tabName === 'users') loadUserList();
  if (tabName === 'sync') checkEntraStatus();
}
window.switchSettingsTab = switchSettingsTab;

function saveDefaults() {
  var prefix = document.getElementById('settings-tag-prefix').value.trim();
  if (prefix) localStorage.setItem('wsc_tag_prefix', prefix);
  toast('Defaults saved', 'success');
}
window.saveDefaults = saveDefaults;

function saveTheme() {
  var mode = document.getElementById('settings-theme').value;
  setTheme(mode);
  toast('Theme updated', 'success');
}
window.saveTheme = saveTheme;

function doLogout() { window.logout(); }
window.doLogout = doLogout;

// === CSV Import/Export ===
var _csvData = null, _csvHeaders = null, _csvRows = null;

function previewCSV(input) {
  if (!input.files.length) return;
  var file = input.files[0];
  var reader = new FileReader();
  reader.onload = function(e) {
    var text = e.target.result;
    var lines = text.split('\n').filter(function(l) { return l.trim(); });
    if (lines.length < 2) { toast('CSV needs header + data rows', 'error'); return; }

    _csvData = text;
    _csvHeaders = lines[0].split(',').map(function(h) { return h.trim().replace(/['"]/g, '').toLowerCase(); });
    _csvRows = lines.length - 1;

    document.getElementById('csv-preview').innerHTML = '<div class="settings-csv-info"><strong>' + _csvRows + '</strong> rows · <span>' + _csvHeaders.join(', ') + '</span></div>';
    document.getElementById('csv-mapping').style.display = 'block';
  };
  reader.readAsText(file);
}
window.previewCSV = previewCSV;

function cancelCSVImport() {
  _csvData = null; _csvHeaders = null; _csvRows = null;
  document.getElementById('csv-preview').innerHTML = '';
  document.getElementById('csv-mapping').style.display = 'none';
  document.getElementById('csv-import-file').value = '';
  document.getElementById('csv-import-result').innerHTML = '';
}
window.cancelCSVImport = cancelCSVImport;

async function runCSVImport() {
  if (!_csvData) { toast('No CSV loaded', 'error'); return; }
  if (!API.baseUrl) { toast('Configure API first', 'error'); return; }

  var mappings = {};
  document.querySelectorAll('[data-map-field]').forEach(function(sel) {
    var field = sel.dataset.mapField;
    var colIdx = sel.value;
    if (colIdx !== '') mappings[field] = parseInt(colIdx);
  });

  var lines = _csvData.split('\n').filter(function(l) { return l.trim(); });
  var fields = Object.keys(mappings);
  var newCsv = fields.join(',') + '\n';

  for (var i = 1; i < lines.length; i++) {
    var cols = parseCSVLine(lines[i]);
    var row = fields.map(function(f) {
      var val = (cols[mappings[f]] || '').trim().replace(/^['"]|['"]$/g, '');
      if (val.indexOf(',') !== -1 || val.indexOf('"') !== -1) val = '"' + val.replace(/"/g, '""') + '"';
      return val;
    });
    newCsv += row.join(',') + '\n';
  }

  document.getElementById('csv-import-result').innerHTML = '<div class="settings-importing">Importing...</div>';

  try {
    var result = await API.importCSV(newCsv);
    document.getElementById('csv-import-result').innerHTML = '<div class="settings-import-result">' +
      '<strong>Imported:</strong> ' + result.created + ' assets' +
      (result.skipped ? ' · <span>Skipped:</span> ' + result.skipped : '') +
      '</div>';
    toast('Imported ' + result.created + ' assets', 'success');
    cancelCSVImport();
  } catch(e) {
    document.getElementById('csv-import-result').innerHTML = '<div class="settings-import-error">Failed: ' + e.message + '</div>';
  }
}
window.runCSVImport = runCSVImport;

function parseCSVLine(line) {
  var result = [];
  var current = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"' && !inQuotes) { inQuotes = true; }
    else if (ch === '"' && inQuotes) {
      if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = false; }
    } else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

// === User Management ===
function loadUserList() {
  var container = document.getElementById('user-list-container');
  if (!container) return;

  API.fetch('/api/auth/users').then(function(res) {
    var users = res.data || [];
    if (!users.length) { container.innerHTML = '<div class="settings-empty">No users</div>'; return; }

    var html = '<table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Notifications</th><th></th></tr></thead><tbody>';
    users.forEach(function(u) {
      html += '<tr><td>' + esc(u.display_name) + '</td>' +
        '<td><span class="mono">' + esc(u.email) + '</span></td>' +
        '<td>' + esc(u.role) + '</td>' +
        '<td><span class="' + (u.active ? 'text-green' : 'text-red') + '">' + (u.active ? 'Active' : 'Disabled') + '</span></td>' +
        '<td>' + (u.notifications_enabled ? '<span class="text-green">On</span>' : '<span style="color:var(--text3)">Off</span>') + '</td>' +
        '<td><button class="btn sm" onclick="openEditUser(\'' + u.id + '\',\'' + esc(u.email) + '\',\'' + esc(u.display_name) + '\',\'' + esc(u.role) + '\',' + u.active + ',' + (u.notifications_enabled ? 1 : 0) + ')">Edit</button></td></tr>';
    });
    container.innerHTML = html + '</tbody></table>';
  }).catch(function(e) {
    container.innerHTML = '<div class="settings-error">Failed: ' + e.message + '</div>';
  });
}

function openAddUserModal() {
  openModal('Add User',
    '<div class="form-group"><label class="form-label">Email</label><input type="email" id="au-email" class="form-input" placeholder="user@walgett.nsw.gov.au"></div>' +
    '<div class="form-group"><label class="form-label">Display Name</label><input type="text" id="au-name" class="form-input" placeholder="Full name"></div>' +
    '<div class="form-group"><label class="form-label">Role</label><select id="au-role" class="form-select"><option value="viewer">Viewer</option><option value="user">User</option><option value="manager">Manager</option><option value="admin">Admin</option></select></div>' +
    '<div class="form-group"><label class="co-ack-label" style="display:flex;gap:8px;align-items:flex-start;cursor:pointer">' +
      '<input type="checkbox" id="au-notifications">' +
      '<span>Receive admin email notifications<div style="font-size:11px;color:var(--text3);font-weight:400">Off by default. Tick only for admins who should get every asset / user / security event.</div></span>' +
    '</label></div>' +
    '<button class="btn primary full" onclick="doAddUser()">Add User</button>'
  );
}
window.openAddUserModal = openAddUserModal;

async function doAddUser() {
  var email = document.getElementById('au-email').value.trim();
  var name = document.getElementById('au-name').value.trim();
  var role = document.getElementById('au-role').value;
  var notif = document.getElementById('au-notifications').checked ? 1 : 0;
  if (!email) { toast('Email required', 'error'); return; }

  try {
    await API.fetch('/api/auth/users', { method: 'POST', body: { email: email, display_name: name || email, role: role, notifications_enabled: notif } });
    closeModal();
    toast('User added', 'success');
    loadUserList();
  } catch (e) { /* API.fetch already toasted the error; leave modal open so the user can correct + retry */ }
}
window.doAddUser = doAddUser;

function openEditUser(id, email, name, role, active, notificationsEnabled) {
  openModal('Edit User',
    '<div class="form-group"><label class="form-label">Email</label><input type="email" id="eu-email" class="form-input" value="' + esc(email) + '"></div>' +
    '<div class="form-group"><label class="form-label">Name</label><input type="text" id="eu-name" class="form-input" value="' + esc(name) + '"></div>' +
    '<div class="form-group"><label class="form-label">Role</label><select id="eu-role" class="form-select"><option value="viewer">Viewer</option><option value="user">User</option><option value="manager">Manager</option><option value="admin">Admin</option></select></div>' +
    '<div class="form-group"><label class="form-label">Status</label><select id="eu-active" class="form-select"><option value="1">Active</option><option value="0">Disabled</option></select></div>' +
    '<div class="form-group"><label class="co-ack-label" style="display:flex;gap:8px;align-items:flex-start;cursor:pointer">' +
      '<input type="checkbox" id="eu-notifications">' +
      '<span>Receive admin email notifications<div style="font-size:11px;color:var(--text3);font-weight:400">Asset created / checked out / checked in / disposed, master-key logins, new users. Receipt-signing emails go to recipients regardless of this setting.</div></span>' +
    '</label></div>' +
    '<div style="display:flex;gap:8px"><button class="btn primary" onclick="doEditUser(\'' + id + '\')">Save</button><button class="btn danger" onclick="doDeleteUser(\'' + id + '\')">Delete</button></div>'
  );
  document.getElementById('eu-role').value = role;
  document.getElementById('eu-active').value = active ? '1' : '0';
  document.getElementById('eu-notifications').checked = !!notificationsEnabled;
}
window.openEditUser = openEditUser;

async function doEditUser(id) {
  try {
    await API.fetch('/api/auth/users/' + id, { method: 'PUT', body: {
      email: document.getElementById('eu-email').value.trim(),
      display_name: document.getElementById('eu-name').value.trim(),
      role: document.getElementById('eu-role').value,
      active: parseInt(document.getElementById('eu-active').value),
      notifications_enabled: document.getElementById('eu-notifications').checked ? 1 : 0
    }});
    closeModal();
    toast('User updated', 'success');
    loadUserList();
  } catch (e) { /* toasted; keep modal open for retry */ }
}
window.doEditUser = doEditUser;

async function doDeleteUser(id) {
  var ok = await confirmDialog('Delete this user? They will lose access to the app immediately.', 'Delete User');
  if (!ok) return;
  try {
    await API.fetch('/api/auth/users/' + id, { method: 'DELETE' });
    closeModal();
    toast('User deleted', 'success');
    loadUserList();
  } catch (e) { /* toasted */ }
}
window.doDeleteUser = doDeleteUser;

// === Entra Sync ===
// All credentials live on the worker as Wrangler secrets. The page only
// shows whether they're configured and triggers the sync.

async function checkEntraStatus() {
  // Best-effort cleanup of legacy storage from earlier builds that kept
  // tenant/client/secret in localStorage. Runs once per load.
  ['wsc_entra_tenant', 'wsc_entra_client', 'wsc_entra_secret'].forEach(function(k) {
    localStorage.removeItem(k);
  });

  var statusEl = document.getElementById('entra-status');
  var btnEl = document.getElementById('entra-sync-btn');
  if (!statusEl) return;

  try {
    var res = await API.entraStatus();
    if (res && res.configured) {
      statusEl.className = 'entra-status ok';
      statusEl.innerHTML = '<strong>Configured.</strong> Click <em>Sync Users</em> to import active council staff from Entra.';
      if (btnEl) btnEl.disabled = false;
    } else {
      statusEl.className = 'entra-status warn';
      statusEl.innerHTML = '<strong>Not configured.</strong> Set all three secrets on the worker before running a sync: <code>ENTRA_TENANT_ID</code>, <code>ENTRA_CLIENT_ID</code>, <code>ENTRA_CLIENT_SECRET</code>.';
      if (btnEl) btnEl.disabled = true;
    }
  } catch (e) {
    statusEl.className = 'entra-status warn';
    statusEl.textContent = 'Status check failed: ' + (e && e.message ? e.message : 'unknown');
    if (btnEl) btnEl.disabled = true;
  }
}
window.checkEntraStatus = checkEntraStatus;

async function syncEntraUsers() {
  var btnEl = document.getElementById('entra-sync-btn');
  var resultEl = document.getElementById('entra-sync-result');

  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Syncing…'; }
  if (resultEl) resultEl.innerHTML = '<div class="settings-syncing">Contacting Microsoft Graph…</div>';

  try {
    var result = await API.syncEntra({ domain: 'walgett.nsw.gov.au' });
    var summary = 'Created: ' + (result.created || 0)
      + ' · Updated: ' + (result.updated || 0)
      + ' · Skipped: ' + (result.skipped || 0)
      + (result.deactivated ? ' · Deactivated: ' + result.deactivated : '');
    if (resultEl) {
      resultEl.innerHTML = '<div class="settings-success">' + esc(summary) + '</div>';
    }
    toast('Sync complete — ' + summary, 'success');
  } catch (e) {
    if (resultEl) {
      resultEl.innerHTML = '<div class="settings-error">Sync failed: ' + esc(e.message || 'unknown') + '</div>';
    }
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Sync Users'; }
  }
}
window.syncEntraUsers = syncEntraUsers;

// Export
function exportAssetCSV() {
  window.open('/api/export/csv', '_blank');
}
window.exportAssetCSV = exportAssetCSV;
