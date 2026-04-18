// ─── Settings View ─────────────────────────

Router.register('/settings', function() {
  var el = document.getElementById('view-settings');
  if (!el) return;
  var isAdmin = Auth.isAdmin();

  try {
    el.innerHTML = renderSettings();
    if (isAdmin) loadUserList();
  } catch(err) {
    console.error('[settings] render failed:', err);
    el.innerHTML = '<div class="settings-error" style="padding:16px">Settings failed to render: '
      + esc(err && err.message ? err.message : String(err)) + '</div>';
  }
});

function renderSettings() {
  var currentUrl = API.baseUrl || '';
  var hasKey = !!API.apiKey;
  var tagPrefix = localStorage.getItem('wsc_tag_prefix') || 'WSC';
  var isAdmin = Auth.isAdmin();
  var displayName = Auth.user ? Auth.user.display_name : '—';
  var role = Auth.user ? Auth.user.role : '—';

  return '<div class="settings-page">'

    // === Identity strip ===
    + '<div class="settings-identity">'
    + '<div>'
    + '<strong>' + esc(displayName) + '</strong>'
    + '<span class="settings-identity-role">' + esc(role) + '</span>'
    + '</div>'
    + '<button class="btn danger sm" onclick="doLogout()">Sign Out</button>'
    + '</div>'

    // === Preferences (all users) ===
    + '<div class="settings-section">'
    + '<div class="settings-section-title">Preferences</div>'
    + '<div class="settings-card">'
    + '<div class="settings-card-body">'
    + '<div class="form-group">'
    + '<label class="form-label">Asset Tag Prefix</label>'
    + '<input type="text" id="settings-tag-prefix" class="form-input" value="' + esc(tagPrefix) + '" placeholder="WSC" maxlength="10">'
    + '<div class="form-hint">Used for auto-generated tags (e.g. ' + esc(tagPrefix) + '-L-0001)</div>'
    + '</div>'
    + '<button class="btn primary" onclick="saveDefaults()">Save</button>'
    + '</div></div>'
    + '</div>'

    // === Admin ===
    + (isAdmin ?
    '<div class="settings-section settings-section-dev">'
    + '<div class="settings-section-title">Admin <span class="settings-dev-badge">Admin</span></div>'

    // Device Enrollment
    + '<div class="settings-card">'
    + '<div class="settings-card-header">Device Enrollment</div>'
    + '<div class="settings-card-body">'
    + '<div class="form-hint" style="margin-bottom:12px">Enroll a Windows PC as an asset. Run the script on the target PC, paste the JSON result below.</div>'
    + '<button class="btn sm" onclick="copyEnrollScript()">Copy Script</button>'
    + '<textarea id="enroll-json" class="form-input" rows="3" placeholder="Paste JSON from PowerShell script..." style="font-family:var(--mono);font-size:11px;margin-top:12px"></textarea>'
    + '<button class="btn primary" style="margin-top:8px" onclick="enrollFromClipboard()">Enroll Device</button>'
    + '<div id="enroll-result" style="margin-top:8px"></div>'
    + '</div></div>'

    // CSV Import/Export
    + '<div class="settings-card">'
    + '<div class="settings-card-header">Import / Export</div>'
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
    + '<div class="settings-card-header">Entra ID Sync</div>'
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
    + '<div class="settings-card-header">User Management'
    + '<button class="btn sm primary" style="margin-left:auto" onclick="openAddUserModal()">+ Add</button>'
    + '</div>'
    + '<div class="settings-card-body">'
    + '<div id="user-list-container">Loading...</div>'
    + '</div></div>'

    // API Connection (collapsed, at bottom — infrastructure only)
    + '<details class="settings-card settings-advanced">'
    + '<summary class="settings-card-header" style="cursor:pointer">API Connection</summary>'
    + '<div class="settings-card-body">'
    + '<div class="settings-info-row"><span>API URL</span><span class="mono">' + esc(currentUrl) + '</span></div>'
    + '<div style="margin-top:8px;display:flex;gap:8px">'
    + '<button class="btn sm" onclick="testApiConnection()">Test Connection</button>'
    + '</div>'
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
    + '</div></details>'

    + '</div>'
    : '')

    + '</div>';
}

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