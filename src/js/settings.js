// ─── Steps 11 + 12: Settings + Import/Export ───

Router.register('/settings', function() {
  var el = document.getElementById('view-settings');

  var currentUrl = API.baseUrl || '';
  var hasKey = !!API.apiKey;
  var tagPrefix = localStorage.getItem('wsc_tag_prefix') || 'WSC';
  var defaultWarranty = localStorage.getItem('wsc_default_warranty') || '36';

  el.innerHTML =
    // API Configuration
    '<div class="card" style="margin-bottom:20px">'
    + '<div class="card-header"><span class="card-title">API Configuration</span></div>'
    + '<div class="card-body">'
    + '<div class="form-group">'
    + '<label class="form-label">Worker URL</label>'
    + '<input type="text" id="settings-api-url" class="form-input" placeholder="https://wsc-assets-api.your-subdomain.workers.dev" value="' + esc(currentUrl) + '">'
    + '<div class="form-hint">Your Cloudflare Worker endpoint</div></div>'
    + '<div class="form-group">'
    + '<label class="form-label">API Key</label>'
    + '<input type="password" id="settings-api-key" class="form-input" placeholder="' + (hasKey ? 'Key saved — enter new to change' : 'Enter your API key') + '">'
    + '<div class="form-hint">Set via: wrangler secret put API_KEY</div></div>'
    + '<div style="display:flex;gap:8px">'
    + '<button class="btn primary" onclick="saveApiSettings()">Save</button>'
    + '<button class="btn" onclick="testApiConnection()">Test Connection</button>'
    + '</div></div></div>'

    // Asset Defaults
    + '<div class="card" style="margin-bottom:20px">'
    + '<div class="card-header"><span class="card-title">Asset Defaults</span></div>'
    + '<div class="card-body">'
    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Asset Tag Prefix</label>'
    + '<input type="text" id="settings-tag-prefix" class="form-input" value="' + esc(tagPrefix) + '" placeholder="WSC" maxlength="10">'
    + '<div class="form-hint">Prefix for auto-generated tags (e.g. WSC-L-0001)</div></div>'
    + '<div class="form-group"><label class="form-label">Default Warranty (months)</label>'
    + '<input type="number" id="settings-default-warranty" class="form-input" value="' + esc(defaultWarranty) + '" placeholder="36">'
    + '<div class="form-hint">Pre-fills warranty field on new assets</div></div>'
    + '</div>'
    + '<button class="btn" onclick="saveDefaults()">Save Defaults</button>'
    + '</div></div>'

    // Import / Export
    + '<div class="card" style="margin-bottom:20px">'
    + '<div class="card-header"><span class="card-title">Import / Export</span></div>'
    + '<div class="card-body">'

    // CSV Import
    + '<div style="margin-bottom:20px">'
    + '<label class="form-label">Import Assets from CSV</label>'
    + '<div class="form-hint" style="margin-bottom:8px">Required columns: <code>name</code>. Optional: <code>asset_tag, serial_number, category, manufacturer, model, status, purchase_date, purchase_cost, supplier, warranty_months, location, assigned_to, notes</code></div>'
    + '<input type="file" id="csv-import-file" accept=".csv" class="form-input" style="padding:8px" onchange="previewCSV(this)">'
    + '<div id="csv-preview" style="margin-top:12px"></div>'
    + '<div id="csv-import-result" style="margin-top:12px"></div>'
    + '</div>'

    // Column mapping
    + '<div id="csv-mapping" style="display:none;margin-bottom:20px">'
    + '<label class="form-label">Column Mapping</label>'
    + '<div class="form-hint" style="margin-bottom:8px">Verify the detected column mapping below. Adjust if needed.</div>'
    + '<div id="csv-mapping-fields"></div>'
    + '<div style="display:flex;gap:8px;margin-top:12px">'
    + '<button class="btn primary" onclick="runCSVImport()">Import</button>'
    + '<button class="btn" onclick="cancelCSVImport()">Cancel</button>'
    + '</div></div>'

    // Device Enrollment Script
    + '<div style="margin-bottom:20px">'
    + '<label class="form-label">Device Enrollment Script</label>'
    + '<div class="form-hint" style="margin-bottom:8px">Download a PowerShell script that auto-collects hardware info (manufacturer, model, serial, OS, CPU, RAM, disk, MAC, IP) and registers the device as an asset. Run on any Windows PC.</div>'
    + '<button class="btn" onclick="downloadEnrollScript()">Download Enroll-Asset.ps1</button>'
    + '</div>'

    // Export
    + '<div>'
    + '<label class="form-label">Export</label>'
    + '<div style="display:flex;gap:8px;margin-top:4px">'
    + '<button class="btn" onclick="exportAssetCSV()">Export All Assets (CSV)</button>'
    + '<button class="btn" onclick="window.print()">Print Asset Register (PDF)</button>'
    + '</div></div>'

    + '</div></div>'

    // Entra ID Integration
    + '<div class="card" style="margin-bottom:20px">'
    + '<div class="card-header"><span class="card-title">Entra ID Integration</span></div>'
    + '<div class="card-body">'
    + '<div class="form-hint" style="margin-bottom:12px">Sync users from Microsoft Entra ID (Azure AD) into the People directory. Requires an app registration with <code>User.Read.All</code> application permission.</div>'
    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Tenant ID</label>'
    + '<input type="text" id="entra-tenant-id" class="form-input" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value="' + esc(localStorage.getItem('wsc_entra_tenant') || '') + '"></div>'
    + '<div class="form-group"><label class="form-label">Client ID</label>'
    + '<input type="text" id="entra-client-id" class="form-input" placeholder="App registration client ID" value="' + esc(localStorage.getItem('wsc_entra_client') || '') + '"></div>'
    + '</div>'
    + '<div class="form-group"><label class="form-label">Client Secret</label>'
    + '<input type="password" id="entra-client-secret" class="form-input" placeholder="' + (localStorage.getItem('wsc_entra_secret') ? 'Secret saved — enter new to change' : 'App registration client secret') + '">'
    + '</div>'
    + '<div style="display:flex;gap:8px;align-items:center">'
    + '<button class="btn" onclick="saveEntraConfig()">Save Config</button>'
    + '<button class="btn primary" onclick="syncEntraUsers()">Sync Users from Entra</button>'
    + '</div>'
    + '<div id="entra-sync-result" style="margin-top:12px"></div>'
    + '</div></div>'

    // Security
    + '<div class="card" style="margin-bottom:20px">'
    + '<div class="card-header"><span class="card-title">Security</span></div>'
    + '<div class="card-body">'
    + '<div style="display:flex;gap:8px;align-items:center">'
    + '<button class="btn" onclick="changePassword()">Change Password</button>'
    + '<button class="btn danger" onclick="doLogout()">Sign Out</button>'
    + '</div></div></div>'

    // About
    + '<div class="card">'
    + '<div class="card-header"><span class="card-title">About</span></div>'
    + '<div class="card-body">'
    + '<div style="font-size:13px;line-height:2">'
    + '<strong>WSC Assets</strong> v1.0.0<br>'
    + 'Walgett Shire Council — IT Asset Management<br>'
    + '<span style="font-family:var(--mono);font-size:11px;color:var(--text3)">Built with Vanilla JS + Vite &middot; Cloudflare Workers + D1 + R2 + Pages</span><br>'
    + '<span style="font-family:var(--mono);font-size:11px;color:var(--text3)">Domain: assets.it-wsc.com</span>'
    + '</div></div></div>';
});

// ─── API Settings ──────────────────────────────

function saveApiSettings() {
  var url = document.getElementById('settings-api-url').value.trim();
  var key = document.getElementById('settings-api-key').value.trim();
  if (url) API.setUrl(url);
  if (key) API.setKey(key);
  toast('Settings saved', 'success');
}
window.saveApiSettings = saveApiSettings;

async function testApiConnection() {
  if (!API.baseUrl) { toast('Enter a Worker URL first', 'error'); return; }
  try {
    var result = await API.getStats();
    toast('Connected! ' + (result.total || 0) + ' assets in database', 'success');
  } catch(e) {
    toast('Connection failed: ' + e.message, 'error');
  }
}
window.testApiConnection = testApiConnection;

function saveDefaults() {
  var prefix = document.getElementById('settings-tag-prefix').value.trim();
  var warranty = document.getElementById('settings-default-warranty').value.trim();
  if (prefix) localStorage.setItem('wsc_tag_prefix', prefix);
  if (warranty) localStorage.setItem('wsc_default_warranty', warranty);
  toast('Defaults saved', 'success');
}
window.saveDefaults = saveDefaults;

// ─── CSV Import with Column Mapping ────────────

var _csvData = null;
var _csvHeaders = null;
var _csvRows = null;

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

    // Show preview
    var previewEl = document.getElementById('csv-preview');
    previewEl.innerHTML = '<div style="padding:12px;background:var(--surface2);border-radius:var(--radius-sm);font-family:var(--mono);font-size:12px">'
      + '<div style="font-weight:600;margin-bottom:4px">' + _csvRows + ' rows detected</div>'
      + '<div style="color:var(--text3)">Columns: ' + _csvHeaders.join(', ') + '</div>'
      + '</div>';

    // Show mapping UI
    var mappingEl = document.getElementById('csv-mapping');
    mappingEl.style.display = 'block';

    var knownFields = ['asset_tag', 'name', 'serial_number', 'category', 'manufacturer', 'model', 'status', 'purchase_date', 'purchase_cost', 'purchase_order', 'supplier', 'warranty_months', 'location', 'assigned_to', 'notes'];

    var fieldsHtml = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
    knownFields.forEach(function(field) {
      var detected = _csvHeaders.indexOf(field) !== -1;
      var matchIdx = _csvHeaders.indexOf(field);

      // Try fuzzy match
      if (matchIdx === -1) {
        _csvHeaders.forEach(function(h, i) {
          if (h.replace(/[_\s-]/g, '') === field.replace(/[_\s-]/g, '')) matchIdx = i;
        });
      }

      fieldsHtml += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0">'
        + '<span style="font-size:12px;font-family:var(--mono);min-width:120px;color:' + (detected ? 'var(--green)' : 'var(--text3)') + '">'
        + (detected ? '&#10003; ' : '') + field + '</span>'
        + '<select class="form-select" data-map-field="' + field + '" style="font-size:12px;padding:4px 8px">'
        + '<option value="">— skip —</option>';

      _csvHeaders.forEach(function(h, i) {
        fieldsHtml += '<option value="' + i + '"' + (i === matchIdx ? ' selected' : '') + '>' + esc(h) + '</option>';
      });

      fieldsHtml += '</select></div>';
    });
    fieldsHtml += '</div>';

    document.getElementById('csv-mapping-fields').innerHTML = fieldsHtml;
  };
  reader.readAsText(file);
}
window.previewCSV = previewCSV;

function cancelCSVImport() {
  _csvData = null;
  _csvHeaders = null;
  _csvRows = null;
  document.getElementById('csv-preview').innerHTML = '';
  document.getElementById('csv-mapping').style.display = 'none';
  document.getElementById('csv-import-file').value = '';
  document.getElementById('csv-import-result').innerHTML = '';
}
window.cancelCSVImport = cancelCSVImport;

async function runCSVImport() {
  if (!_csvData) { toast('No CSV loaded', 'error'); return; }
  if (!API.baseUrl) { toast('Configure API first', 'error'); return; }

  // Build remapped CSV using column mapping
  var mappings = {};
  document.querySelectorAll('[data-map-field]').forEach(function(sel) {
    var field = sel.dataset.mapField;
    var colIdx = sel.value;
    if (colIdx !== '') mappings[field] = parseInt(colIdx);
  });

  var lines = _csvData.split('\n').filter(function(l) { return l.trim(); });
  var knownFields = Object.keys(mappings);

  // Rebuild CSV with standard headers
  var newCsv = knownFields.join(',') + '\n';
  for (var i = 1; i < lines.length; i++) {
    var cols = parseCSVLineLocal(lines[i]);
    var row = knownFields.map(function(f) {
      var val = cols[mappings[f]] || '';
      val = val.trim().replace(/^['"]|['"]$/g, '');
      if (val.indexOf(',') !== -1 || val.indexOf('"') !== -1) val = '"' + val.replace(/"/g, '""') + '"';
      return val;
    });
    newCsv += row.join(',') + '\n';
  }

  var resultEl = document.getElementById('csv-import-result');
  resultEl.innerHTML = '<div style="padding:12px;background:var(--accent-l);border-radius:var(--radius-sm);font-family:var(--mono);font-size:12px">'
    + 'Importing ' + _csvRows + ' rows...</div>';

  try {
    var result = await API.importCSV(newCsv);
    var html = '<div style="padding:12px;background:var(--green-l, #dcfce7);border-radius:var(--radius-sm);font-size:13px">'
      + '<div style="font-weight:600;margin-bottom:4px">Import Complete</div>'
      + '<div style="font-family:var(--mono);font-size:12px">'
      + '<span style="color:var(--green)">&#10003; ' + result.created + ' created</span>';
    if (result.skipped) html += ' &middot; <span style="color:var(--amber)">' + result.skipped + ' skipped</span>';
    html += '</div>';
    if (result.errors && result.errors.length) {
      html += '<div style="margin-top:8px;font-size:11px;color:var(--red);max-height:100px;overflow-y:auto">'
        + result.errors.join('<br>') + '</div>';
    }
    html += '</div>';
    resultEl.innerHTML = html;
    toast('Imported ' + result.created + ' assets', 'success');
    cancelCSVImport();
  } catch(e) {
    resultEl.innerHTML = '<div style="padding:12px;background:var(--red-l, #fee2e2);border-radius:var(--radius-sm);font-size:13px;color:var(--red)">Import failed: ' + esc(e.message) + '</div>';
  }
}
window.runCSVImport = runCSVImport;

function parseCSVLineLocal(line) {
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

// ─── Security ──────────────────────────────────

function changePassword() {
  openModal('Change Password',
    '<div class="form-group"><label class="form-label">Current Password</label><input type="password" id="cp-current" class="form-input"></div>'
    + '<div class="form-group"><label class="form-label">New Password</label><input type="password" id="cp-new" class="form-input"></div>'
    + '<div class="form-group"><label class="form-label">Confirm New Password</label><input type="password" id="cp-confirm" class="form-input"></div>'
    + '<button class="btn primary full" onclick="doChangePassword()">Change Password</button>'
  );
}
window.changePassword = changePassword;

async function doChangePassword() {
  var current = document.getElementById('cp-current').value;
  var newPw = document.getElementById('cp-new').value;
  var confirm = document.getElementById('cp-confirm').value;
  if (!current) { toast('Enter current password', 'error'); return; }
  if (!newPw || newPw.length < 4) { toast('New password too short', 'error'); return; }
  if (newPw !== confirm) { toast('Passwords don\'t match', 'error'); return; }
  var ok = await Auth.verify(current);
  if (!ok) { toast('Wrong current password', 'error'); return; }
  await Auth.setup(newPw);
  closeModal();
  toast('Password changed', 'success');
}
window.doChangePassword = doChangePassword;

function doLogout() { logout(); }
window.doLogout = doLogout;

// ─── Device Enrollment Script Download ────────

function downloadEnrollScript() {
  if (!API.baseUrl) { toast('Configure API URL first', 'error'); return; }
  if (!API.apiKey) { toast('Configure API Key first', 'error'); return; }

  var script = '#Requires -Version 5.1\n'
    + '<#\n.SYNOPSIS\n    Collects hardware info from this device and registers it in WSC Assets.\n#>\n\n'
    + '$ErrorActionPreference = "Stop"\n'
    + '$ApiUrl = "' + API.baseUrl.replace(/"/g, '`"') + '"\n'
    + '$ApiKey = "' + API.apiKey.replace(/"/g, '`"') + '"\n\n'
    + 'Write-Host "Collecting hardware information..." -ForegroundColor Cyan\n\n'
    + '$cs   = Get-CimInstance Win32_ComputerSystem\n'
    + '$bios = Get-CimInstance Win32_BIOS\n'
    + '$os   = Get-CimInstance Win32_OperatingSystem\n'
    + '$cpu  = Get-CimInstance Win32_Processor | Select-Object -First 1\n'
    + '$disk = Get-CimInstance Win32_DiskDrive | Where-Object { $_.MediaType -like "*fixed*" } | Select-Object -First 1\n\n'
    + '$chassis = (Get-CimInstance Win32_SystemEnclosure).ChassisTypes\n'
    + '$laptopTypes = @(8, 9, 10, 11, 14, 30, 31, 32)\n'
    + '$isLaptop = ($chassis | Where-Object { $_ -in $laptopTypes }).Count -gt 0\n'
    + '$categoryId = if ($isLaptop) { "cat_laptop" } else { "cat_desktop" }\n'
    + '$deviceType = if ($isLaptop) { "Laptop" } else { "Desktop" }\n\n'
    + '$ramGB = [math]::Round($cs.TotalPhysicalMemory / 1GB)\n'
    + '$diskGB = if ($disk) { [math]::Round($disk.Size / 1GB) } else { 0 }\n\n'
    + '$adapter = Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -and $_.MACAddress } | Select-Object -First 1\n'
    + '$mac = if ($adapter) { $adapter.MACAddress } else { "N/A" }\n'
    + '$ip  = if ($adapter.IPAddress) { ($adapter.IPAddress | Where-Object { $_ -match "^\\d+\\.\\d+\\.\\d+\\.\\d+$" } | Select-Object -First 1) } else { "N/A" }\n\n'
    + '$currentUser = $cs.UserName\n'
    + '$computerName = $cs.Name\n'
    + '$serial = $bios.SerialNumber\n\n'
    + 'Write-Host ""\n'
    + 'Write-Host "=== Device Information ===" -ForegroundColor Yellow\n'
    + 'Write-Host "  Type:          $deviceType"\n'
    + 'Write-Host "  Name:          $computerName"\n'
    + 'Write-Host "  Manufacturer:  $($cs.Manufacturer)"\n'
    + 'Write-Host "  Model:         $($cs.Model)"\n'
    + 'Write-Host "  Serial:        $serial"\n'
    + 'Write-Host "  OS:            $($os.Caption) $($os.Version)"\n'
    + 'Write-Host "  CPU:           $($cpu.Name)"\n'
    + 'Write-Host "  RAM:           ${ramGB} GB"\n'
    + 'Write-Host "  Disk:          ${diskGB} GB"\n'
    + 'Write-Host "  MAC:           $mac"\n'
    + 'Write-Host "  IP:            $ip"\n'
    + 'Write-Host "  User:          $currentUser"\n'
    + 'Write-Host "=========================" -ForegroundColor Yellow\n'
    + 'Write-Host ""\n\n'
    + '$notes = @(\n'
    + '    "Auto-enrolled via PowerShell script",\n'
    + '    "OS: $($os.Caption) $($os.Version)",\n'
    + '    "CPU: $($cpu.Name)",\n'
    + '    "RAM: ${ramGB} GB",\n'
    + '    "Disk: ${diskGB} GB",\n'
    + '    "MAC: $mac",\n'
    + '    "IP: $ip",\n'
    + '    "User at enrollment: $currentUser",\n'
    + '    "Enrolled: $(Get-Date -Format \'yyyy-MM-dd HH:mm:ss\')"\n'
    + ') -join "`n"\n\n'
    + '$headers = @{ "X-Api-Key" = $ApiKey; "Content-Type" = "application/json" }\n\n'
    + 'Write-Host "Checking if device is already registered..." -ForegroundColor Cyan\n'
    + 'try {\n'
    + '    $check = Invoke-RestMethod -Uri "$ApiUrl/api/assets/serial/$serial" -Headers $headers -Method Get -ErrorAction Stop\n'
    + '    Write-Host "This device is already registered as $($check.asset_tag) ($($check.name))" -ForegroundColor Yellow\n'
    + '    Write-Host "Press any key to exit..."; $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")\n'
    + '    exit 0\n'
    + '} catch {\n'
    + '    if ($_.Exception.Response.StatusCode.value__ -ne 404) {\n'
    + '        Write-Host "Warning: Could not check existing assets: $($_.Exception.Message)" -ForegroundColor Yellow\n'
    + '    }\n'
    + '}\n\n'
    + '$assetName = "$($cs.Manufacturer) $($cs.Model)"\n'
    + '$assetName = $assetName -replace "System manufacturer", "" -replace "System Product Name", "" -replace "^\\s+|\\s+$", ""\n'
    + 'if ([string]::IsNullOrWhiteSpace($assetName)) { $assetName = $computerName }\n\n'
    + '$body = @{\n'
    + '    name          = $assetName\n'
    + '    serial_number = $serial\n'
    + '    category_id   = $categoryId\n'
    + '    manufacturer  = $cs.Manufacturer -replace "System manufacturer", "Unknown"\n'
    + '    model         = $cs.Model -replace "System Product Name", "Unknown"\n'
    + '    status        = "available"\n'
    + '    notes         = $notes\n'
    + '} | ConvertTo-Json\n\n'
    + 'Write-Host "Registering asset..." -ForegroundColor Cyan\n'
    + 'try {\n'
    + '    $result = Invoke-RestMethod -Uri "$ApiUrl/api/assets" -Headers $headers -Method Post -Body $body -ErrorAction Stop\n'
    + '    Write-Host "" \n'
    + '    Write-Host "Successfully registered!" -ForegroundColor Green\n'
    + '    Write-Host "  Asset Tag: $($result.asset_tag)" -ForegroundColor Green\n'
    + '    Write-Host "  Asset ID:  $($result.id)" -ForegroundColor Green\n'
    + '} catch {\n'
    + '    Write-Host "Failed to register asset: $($_.Exception.Message)" -ForegroundColor Red\n'
    + '    if ($_.ErrorDetails.Message) { Write-Host "  Details: $($_.ErrorDetails.Message)" -ForegroundColor Red }\n'
    + '}\n'
    + 'Write-Host ""\nWrite-Host "Press any key to exit..."; $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")\n';

  var blob = new Blob([script.replace(/\\n/g, '\r\n')], { type: 'application/octet-stream' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Enroll-Asset.ps1';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Script downloaded — run on any Windows PC', 'success');
}
window.downloadEnrollScript = downloadEnrollScript;

// ─── Entra ID Sync ─────────────────────────

function saveEntraConfig() {
  var tenant = document.getElementById('entra-tenant-id').value.trim();
  var client = document.getElementById('entra-client-id').value.trim();
  var secret = document.getElementById('entra-client-secret').value.trim();
  if (tenant) localStorage.setItem('wsc_entra_tenant', tenant);
  if (client) localStorage.setItem('wsc_entra_client', client);
  if (secret) localStorage.setItem('wsc_entra_secret', secret);
  toast('Entra config saved', 'success');
}
window.saveEntraConfig = saveEntraConfig;

async function syncEntraUsers() {
  var tenant = document.getElementById('entra-tenant-id').value.trim() || localStorage.getItem('wsc_entra_tenant');
  var client = document.getElementById('entra-client-id').value.trim() || localStorage.getItem('wsc_entra_client');
  var secret = document.getElementById('entra-client-secret').value.trim() || localStorage.getItem('wsc_entra_secret');

  if (!tenant || !client || !secret) {
    toast('Fill in all Entra ID fields first', 'error');
    return;
  }

  if (!API.baseUrl || !API.apiKey) {
    toast('Configure API settings first', 'error');
    return;
  }

  var resultEl = document.getElementById('entra-sync-result');
  resultEl.innerHTML = '<div style="padding:12px;background:var(--accent-l);border-radius:var(--radius-sm);font-family:var(--mono);font-size:12px">'
    + 'Connecting to Microsoft Graph API...</div>';

  try {
    var result = await API.syncEntra({
      tenant_id: tenant,
      client_id: client,
      client_secret: secret
    });

    var html = '<div style="padding:12px;background:var(--green-l, #dcfce7);border-radius:var(--radius-sm);font-size:13px">'
      + '<div style="font-weight:600;margin-bottom:4px">Sync Complete</div>'
      + '<div style="font-family:var(--mono);font-size:12px">'
      + 'Fetched: ' + result.total_fetched + ' users<br>'
      + '<span style="color:var(--green)">&#10003; ' + result.created + ' created</span>'
      + ' &middot; <span style="color:var(--accent)">' + result.updated + ' updated</span>';
    if (result.skipped) html += ' &middot; <span style="color:var(--text3)">' + result.skipped + ' skipped</span>';
    html += '</div>';
    if (result.errors && result.errors.length) {
      html += '<div style="margin-top:8px;font-size:11px;color:var(--red);max-height:100px;overflow-y:auto">'
        + result.errors.join('<br>') + '</div>';
    }
    html += '</div>';
    resultEl.innerHTML = html;
    toast('Synced ' + result.created + ' new + ' + result.updated + ' updated users', 'success');
  } catch(e) {
    resultEl.innerHTML = '<div style="padding:12px;background:var(--red-l, #fee2e2);border-radius:var(--radius-sm);font-size:13px;color:var(--red)">Sync failed: ' + esc(e.message) + '</div>';
  }
}
window.syncEntraUsers = syncEntraUsers;
