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

    // Device Enrollment
    + '<div style="margin-bottom:20px">'
    + '<label class="form-label">Device Enrollment</label>'
    + '<div class="form-hint" style="margin-bottom:8px">Collect hardware info from a Windows PC and register it as an asset. Two steps: run the script on the PC, then paste the result here.</div>'
    + '<div style="display:flex;gap:8px;margin-bottom:12px">'
    + '<button class="btn" onclick="copyEnrollScript()">1. Copy Collection Script</button>'
    + '</div>'
    + '<div class="form-hint" style="margin-bottom:12px">Open <strong>PowerShell</strong> on the target PC, paste the script, then paste the copied JSON below:</div>'
    + '<textarea id="enroll-json" class="form-input" rows="4" placeholder="Paste the JSON from the PowerShell script here..." style="font-family:var(--mono);font-size:12px"></textarea>'
    + '<div style="display:flex;gap:8px;margin-top:8px">'
    + '<button class="btn primary" onclick="enrollFromClipboard()">2. Enroll Device</button>'
    + '</div>'
    + '<div id="enroll-result" style="margin-top:8px"></div>'
    + '</div>'

    // Export
    + '<div>'
    + '<label class="form-label">Export</label>'
    + '<div style="display:flex;gap:8px;margin-top:4px">'
    + '<button class="btn" onclick="exportAssetCSV()">Export All Assets (CSV)</button>'
    + '<button class="btn" onclick="window.print()">Print Asset Register (PDF)</button>'
    + '</div></div>'

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

// ─── Device Enrollment ───────────────────────

function buildEnrollScript() {
  var script = '# WSC Assets — Hardware Collector\n'
    + '# Paste into PowerShell. Collects device info and copies JSON to clipboard.\n\n'
    + '$cs   = Get-CimInstance Win32_ComputerSystem\n'
    + '$bios = Get-CimInstance Win32_BIOS\n'
    + '$os   = Get-CimInstance Win32_OperatingSystem\n'
    + '$cpu  = Get-CimInstance Win32_Processor | Select-Object -First 1\n'
    + '$disk = Get-CimInstance Win32_DiskDrive | Where-Object { $_.MediaType -like "*fixed*" } | Select-Object -First 1\n\n'
    + '$chassis = (Get-CimInstance Win32_SystemEnclosure).ChassisTypes\n'
    + '$laptopTypes = @(8, 9, 10, 11, 14, 30, 31, 32)\n'
    + '$isLaptop = ($chassis | Where-Object { $_ -in $laptopTypes }).Count -gt 0\n\n'
    + '$ramGB = [math]::Round($cs.TotalPhysicalMemory / 1GB)\n'
    + '$diskGB = if ($disk) { [math]::Round($disk.Size / 1GB) } else { 0 }\n\n'
    + '$adapter = Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -and $_.MACAddress } | Select-Object -First 1\n'
    + '$mac = if ($adapter) { $adapter.MACAddress } else { "N/A" }\n'
    + '$ip  = if ($adapter.IPAddress) { ($adapter.IPAddress | Where-Object { $_ -match "^\\d+\\.\\d+\\.\\d+\\.\\d+$" } | Select-Object -First 1) } else { "N/A" }\n\n'
    + '$assetName = if ($cs.Model -match "^$([regex]::Escape($cs.Manufacturer))") { $cs.Model } else { "$($cs.Manufacturer) $($cs.Model)" }\n'
    + '$assetName = $assetName -replace "System manufacturer", "" -replace "System Product Name", "" -replace "^\\s+|\\s+$", ""\n'
    + 'if ([string]::IsNullOrWhiteSpace($assetName)) { $assetName = $cs.Name }\n\n'
    + '$data = @{\n'
    + '    name          = $assetName\n'
    + '    serial_number = $bios.SerialNumber\n'
    + '    category_id   = if ($isLaptop) { "cat_laptop" } else { "cat_desktop" }\n'
    + '    manufacturer  = $cs.Manufacturer -replace "System manufacturer", "Unknown"\n'
    + '    model         = $cs.Model -replace "System Product Name", "Unknown"\n'
    + '    status        = "available"\n'
    + '    notes         = (@(\n'
    + '        "Auto-enrolled via PowerShell",\n'
    + '        "Computer: $($cs.Name)",\n'
    + '        "OS: $($os.Caption) $($os.Version)",\n'
    + '        "CPU: $($cpu.Name)",\n'
    + '        "RAM: ${ramGB} GB",\n'
    + '        "Disk: ${diskGB} GB",\n'
    + '        "MAC: $mac",\n'
    + '        "IP: $ip",\n'
    + '        "User: $($cs.UserName)",\n'
    + '        "Collected: $(Get-Date -Format \'yyyy-MM-dd HH:mm:ss\')"\n'
    + '    ) -join "`n")\n'
    + '} | ConvertTo-Json\n\n'
    + '$data | Set-Clipboard\n\n'
    + 'Write-Host "" -ForegroundColor Yellow\n'
    + 'Write-Host "=== $assetName ===" -ForegroundColor Yellow\n'
    + 'Write-Host "  Serial:  $($bios.SerialNumber)"\n'
    + 'Write-Host "  Type:    $(if ($isLaptop) {\'Laptop\'} else {\'Desktop\'})"\n'
    + 'Write-Host "  CPU:     $($cpu.Name)"\n'
    + 'Write-Host "  RAM:     ${ramGB} GB | Disk: ${diskGB} GB"\n'
    + 'Write-Host "  MAC:     $mac | IP: $ip"\n'
    + 'Write-Host "  User:    $($cs.UserName)"\n'
    + 'Write-Host "=========================" -ForegroundColor Yellow\n'
    + 'Write-Host ""\n'
    + 'Write-Host "JSON copied to clipboard!" -ForegroundColor Green\n'
    + 'Write-Host "Paste it into WSC Assets > Settings > Device Enrollment" -ForegroundColor Green\n'
    + 'Write-Host ""\n'
    + 'Write-Host "Press any key to exit..."; $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")\n';

  return script.replace(/\\n/g, '\r\n');
}

function copyEnrollScript() {
  navigator.clipboard.writeText(buildEnrollScript()).then(function() {
    toast('Script copied! Paste into PowerShell on the target PC', 'success');
  }, function() {
    toast('Copy failed — check browser clipboard permissions', 'error');
  });
}
window.copyEnrollScript = copyEnrollScript;

async function enrollFromClipboard() {
  var jsonText = document.getElementById('enroll-json').value.trim();
  if (!jsonText) { toast('Paste the JSON from the PowerShell script first', 'error'); return; }
  if (!API.baseUrl || !API.apiKey) { toast('Configure API settings first', 'error'); return; }

  var resultEl = document.getElementById('enroll-result');
  var data;
  try {
    data = JSON.parse(jsonText);
  } catch(e) {
    toast('Invalid JSON — make sure you copied the full output', 'error');
    return;
  }

  if (!data.name || !data.serial_number) {
    toast('JSON is missing required fields (name, serial_number)', 'error');
    return;
  }

  resultEl.innerHTML = '<div style="padding:8px;color:var(--text3);font-size:13px">Checking for duplicates...</div>';

  // Check if serial already exists
  try {
    var existing = await API.fetch('/api/assets/serial/' + encodeURIComponent(data.serial_number));
    resultEl.innerHTML = '<div style="padding:12px;background:var(--amber-l, #fef3c7);border-radius:var(--radius-sm);font-size:13px">'
      + 'This device is already registered as <strong>' + esc(existing.asset_tag) + '</strong> (' + esc(existing.name) + ')</div>';
    return;
  } catch(e) {
    // 404 = not found, which is what we want
  }

  resultEl.innerHTML = '<div style="padding:8px;color:var(--text3);font-size:13px">Registering asset...</div>';

  try {
    var result = await API.createAsset(data);
    resultEl.innerHTML = '<div style="padding:12px;background:var(--green-l, #dcfce7);border-radius:var(--radius-sm);font-size:13px">'
      + '<strong style="color:var(--green)">Enrolled!</strong> Asset Tag: <strong>' + esc(result.asset_tag) + '</strong>'
      + ' <a href="#/assets/' + result.id + '" style="margin-left:8px">View Asset</a></div>';
    document.getElementById('enroll-json').value = '';
    toast('Device enrolled as ' + result.asset_tag, 'success');
  } catch(e) {
    resultEl.innerHTML = '<div style="padding:12px;background:var(--red-l, #fee2e2);border-radius:var(--radius-sm);font-size:13px;color:var(--red)">Failed: ' + esc(e.message) + '</div>';
  }
}
window.enrollFromClipboard = enrollFromClipboard;
window.downloadEnrollScript = downloadEnrollScript;
