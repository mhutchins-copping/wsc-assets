// ─── Settings View ─────────────────────────

Router.register('/settings', function() {
  var el = document.getElementById('view-settings');
  var isAdmin = Auth.isAdmin();

  el.innerHTML = renderSettings();
  if (isAdmin) loadUserList();
});

function renderSettings() {
  var currentUrl = API.baseUrl || '';
  var hasKey = !!API.apiKey;
  var tagPrefix = localStorage.getItem('wsc_tag_prefix') || 'WSC';

  return '<div class="settings-page">'

    // === Quick Access (top) ===
    '<div class="settings-section">'
    + '<div class="settings-section-title">Quick Access</div>'
    + '<div class="settings-cards">'

    // User Profile Card
    + '<div class="settings-card">'
    + '<div class="settings-card-header">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
    + 'Your Profile'
    + '</div>'
    + '<div class="settings-card-body">'
    + '<div class="settings-info-row"><span>Name</span><span>' + esc(Auth.user ? Auth.user.display_name : '—') + '</span></div>'
    + '<div class="settings-info-row"><span>Email</span><span>' + esc(Auth.user ? Auth.user.email : '—') + '</span></div>'
    + '<div class="settings-info-row"><span>Role</span><span>' + esc(Auth.user ? Auth.user.role : '—') + '</span></div>'
    + '<div class="settings-info-row"><span>Sessions as</span><span>' + (Auth.user ? Auth.user.role : 'Anonymous') + '</span></div>'
    + '<div style="margin-top:12px"><button class="btn danger sm" onclick="doLogout()">Sign Out</button></div>'
    + '</div></div>'

    // System Status Card
    + '<div class="settings-card">'
    + '<div class="settings-card-header">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>'
    + 'System Status'
    + '</div>'
    + '<div class="settings-card-body">'
    + '<div class="settings-info-row"><span>API</span><span class="status-ok">Connected</span></div>'
    + '<div class="settings-info-row"><span>Assets</span><span id="settings-asset-count">—</span></div>'
    + '<div class="settings-info-row"><span>Last sync</span><span id="settings-last-sync">—</span></div>'
    + '<div style="margin-top:12px"><button class="btn sm" onclick="refreshSystemStatus()">Refresh</button></div>'
    + '</div></div>'

    + '</div></div>'

    // === Settings (all users)
    '<div class="settings-section">'
    + '<div class="settings-section-title">Settings</div>'

    // API Connection
    + '<div class="settings-card">'
    + '<div class="settings-card-header">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/><path d="M9 12h6"/></svg>'
    + 'API Connection'
    + '</div>'
    + '<div class="settings-card-body">'
    + '<div class="settings-api-display">'
    + '<div class="settings-api-label">API URL</div>'
    + '<div class="settings-api-value">' + esc(currentUrl) + '</div>'
    + '</div>'
    + '<div style="margin-top:8px">'
    + '<button class="btn sm" onclick="testApiConnection()">Test Connection</button>'
    + '</div>'
    + '<details class="settings-advanced"><summary>Advanced Options</summary>'
    + '<div class="form-group" style="margin-top:12px">'
    + '<label class="form-label">Worker URL Override</label>'
    + '<input type="text" id="settings-api-url" class="form-input" placeholder="https://api.it-wsc.com" value="' + esc(localStorage.getItem('wsc_api_url') || '') + '">'
    + '</div>'
    + '<div class="form-group">'
    + '<label class="form-label">API Key (external scripts)</label>'
    + '<input type="password" id="settings-api-key" class="form-input" placeholder="' + (hasKey ? '••••••••' : 'Optional') + '">'
    + '</div>'
    + '<div style="display:flex;gap:8px">'
    + '<button class="btn primary sm" onclick="saveApiSettings()">Save</button>'
    + '<button class="btn sm" onclick="clearApiOverride()">Reset</button>'
    + '</div>'
    + '</details></div></div>'

    // Asset Defaults
    + '<div class="settings-card">'
    + '<div class="settings-card-header">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>'
    + 'Asset Defaults'
    + '</div>'
    + '<div class="settings-card-body">'
    + '<div class="form-group">'
    + '<label class="form-label">Asset Tag Prefix</label>'
    + '<input type="text" id="settings-tag-prefix" class="form-input" value="' + esc(tagPrefix) + '" placeholder="WSC" maxlength="10">'
    + '<div class="form-hint">Used for auto-generated tags (e.g. ' + esc(tagPrefix) + '-L-0001)</div>'
    + '</div>'
    + '<button class="btn primary" onclick="saveDefaults()">Save Defaults</button>'
    + '</div></div>'

    + '</div></div>'

    // === Dev Tools (admin only) ===
    (Auth.isAdmin() ?
    '<div class="settings-section settings-section-dev">'
    + '<div class="settings-section-title">'
    + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 00-7.94 7.94l-6.91 6.91a2 2 0 01-.9.5H7a2 2 0 01-2-2v-.9a2 2 0 01.5-.9l6.91-6.91a6 6 0 007.94-7.94l-3.76 3.76z"/></svg>'
    + 'Dev Tools <span class="settings-dev-badge">Admin</span>'
    + '</div>'

    // Device Enrollment
    + '<div class="settings-card">'
    + '<div class="settings-card-header">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>'
    + 'Device Enrollment'
    + '</div>'
    + '<div class="settings-card-body">'
    + '<div class="form-hint" style="margin-bottom:12px">Enroll a Windows PC as an asset. Run the script on the target PC, paste the JSON result below.</div>'
    + '<button class="btn sm" onclick="copyEnrollScript()">Copy Script</button>'
    + '<textarea id="enroll-json" class="form-input" rows="3" placeholder="Paste JSON from PowerShell script..." style="font-family:var(--mono);font-size:11px;margin-top:12px"></textarea>'
    + '<button class="btn primary" style="margin-top:8px" onclick="enrollFromClipboard()">Enroll Device</button>'
    + '<div id="enroll-result" style="margin-top:8px"></div>'
    + '</div></div>'

    // CSV Import/Export
    + '<div class="settings-card">'
    + '<div class="settings-card-header">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>'
    + 'Import / Export'
    + '</div>'
    + '<div class="settings-card-body">'
    + '<div class="form-group">'
    + '<label class="form-label">Import from CSV</label>'
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
    + '<div style="display:flex;gap:8px;margin-top:16px">'
    + '<button class="btn sm" onclick="exportAssetCSV()">Export CSV</button>'
    + '<button class="btn sm" onclick="window.print()">Print PDF</button>'
    + '</div>'
    + '</div></div>'

    // Entra ID
    + '<div class="settings-card">'
    + '<div class="settings-card-header">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>'
    + 'Entra ID Sync'
    + '</div>'
    + '<div class="settings-card-body">'
    + '<div class="form-hint" style="margin-bottom:12px">Sync users from Microsoft Entra ID. Requires User.Read.All permission.</div>'
    + '<div class="form-group">'
    + '<label class="form-label">Tenant ID</label>'
    + '<input type="text" id="entra-tenant-id" class="form-input" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value="' + esc(localStorage.getItem('wsc_entra_tenant') || '') + '">'
    + '</div>'
    + '<div class="form-group">'
    + '<label class="form-label">Client ID</label>'
    + '<input type="text" id="entra-client-id" class="form-input" placeholder="App registration client ID" value="' + esc(localStorage.getItem('wsc_entra_client') || '') + '">'
    + '</div>'
    + '<div class="form-group">'
    + '<label class="form-label">Client Secret</label>'
    + '<input type="password" id="entra-client-secret" class="form-input" placeholder="••••••••">'
    + '</div>'
    + '<div style="display:flex;gap:8px">'
    + '<button class="btn sm" onclick="saveEntraConfig()">Save Config</button>'
    + '<button class="btn primary sm" onclick="syncEntraUsers()">Sync Users</button>'
    + '</div>'
    + '<div id="entra-sync-result" style="margin-top:12px"></div>'
    + '</div></div>'

    // User Management
    + '<div class="settings-card">'
    + '<div class="settings-card-header">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>'
    + 'User Management'
    + '<button class="btn sm primary" style="margin-left:auto" onclick="openAddUserModal()">+ Add</button>'
    + '</div>'
    + '<div class="settings-card-body">'
    + '<div id="user-list-container">Loading...</div>'
    + '</div></div>'

    + '</div></div>'
    : '')

    // === About ===
    '<div class="settings-section">'
    + '<div class="settings-section-title">About</div>'
    + '<div class="settings-card">'
    + '<div class="settings-about">'
    + '<div class="settings-about-name">WSC Assets</div>'
    + '<div class="settings-about-version">v1.0.0</div>'
    + '<div class="settings-about-desc">Walgett Shire Council — IT Asset Management</div>'
    + '<div class="settings-about-tech">Built with Vanilla JS + Vite · Cloudflare Workers + D1 + R2 + Pages</div>'
    + '</div></div>'

    + '</div></div>';

  // Initialize after render
  setTimeout(function() {
    refreshSystemStatus();
    API.init();
  }, 100);

  return html;
}

// Quick functions
window.refreshSystemStatus = function() {
  if (!API.baseUrl) return;
  API.getStats().then(function(stats) {
    var countEl = document.getElementById('settings-asset-count');
    if (countEl) countEl.textContent = (stats.total || 0) + ' assets';

    var syncEl = document.getElementById('settings-last-sync');
    if (syncEl) syncEl.textContent = new Date().toLocaleTimeString();
  }).catch(function() {});
};

async function testApiConnection() {
  try {
    var result = await API.getStats();
    toast('Connected — ' + (result.total || 0) + ' assets', 'success');
  } catch(e) {
    toast('Connection failed: ' + e.message, 'error');
  }
}
window.testApiConnection = testApiConnection;

function saveApiSettings() {
  var url = document.getElementById('settings-api-url').value.trim();
  var key = document.getElementById('settings-api-key').value.trim();
  if (url) API.setUrl(url);
  if (key) API.setKey(key);
  toast('Settings saved', 'success');
  API.init();
}
window.saveApiSettings = saveApiSettings;

function clearApiOverride() {
  localStorage.removeItem('wsc_api_url');
  localStorage.removeItem('wsc_api_key');
  API.baseUrl = 'https://api.it-wsc.com';
  API.apiKey = '';
  document.getElementById('settings-api-url').value = '';
  document.getElementById('settings-api-key').value = '';
  toast('Reset to default', 'success');
}
window.clearApiOverride = clearApiOverride;

function saveDefaults() {
  var prefix = document.getElementById('settings-tag-prefix').value.trim();
  if (prefix) localStorage.setItem('wsc_tag_prefix', prefix);
  toast('Defaults saved', 'success');
}
window.saveDefaults = saveDefaults;

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

    var html = '<table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>';
    users.forEach(function(u) {
      html += '<tr><td>' + esc(u.display_name) + '</td>' +
        '<td><span class="mono">' + esc(u.email) + '</span></td>' +
        '<td>' + esc(u.role) + '</td>' +
        '<td><span class="' + (u.active ? 'text-green' : 'text-red') + '">' + (u.active ? 'Active' : 'Disabled') + '</span></td>' +
        '<td><button class="btn sm" onclick="openEditUser(\'' + u.id + '\',\'' + esc(u.email) + '\',\'' + esc(u.display_name) + '\',\'' + esc(u.role) + '\',' + u.active + ')">Edit</button></td></tr>';
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
    '<div class="form-group"><label class="form-label">Role</label><select id="au-role" class="form-select"><option value="user">User</option><option value="admin">Admin</option></select></div>' +
    '<button class="btn primary full" onclick="doAddUser()">Add User</button>'
  );
}
window.openAddUserModal = openAddUserModal;

async function doAddUser() {
  var email = document.getElementById('au-email').value.trim();
  var name = document.getElementById('au-name').value.trim();
  var role = document.getElementById('au-role').value;
  if (!email) { toast('Email required', 'error'); return; }

  await API.fetch('/api/auth/users', { method: 'POST', body: { email: email, display_name: name || email, role: role } });
  closeModal(); toast('User added', 'success'); loadUserList();
}
window.doAddUser = doAddUser;

function openEditUser(id, email, name, role, active) {
  openModal('Edit User',
    '<div class="form-group"><label class="form-label">Email</label><input type="email" id="eu-email" class="form-input" value="' + esc(email) + '"></div>' +
    '<div class="form-group"><label class="form-label">Name</label><input type="text" id="eu-name" class="form-input" value="' + esc(name) + '"></div>' +
    '<div class="form-group"><label class="form-label">Role</label><select id="eu-role" class="form-select"><option value="user">User</option><option value="admin">Admin</option></select></div>' +
    '<div class="form-group"><label class="form-label">Status</label><select id="eu-active" class="form-select"><option value="1">Active</option><option value="0">Disabled</option></select></div>' +
    '<div style="display:flex;gap:8px"><button class="btn primary" onclick="doEditUser(\'' + id + '\')">Save</button><button class="btn danger" onclick="doDeleteUser(\'' + id + '\')">Delete</button></div>'
  );
  document.getElementById('eu-role').value = role;
  document.getElementById('eu-active').value = active ? '1' : '0';
}
window.openEditUser = openEditUser;

async function doEditUser(id) {
  await API.fetch('/api/auth/users/' + id, { method: 'PUT', body: {
    email: document.getElementById('eu-email').value.trim(),
    display_name: document.getElementById('eu-name').value.trim(),
    role: document.getElementById('eu-role').value,
    active: parseInt(document.getElementById('eu-active').value)
  }});
  closeModal(); toast('User updated', 'success'); loadUserList();
}
window.doEditUser = doEditUser;

async function doDeleteUser(id) {
  if (!confirm('Delete user?')) return;
  await API.fetch('/api/auth/users/' + id, { method: 'DELETE' });
  closeModal(); toast('User deleted', 'success'); loadUserList();
}
window.doDeleteUser = doDeleteUser;

// === Device Enrollment ===
function buildEnrollScript() {
  var lines = [
    '# WSC Assets Hardware Collector',
    '$cs = Get-CimInstance Win32_ComputerSystem',
    '$bios = Get-CimInstance Win32_BIOS',
    '$os = Get-CimInstance Win32_OperatingSystem',
    '$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1',
    '$disk = Get-CimInstance Win32_DiskDrive | Where-Object { $_.MediaType -like \"*fixed*\" } | Select-Object -First 1',
    '$chassis = (Get-CimInstance Win32_SystemEnclosure).ChassisTypes',
    '$isLaptop = ($chassis | Where-Object { $_ -in @(8,9,10,11,14,30,31,32) }).Count -gt 0',
    '$ram = [math]::Round($cs.TotalPhysicalMemory / 1GB)',
    '$diskGB = if ($disk) { [math]::Round($disk.Size / 1GB) } else { 0 }',
    '$adapter = Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -and $_.MACAddress } | Select-Object -First 1',
    '$mac = if ($adapter) { $adapter.MACAddress } else { \"N/A\" }',
    '$name = if ($cs.Model -match $cs.Manufacturer) { $cs.Model } else { \"$($cs.Manufacturer) $($cs.Model)\" }',
    '$data = @{',
    '  name = $name',
    '  serial_number = $bios.SerialNumber',
    '  category_id = if ($isLaptop) { \"cat_laptop\" } else { \"cat_desktop\" }',
    '  manufacturer = $cs.Manufacturer',
    '  model = $cs.Model',
    '  status = \"available\"',
    '  hostname = $cs.Name',
    '  os = \"$($os.Caption) $($os.Version)\"',
    '  cpu = $cpu.Name',
    '  ram_gb = $ram',
    '  disk_gb = $diskGB',
    '  mac_address = $mac',
    '  notes = \"Auto-enrolled $(Get-Date -Format \'yyyy-MM-dd HH:mm\')\"',
    '} | ConvertTo-Json',
    '$data | Set-Clipboard',
    'Write-Host \"JSON copied to clipboard!\" -ForegroundColor Green'
  ];
  return lines.join('\r\n');
}

function copyEnrollScript() {
  navigator.clipboard.writeText(buildEnrollScript()).then(function() {
    toast('Script copied to clipboard', 'success');
  });
}
window.copyEnrollScript = copyEnrollScript;

async function enrollFromClipboard() {
  var json = document.getElementById('enroll-json').value.trim();
  if (!json) { toast('Paste JSON first', 'error'); return; }

  var data;
  try { data = JSON.parse(json); } catch(e) { toast('Invalid JSON', 'error'); return; }

  try {
    var existing = await API.fetch('/api/assets/serial/' + encodeURIComponent(data.serial_number));
    document.getElementById('enroll-result').innerHTML = '<div class="settings-warn">Already registered: ' + existing.asset_tag + '</div>';
    return;
  } catch(e) { /* ok */ }

  var result = await API.createAsset(data);
  document.getElementById('enroll-result').innerHTML = '<div class="settings-success">Enrolled: ' + result.asset_tag + '</div>';
  document.getElementById('enroll-json').value = '';
  toast('Device enrolled', 'success');
}
window.enrollFromClipboard = enrollFromClipboard;

// === Entra Sync ===
function saveEntraConfig() {
  var t = document.getElementById('entra-tenant-id').value.trim();
  var c = document.getElementById('entra-client-id').value.trim();
  var s = document.getElementById('entra-client-secret').value.trim();
  if (t) localStorage.setItem('wsc_entra_tenant', t);
  if (c) localStorage.setItem('wsc_entra_client', c);
  if (s) localStorage.setItem('wsc_entra_secret', s);
  toast('Config saved', 'success');
}
window.saveEntraConfig = saveEntraConfig;

async function syncEntraUsers() {
  var t = document.getElementById('entra-tenant-id').value.trim() || localStorage.getItem('wsc_entra_tenant');
  var c = document.getElementById('entra-client-id').value.trim() || localStorage.getItem('wsc_entra_client');
  var s = document.getElementById('entra-client-secret').value.trim() || localStorage.getItem('wsc_entra_secret');
  if (!t || !c || !s) { toast('Fill in all fields', 'error'); return; }

  document.getElementById('entra-sync-result').innerHTML = '<div class="settings-syncing">Syncing...</div>';

  var result = await API.syncEntra({ tenant_id: t, client_id: c, client_secret: s, domain: 'walgett.nsw.gov.au' });
  document.getElementById('entra-sync-result').innerHTML = '<div class="settings-success">Created: ' + result.created + ' · Updated: ' + result.updated + '</div>';
  toast('Synced ' + result.created + ' users', 'success');
}
window.syncEntraUsers = syncEntraUsers;

// Export
function exportAssetCSV() {
  window.open('/api/export/csv', '_blank');
}
window.exportAssetCSV = exportAssetCSV;