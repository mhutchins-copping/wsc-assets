// ─── Assets View (Steps 3, 4, 5) ──────────────

var assetState = {
  page: 1,
  search: '',
  status: '',
  category: '',
  sort: 'a.updated_at',
  dir: 'desc'
};

// Cache for dropdowns
var _categories = null;
var _people = null;
var _manufacturers = [];
var _models = [];

Router.register('/assets', function(param) {
  if (param === 'new') {
    renderAssetForm();
    return;
  }
  if (param && param.indexOf('edit/') === 0) {
    renderAssetForm(param.replace('edit/', ''));
    return;
  }
  if (param) {
    renderAssetDetail(param);
    return;
  }

  var urlParams = new URLSearchParams(location.hash.split('?')[1] || '');
  if (urlParams.get('search')) assetState.search = urlParams.get('search');

  renderAssetList();
});

// ─── Step 3: Asset List ────────────────────────

function renderAssetList() {
  var el = document.getElementById('view-assets');
  el.innerHTML = '<div class="toolbar">'
    + '<div class="toolbar-left">'
    + '<div class="toolbar-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
    + '<input type="text" placeholder="Search assets..." value="' + esc(assetState.search) + '" oninput="assetSearchDebounced(this.value)"></div>'
    + '</div>'
    + '<div class="toolbar-right">'
    + '<button class="btn sm" onclick="exportAssetCSV()">Export CSV</button>'
    + '<button class="btn primary sm" onclick="navigate(\'#/assets/new\')">+ New Asset</button>'
    + '</div></div>'
    + '<div id="asset-filters"></div>'
    + '<div id="asset-table">' + skeleton(8) + '</div>'
    + '<div id="asset-pagination"></div>';

  renderAssetFilters();
  loadAssets();
}

function renderAssetFilters() {
  var filters = [
    { value: '', label: 'All' },
    { value: 'available', label: 'Available' },
    { value: 'deployed', label: 'Deployed' },
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'retired', label: 'Retired' },
    { value: 'lost', label: 'Lost' }
  ];
  document.getElementById('asset-filters').innerHTML = renderFilters({
    filters: filters,
    active: assetState.status,
    onClick: 'filterAssetStatus'
  });
}

function filterAssetStatus(status) {
  assetState.status = status;
  assetState.page = 1;
  loadAssets();
  renderAssetFilters();
}
window.filterAssetStatus = filterAssetStatus;

var assetSearchDebounced = debounce(function(val) {
  assetState.search = val;
  assetState.page = 1;
  loadAssets();
}, 200);
window.assetSearchDebounced = assetSearchDebounced;

function assetSort(key) {
  if (assetState.sort === key) {
    assetState.dir = assetState.dir === 'asc' ? 'desc' : 'asc';
  } else {
    assetState.sort = key;
    assetState.dir = 'asc';
  }
  loadAssets();
}
window.assetSort = assetSort;

function assetPage(p) {
  assetState.page = p;
  loadAssets();
}
window.assetPage = assetPage;

async function loadAssets() {
  var tableEl = document.getElementById('asset-table');
  if (!API.baseUrl) {
    tableEl.innerHTML = '<div class="view-placeholder">'
      + '<div class="view-placeholder-icon">&#128203;</div>'
      + '<div class="view-placeholder-title">Asset Register</div>'
      + '<div class="view-placeholder-sub">Configure your API endpoint in Settings to load assets</div></div>';
    return;
  }

  try {
    var params = { page: assetState.page, sort: assetState.sort, dir: assetState.dir };
    if (assetState.search) params.search = assetState.search;
    if (assetState.status) params.status = assetState.status;
    if (assetState.category) params.category = assetState.category;

    var result = await API.getAssets(params);

    // Collect autocomplete values
    _manufacturers = []; _models = [];
    var mfSet = {}, mdSet = {};
    (result.data || []).forEach(function(a) {
      if (a.manufacturer && !mfSet[a.manufacturer]) { _manufacturers.push(a.manufacturer); mfSet[a.manufacturer] = 1; }
      if (a.model && !mdSet[a.model]) { _models.push(a.model); mdSet[a.model] = 1; }
    });

    var columns = [
      { key: 'asset_tag', label: 'Tag', sortable: true, mono: true },
      { key: 'name', label: 'Name', sortable: true },
      { key: 'serial_number', label: 'Serial', mono: true },
      { key: 'category_name', label: 'Category', sortable: true },
      { key: 'manufacturer', label: 'Manufacturer' },
      { key: 'status', label: 'Status', render: function(r) { return statusBadge(r.status); } },
      { key: 'assigned_to_name', label: 'Assigned To', sortable: true },
      { key: 'updated_at', label: 'Updated', sortable: true, render: function(r) { return '<span style="font-family:var(--mono);font-size:11px;color:var(--text3)">' + fmtDate(r.updated_at) + '</span>'; } }
    ];

    tableEl.innerHTML = renderTable({
      columns: columns,
      data: result.data,
      sortKey: assetState.sort,
      sortDir: assetState.dir,
      onSort: 'assetSort',
      onRowClick: 'viewAsset',
      emptyMsg: 'No assets found'
    });

    document.getElementById('asset-pagination').innerHTML = renderPagination({
      page: result.page,
      pages: result.pages,
      total: result.total,
      onPage: 'assetPage'
    });
  } catch(e) {
    tableEl.innerHTML = '<div class="table-empty">Failed to load assets</div>';
  }
}

function viewAsset(id) { navigate('#/assets/' + id); }
window.viewAsset = viewAsset;

async function exportAssetCSV() {
  if (!API.baseUrl) { toast('Configure API first', 'error'); return; }
  try {
    var res = await API.exportCSV();
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'wsc-assets-export.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exported', 'success');
  } catch(e) { /* already toasted */ }
}
window.exportAssetCSV = exportAssetCSV;

// ─── Step 5: Asset Detail ──────────────────────

async function renderAssetDetail(id) {
  var el = document.getElementById('view-asset-detail');
  el.innerHTML = skeleton(10);

  if (!API.baseUrl) {
    el.innerHTML = '<div class="view-placeholder"><div class="view-placeholder-sub">Configure API in Settings</div></div>';
    return;
  }

  try {
    var asset = await API.getAsset(id);

    var html = '<div style="margin-bottom:12px"><button class="btn sm" onclick="navigate(\'#/assets\')">&larr; Back</button></div>';

    html += '<div class="detail-header">'
      + '<div class="detail-header-info">'
      + '<div class="detail-header-tag">' + esc(asset.asset_tag)
      + (asset.serial_number ? ' &middot; S/N: ' + esc(asset.serial_number) : '') + '</div>'
      + '<div class="detail-header-name">' + esc(asset.name) + ' ' + statusBadge(asset.status) + '</div>'
      + '</div>'
      + '<div class="detail-header-actions">';

    if (asset.status === 'available') {
      html += '<button class="btn primary sm" onclick="openCheckout(\'' + esc(asset.id) + '\')">Check Out</button>';
    }
    if (asset.status === 'deployed') {
      html += '<button class="btn sm" onclick="openCheckin(\'' + esc(asset.id) + '\')">Check In</button>';
    }
    html += '<button class="btn sm" onclick="navigate(\'#/assets/edit/' + esc(asset.id) + '\')">Edit</button>'
      + '<button class="btn sm" onclick="openMaintenanceForm(\'' + esc(asset.id) + '\')">+ Maintenance</button>'
      + '<button class="btn sm" onclick="printAssetLabel(\'' + esc(asset.id) + '\')">Print</button>'
      + '<button class="btn danger sm" onclick="permanentDeleteAsset(\'' + esc(asset.id) + '\')">Delete</button>'
      + '</div></div>';

    // Info grid: 2-column layout (details/photo on left, assignment/qr on right)
    html += '<div class="asset-detail-grid">'
      // Left column
      + '<div class="asset-detail-col">'
      + '<div class="card"><div class="card-header"><span class="card-title">Details</span></div>'
      + '<div class="card-body"><div class="detail-grid" style="grid-template-columns:1fr 1fr 1fr">'
      + detailField('Category', asset.category_name)
      + detailField('Manufacturer', asset.manufacturer)
      + detailField('Model', asset.model)
      + detailField('Purchase Date', fmtDate(asset.purchase_date))
      + detailField('Purchase Cost', fmtCurrency(asset.purchase_cost))
      + detailField('Created', fmtDate(asset.created_at))
      + '</div></div></div>';

    // Photo card goes in the left column so it fills the space next to Assignment + QR
    if (asset.image_url) {
      html += '<div class="card"><div class="card-header"><span class="card-title">Photo</span>'
        + '<button class="btn danger sm" onclick="deleteAssetImage(\'' + esc(asset.id) + '\')">Delete</button></div>'
        + '<div class="card-body asset-photo-body">'
        + '<img class="asset-photo" src="https://api.it-wsc.com' + esc(asset.image_url) + '" alt="Asset photo">'
        + '</div></div>';
    }

    html += '</div>'
      // Right column
      + '<div class="asset-detail-col">'
      + '<div class="card"><div class="card-header"><span class="card-title">Assignment</span></div><div class="card-body">';
    if (asset.assigned_to) {
      html += '<div style="font-size:14px;font-weight:600;margin-bottom:2px">' + esc(asset.assigned_to_name || '—') + '</div>'
        + '<div style="font-size:11px;color:var(--text3)">'
        + esc(asset.assigned_to_department || '') + (asset.assigned_to_email ? ' &middot; ' + esc(asset.assigned_to_email) : '')
        + '</div>'
        + '<div style="font-size:11px;color:var(--text3);margin-top:3px">Since ' + fmtDate(asset.assigned_date) + '</div>';
    } else {
      html += '<div style="color:var(--text3);font-size:12px">Not assigned</div>';
    }
    html += '</div></div>';

    // QR Code card
    html += '<div class="card"><div class="card-header"><span class="card-title">QR Code</span></div>'
      + '<div class="card-body" style="text-align:center;padding:12px">'
      + '<div id="asset-qr-code"></div>'
      + '<div style="font-size:10px;font-family:var(--mono);color:var(--text3);margin-top:6px">' + esc(asset.asset_tag) + '</div>'
      + '</div></div>';

    html += '</div></div>';

    // Hardware Specs (if any spec fields populated)
    var hasSpecs = asset.hostname || asset.os || asset.cpu || asset.ram_gb || asset.disk_gb || asset.mac_address;
    if (hasSpecs) {
      html += '<div class="card" style="margin-bottom:12px"><div class="card-header"><span class="card-title">Hardware Specs</span></div>'
        + '<div class="card-body"><div class="detail-grid" style="grid-template-columns:1fr 1fr 1fr 1fr">'
        + detailField('Hostname', asset.hostname)
        + detailField('Operating System', asset.os)
        + detailField('CPU', asset.cpu)
        + detailField('RAM', asset.ram_gb ? asset.ram_gb + ' GB' : null)
        + detailField('Disk', asset.disk_gb ? asset.disk_gb + ' GB' : null)
        + detailField('MAC Address', asset.mac_address)
        + detailField('IP Address', asset.ip_address)
        + detailField('Enrolled User', asset.enrolled_user)
        + '</div></div></div>';
    }

    // Notes
    if (asset.notes) {
      html += '<div class="card" style="margin-bottom:12px"><div class="card-header"><span class="card-title">Notes</span></div>'
        + '<div class="card-body"><div style="font-size:12px;white-space:pre-wrap;color:var(--text2)">' + esc(asset.notes) + '</div></div></div>';
    }

    // Tabs: History + Maintenance
    html += '<div class="tabs">'
      + '<button class="tab active" onclick="switchAssetTab(this,\'asset-tab-history\')">History</button>'
      + '<button class="tab" onclick="switchAssetTab(this,\'asset-tab-maintenance\')">Maintenance</button>'
      + '</div>';

    // History tab
    html += '<div id="asset-tab-history" class="asset-tab-content">';
    if (asset.history && asset.history.length) {
      html += '<div class="table-wrap"><table><thead><tr>'
        + '<th>Date</th><th>Action</th><th>Details</th><th>Person</th><th>By</th></tr></thead><tbody>';
      asset.history.forEach(function(h) {
        html += '<tr>'
          + '<td class="mono">' + fmtDateTime(h.created_at) + '</td>'
          + '<td>' + statusBadge(h.action) + '</td>'
          + '<td>' + esc(h.details || '—') + '</td>'
          + '<td>' + esc(h.person_name || '—') + '</td>'
          + '<td class="mono">' + esc(h.performed_by || '—') + '</td>'
          + '</tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div class="table-empty">No history yet</div>';
    }
    html += '</div>';

    // Maintenance tab
    html += '<div id="asset-tab-maintenance" class="asset-tab-content" style="display:none">';
    if (asset.maintenance && asset.maintenance.length) {
      html += '<div class="table-wrap"><table><thead><tr>'
        + '<th>Date</th><th>Type</th><th>Description</th><th>Cost</th><th>By</th><th>Next Due</th></tr></thead><tbody>';
      asset.maintenance.forEach(function(m) {
        html += '<tr>'
          + '<td class="mono">' + fmtDate(m.date) + '</td>'
          + '<td>' + esc(m.type) + '</td>'
          + '<td>' + esc(m.description) + '</td>'
          + '<td class="mono">' + fmtCurrency(m.cost) + '</td>'
          + '<td>' + esc(m.performed_by || '—') + '</td>'
          + '<td class="mono">' + fmtDate(m.next_due) + '</td>'
          + '</tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div class="table-empty">No maintenance records</div>';
    }
    html += '</div>';

    el.innerHTML = html;

    // Generate QR code
    generateQRToElement('asset-qr-code', 'https://assets.it-wsc.com/asset/' + asset.asset_tag, 160);

  } catch(e) {
    console.error('Asset detail error:', e);
    el.innerHTML = '<div class="table-empty">Asset not found<br><span style="font-size:11px;color:var(--text3)">' + esc(e.message) + '</span></div>';
  }
}

function detailField(label, value, isHtml) {
  var val = isHtml ? (value || '<span class="empty">—</span>') : esc(value || '—');
  var cls = (!value || value === '—') && !isHtml ? ' empty' : '';
  return '<div><div class="detail-field-label">' + esc(label) + '</div>'
    + '<div class="detail-field-value' + cls + '">' + val + '</div></div>';
}

function switchAssetTab(btn, tabId) {
  document.querySelectorAll('.asset-tab-content').forEach(function(t) { t.style.display = 'none'; });
  document.querySelectorAll('.tabs .tab').forEach(function(t) { t.classList.remove('active'); });
  document.getElementById(tabId).style.display = 'block';
  btn.classList.add('active');
}
window.switchAssetTab = switchAssetTab;

function openMaintenanceForm(assetId) {
  openModal('Add Maintenance Record',
    '<div class="form-group"><label class="form-label">Type</label>'
    + '<select id="maint-type" class="form-select">'
    + '<option value="repair">Repair</option><option value="upgrade">Upgrade</option>'
    + '<option value="cleaning">Cleaning</option><option value="inspection">Inspection</option>'
    + '<option value="replacement">Replacement</option></select></div>'
    + '<div class="form-group"><label class="form-label">Description</label>'
    + '<textarea id="maint-desc" class="form-textarea" placeholder="What was done?"></textarea></div>'
    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Cost ($)</label>'
    + '<input type="number" id="maint-cost" class="form-input" step="0.01" placeholder="0.00"></div>'
    + '<div class="form-group"><label class="form-label">Date</label>'
    + '<input type="date" id="maint-date" class="form-input" value="' + new Date().toISOString().slice(0, 10) + '"></div>'
    + '</div>'
    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Performed By</label>'
    + '<input type="text" id="maint-by" class="form-input" placeholder="Who did the work"></div>'
    + '<div class="form-group"><label class="form-label">Next Due</label>'
    + '<input type="date" id="maint-next" class="form-input"></div>'
    + '</div>'
    + '<button class="btn primary" onclick="saveMaintenance(\'' + esc(assetId) + '\')">Save</button>'
  );
}
window.openMaintenanceForm = openMaintenanceForm;

async function saveMaintenance(assetId) {
  var desc = document.getElementById('maint-desc').value.trim();
  if (!desc) { toast('Description required', 'error'); return; }
  try {
    await API.addMaintenance(assetId, {
      type: document.getElementById('maint-type').value,
      description: desc,
      cost: parseFloat(document.getElementById('maint-cost').value) || null,
      date: document.getElementById('maint-date').value || undefined,
      performed_by: document.getElementById('maint-by').value.trim() || null,
      next_due: document.getElementById('maint-next').value || null
    });
    closeModal();
    toast('Maintenance recorded', 'success');
    renderAssetDetail(assetId);
  } catch(e) { /* toasted */ }
}
window.saveMaintenance = saveMaintenance;

async function permanentDeleteAsset(assetId) {
  var ok = await confirmDialog('Permanently delete this asset? This cannot be undone.', 'Delete Forever');
  if (!ok) return;
  try {
    await API.purgeAsset(assetId);
    toast('Asset permanently deleted', 'success');
    navigate('#/assets');
  } catch(e) { /* toasted */ }
}
window.permanentDeleteAsset = permanentDeleteAsset;

async function deleteAssetImage(assetId) {
  var ok = await confirmDialog('Delete this photo?', 'Delete Photo');
  if (!ok) return;
  try {
    await API.updateAsset(assetId, { image_url: null });
    toast('Photo deleted', 'success');
    renderAssetDetail(assetId);
  } catch(e) { /* toasted */ }
}
window.deleteAssetImage = deleteAssetImage;

function printAssetLabel(assetId) {
  // Open a print-friendly window with QR + info
  var el = document.getElementById('asset-qr-code');
  var tag = document.querySelector('.detail-header-tag');
  var name = document.querySelector('.detail-header-name');
  var w = window.open('', '_blank', 'width=400,height=300');
  w.document.write('<!DOCTYPE html><html><head><title>Asset Label</title>'
    + '<style>body{font-family:sans-serif;padding:20px;text-align:center}'
    + '.tag{font-size:18px;font-weight:700;font-family:monospace;margin:8px 0}'
    + '.name{font-size:12px;color:#666}.org{font-size:10px;color:#999;margin-top:4px}</style></head><body>'
    + (el ? el.innerHTML : '')
    + '<div class="tag">' + (tag ? tag.textContent : '') + '</div>'
    + '<div class="name">' + (name ? name.textContent.replace(/available|deployed|maintenance|retired|lost/gi, '').trim() : '') + '</div>'
    + '<div class="org">Walgett Shire Council IT</div>'
    + '<script>setTimeout(function(){window.print()},300)<\/script>'
    + '</body></html>');
  w.document.close();
}
window.printAssetLabel = printAssetLabel;

// ─── Step 4: Asset Create/Edit Form ────────────

async function renderAssetForm(editId) {
  var el = document.getElementById('view-asset-form');
  el.innerHTML = skeleton(10);

  // Load dropdown data
  await loadFormDropdowns();

  var asset = null;
  if (editId) {
    try {
      asset = await API.getAsset(editId);
      document.getElementById('page-title').textContent = 'Edit Asset';
    } catch(e) {
      el.innerHTML = '<div class="table-empty">Asset not found</div>';
      return;
    }
  } else {
    document.getElementById('page-title').textContent = 'New Asset';
  }

  var html = '<div style="margin-bottom:16px"><button class="btn sm" onclick="history.back()">&larr; Back</button></div>';
  html += '<div class="card"><div class="card-body">';

  // Scan from photo button (only for new assets)
  if (!editId) {
    html += '<div id="scan-section" style="margin-bottom:16px;padding:12px;background:var(--bg2);border-radius:8px;text-align:center">'
      + '<input type="file" id="scan-input" accept="image/*" capture="environment" style="display:none" onchange="handleScanSelect(this)">'
      + '<button class="btn primary" onclick="document.getElementById(\'scan-input\').click()" title="Take a photo of the device label to auto-fill form fields">'
      + '📷 Scan from photo</button>'
      + '<div id="scan-loading" style="display:none;margin-top:8px">'
      + '<div style="color:var(--text2);font-size:13px">Reading label... <span class="spinner"></span></div>'
      + '<img id="scan-preview" style="max-width:200px;max-height:150px;margin-top:8px;border-radius:4px"></div>'
      + '</div>';
  }

  // Extraction banner (populated by scan)
  html += '<div id="extract-banner" style="display:none;margin-bottom:16px;padding:12px;border-radius:8px"></div>';

  // Category + Auto-tag
  html += '<div class="form-row"><div class="form-group"><label class="form-label">Category</label>'
    + '<select id="af-category" class="form-select" onchange="onAssetCategoryChange()">'
    + '<option value="">Select category...</option>';
  (_categories || []).forEach(function(c) {
    if (c.children) {
      c.children.forEach(function(ch) {
        var sel = asset && asset.category_id === ch.id ? ' selected' : '';
        html += '<option value="' + esc(ch.id) + '" data-prefix="' + esc(ch.prefix) + '"' + sel + '>' + esc(c.name) + ' &rarr; ' + esc(ch.name) + '</option>';
      });
    }
  });
  html += '</select></div>'
    + '<div class="form-group"><label class="form-label">Asset Tag</label>'
    + '<input type="text" id="af-tag" class="form-input" value="' + esc(asset ? asset.asset_tag : '') + '" placeholder="Auto-generated">'
    + '<div class="form-hint">Auto-generated from category, or enter custom</div></div></div>';

  // Name
  html += '<div class="form-group"><label class="form-label">Name</label>'
    + '<input type="text" id="af-name" class="form-input" value="' + esc(asset ? asset.name : '') + '" placeholder="e.g. Dell Latitude 5540 — Matt\'s Laptop"></div>';

  // Serial + Status
  html += '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Serial Number</label>'
    + '<input type="text" id="af-serial" class="form-input" value="' + esc(asset ? asset.serial_number : '') + '" placeholder="Serial number"></div>'
    + '<div class="form-group"><label class="form-label">Status</label>'
    + '<select id="af-status" class="form-select">'
    + statusOpts(asset ? asset.status : 'available')
    + '</select></div></div>';

  // Manufacturer + Model
  html += '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Manufacturer</label>'
    + '<input type="text" id="af-manufacturer" class="form-input" list="dl-mfr" value="' + esc(asset ? asset.manufacturer : '') + '" placeholder="e.g. Dell, HP, Lenovo">'
    + datalist('dl-mfr', _manufacturers) + '</div>'
    + '<div class="form-group"><label class="form-label">Model</label>'
    + '<input type="text" id="af-model" class="form-input" list="dl-mdl" value="' + esc(asset ? asset.model : '') + '" placeholder="e.g. Latitude 5540">'
    + datalist('dl-mdl', _models) + '</div></div>';

  // Purchase date + cost
  html += '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Purchase Date</label>'
    + '<input type="date" id="af-pdate" class="form-input" value="' + esc(asset ? asset.purchase_date || '' : '') + '"></div>'
    + '<div class="form-group"><label class="form-label">Purchase Cost ($)</label>'
    + '<input type="number" id="af-pcost" class="form-input" step="0.01" value="' + (asset && asset.purchase_cost ? asset.purchase_cost : '') + '" placeholder="0.00"></div></div>';

  // Assign to
  html += '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Assign To</label>'
    + '<select id="af-assign" class="form-select"><option value="">Not assigned</option>';
  (_people || []).forEach(function(p) {
    var sel = asset && asset.assigned_to === p.id ? ' selected' : '';
    html += '<option value="' + esc(p.id) + '"' + sel + '>' + esc(p.name) + (p.department ? ' (' + esc(p.department) + ')' : '') + '</option>';
  });
  html += '</select><div class="form-hint">Setting this will change status to Deployed</div></div></div>';

  // Notes
  html += '<div class="form-group"><label class="form-label">Notes</label>'
    + '<textarea id="af-notes" class="form-textarea" placeholder="Optional notes">' + esc(asset ? asset.notes || '' : '') + '</textarea></div>';

  // Hardware Specs (collapsible)
  var hasSpecs = asset && (asset.hostname || asset.os || asset.cpu || asset.ram_gb || asset.disk_gb || asset.mac_address);
  html += '<details' + (hasSpecs ? ' open' : '') + ' style="margin-bottom:16px">'
    + '<summary style="cursor:pointer;font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text2);margin-bottom:12px">Hardware Specs</summary>'
    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Hostname</label>'
    + '<input type="text" id="af-hostname" class="form-input" value="' + esc(asset ? asset.hostname : '') + '" placeholder="e.g. WALG-PC138"></div>'
    + '<div class="form-group"><label class="form-label">Operating System</label>'
    + '<input type="text" id="af-os" class="form-input" value="' + esc(asset ? asset.os : '') + '" placeholder="e.g. Windows 11 Business"></div></div>'
    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">CPU</label>'
    + '<input type="text" id="af-cpu" class="form-input" value="' + esc(asset ? asset.cpu : '') + '" placeholder="e.g. Intel Core Ultra 7 155U"></div>'
    + '<div class="form-group"><label class="form-label">RAM (GB)</label>'
    + '<input type="number" id="af-ram" class="form-input" value="' + (asset && asset.ram_gb ? asset.ram_gb : '') + '" placeholder="16"></div></div>'
    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Disk (GB)</label>'
    + '<input type="number" id="af-disk" class="form-input" value="' + (asset && asset.disk_gb ? asset.disk_gb : '') + '" placeholder="512"></div>'
    + '<div class="form-group"><label class="form-label">MAC Address</label>'
    + '<input type="text" id="af-mac" class="form-input" value="' + esc(asset ? asset.mac_address : '') + '" placeholder="00:24:9B:81:75:52"></div></div>'
    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">IP Address</label>'
    + '<input type="text" id="af-ip" class="form-input" value="' + esc(asset ? asset.ip_address : '') + '" placeholder="192.168.1.100"></div>'
    + '<div class="form-group"><label class="form-label">Enrolled User</label>'
    + '<input type="text" id="af-enrolled-user" class="form-input" value="' + esc(asset ? asset.enrolled_user : '') + '" placeholder="DOMAIN\\username"></div></div>'
    + '</details>';

  // Image
  html += '<div class="form-group"><label class="form-label">Photo</label>'
    + '<input type="file" id="af-image" class="form-input" accept="image/*" style="padding:8px">'
    + (asset && asset.image_url ? '<div style="margin-top:8px"><img src="https://api.it-wsc.com' + esc(asset.image_url) + '" style="max-width:200px;border-radius:8px"></div>' : '')
    + '</div>';

  // Buttons
  html += '<div style="display:flex;gap:8px;margin-top:20px">'
    + '<button class="btn primary" onclick="saveAsset(\'' + (editId || '') + '\')">' + (editId ? 'Update Asset' : 'Create Asset') + '</button>'
    + '<button class="btn" onclick="history.back()">Cancel</button>'
    + '</div>';

  html += '</div></div>';
  el.innerHTML = html;

  // Trigger auto-tag if new
  if (!editId) onAssetCategoryChange();
}
window.renderAssetForm = renderAssetForm;

function statusOpts(current) {
  var statuses = ['available', 'deployed', 'maintenance', 'retired', 'lost'];
  return statuses.map(function(s) {
    return '<option value="' + s + '"' + (s === current ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
  }).join('');
}

function datalist(id, items) {
  return '<datalist id="' + id + '">' + (items || []).map(function(v) {
    return '<option value="' + esc(v) + '">';
  }).join('') + '</datalist>';
}

async function loadFormDropdowns() {
  if (!API.baseUrl) return;
  try {
    var results = await Promise.all([
      _categories ? Promise.resolve({ data: _categories }) : API.getCategories(),
      _people ? Promise.resolve({ data: _people }) : API.getPeople()
    ]);
    _categories = results[0].data;
    _people = results[1].data;
  } catch(e) { /* proceed with empty */ }
}

async function onAssetCategoryChange() {
  var sel = document.getElementById('af-category');
  var tagInput = document.getElementById('af-tag');
  if (!sel || !tagInput) return;
  var opt = sel.selectedOptions[0];
  if (!opt || !opt.value) return;
  var prefix = opt.dataset.prefix;
  if (prefix && API.baseUrl && !tagInput.value) {
    try {
      var result = await API.getNextTag(prefix);
      tagInput.value = result.tag;
    } catch(e) { /* keep empty */ }
  }
}
window.onAssetCategoryChange = onAssetCategoryChange;


async function saveAsset(editId) {
  var name = document.getElementById('af-name').value.trim();
  if (!name) { toast('Name is required', 'error'); return; }

  var data = {
    asset_tag: document.getElementById('af-tag').value.trim() || undefined,
    name: name,
    serial_number: document.getElementById('af-serial').value.trim() || null,
    category_id: document.getElementById('af-category').value || null,
    manufacturer: document.getElementById('af-manufacturer').value.trim() || null,
    model: document.getElementById('af-model').value.trim() || null,
    status: document.getElementById('af-status').value,
    purchase_date: document.getElementById('af-pdate').value || null,
    purchase_cost: parseFloat(document.getElementById('af-pcost').value) || null,
    assigned_to: document.getElementById('af-assign').value || null,
    notes: document.getElementById('af-notes').value.trim() || null,
    hostname: document.getElementById('af-hostname').value.trim() || null,
    os: document.getElementById('af-os').value.trim() || null,
    cpu: document.getElementById('af-cpu').value.trim() || null,
    ram_gb: parseInt(document.getElementById('af-ram').value) || null,
    disk_gb: parseInt(document.getElementById('af-disk').value) || null,
    mac_address: document.getElementById('af-mac').value.trim() || null,
    ip_address: document.getElementById('af-ip').value.trim() || null,
    enrolled_user: document.getElementById('af-enrolled-user').value.trim() || null
  };

  // Handle image upload
  var imageFile = document.getElementById('af-image').files[0];

  try {
    var result;
    if (editId) {
      result = await API.updateAsset(editId, data);
      if (imageFile) {
        var imageUrl = await API.uploadImage(editId, imageFile);
        await API.updateAsset(editId, { image_url: imageUrl });
      }
      toast('Asset updated', 'success');
      navigate('#/assets/' + editId);
    } else {
      result = await API.createAsset(data);
      if (imageFile && result.id) {
        var imageUrl2 = await API.uploadImage(result.id, imageFile);
        await API.updateAsset(result.id, { image_url: imageUrl2 });
      }
      toast('Asset created: ' + (result.asset_tag || ''), 'success');
      navigate('#/assets/' + result.id);
    }
  } catch(e) { /* toasted */ }
}
window.saveAsset = saveAsset;

// ─── Scan from Photo ───────────────────────────────

var _scannedImageFile = null;

async function handleScanSelect(input) {
  var file = input.files && input.files[0];
  if (!file) return;

  // Show loading state
  document.getElementById('scan-loading').style.display = 'block';
  var preview = document.getElementById('scan-preview');
  preview.src = URL.createObjectURL(file);

  try {
    // Resize image to max 1600px, encode as JPEG 0.85
    var resized = await resizeImage(file, 1600, 0.85);
    _scannedImageFile = resized;

    // Call API
    var result = await API.extractFromImage(resized);

    // Populate form from result
    populateFromScan(result);

  } catch(e) {
    document.getElementById('scan-loading').style.display = 'none';
    if (e.message && e.message.includes('429')) {
      toast('Scan limit reached. Try again later.', 'error');
    } else if (e.message && e.message.includes('503')) {
      toast('Scan feature not configured', 'error');
    } else {
      toast('Scan failed — enter details manually', 'error');
    }
    console.error('Scan error:', e);
  }
}

async function resizeImage(file, maxPx, quality) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');

      var w = img.width;
      var h = img.height;

      if (w > maxPx || h > maxPx) {
        if (w > h) {
          h = Math.round(h * maxPx / w);
          w = maxPx;
        } else {
          w = Math.round(w * maxPx / h);
          h = maxPx;
        }
      }

      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob(function(blob) {
        // Convert blob to file with proper name
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
      }, 'image/jpeg', quality);
    };
    img.onerror = function() {
      reject(new Error('Failed to load image'));
    };
    img.src = URL.createObjectURL(file);
  });
}

function populateFromScan(result) {
  document.getElementById('scan-loading').style.display = 'none';

  if (!result.extracted) {
    toast('Couldn\'t read the label clearly. Try a closer, better-lit photo.', 'error');
    return;
  }

  var ext = result.extracted;

  // Show confidence banner
  var banner = document.getElementById('extract-banner');
  var confidenceColor = ext.confidence === 'high' ? '#10b981' : (ext.confidence === 'medium' ? '#f59e0b' : '#ef4444');
  var confidenceBg = ext.confidence === 'high' ? '#d1fae5' : (ext.confidence === 'medium' ? '#fef3c7' : '#fee2e2');
  banner.style.display = 'block';
  banner.style.background = confidenceBg;
  banner.style.borderLeft = '4px solid ' + confidenceColor;
  banner.innerHTML = '<div style="font-weight:600;margin-bottom:4px">Extracted from photo (confidence: ' + esc(ext.confidence || 'unknown') + ')</div>'
    + '<div style="font-size:12px">Please confirm before saving. Human review is required.</div>';

  // Populate fields (only if empty to preserve manual edits)
  if (!document.getElementById('af-serial').value && ext.serial_number) {
    document.getElementById('af-serial').value = ext.serial_number.trim();
  }
  if (!document.getElementById('af-manufacturer').value && ext.manufacturer) {
    document.getElementById('af-manufacturer').value = ext.manufacturer;
  }
  if (!document.getElementById('af-model').value && ext.model) {
    document.getElementById('af-model').value = ext.model;
  }
  if (!document.getElementById('af-notes').value && ext.notes) {
    document.getElementById('af-notes').value = ext.notes;
  }

  // Map category_hint to category ID
  if (ext.category_hint && !document.getElementById('af-category').value) {
    var catMap = {
      'laptop': 'L', 'desktop': 'D', 'monitor': 'M', 'printer': 'P',
      'phone': 'PH', 'tablet': 'T', 'switch': 'SW', 'router': 'R',
      'access_point': 'AP', 'server': 'S', 'other': 'O'
    };
    var prefix = catMap[ext.category_hint.toLowerCase()];
    if (prefix && _categories) {
      for (var i = 0; i < _categories.length; i++) {
        var c = _categories[i];
        if (c.children) {
          for (var j = 0; j < c.children.length; j++) {
            var ch = c.children[j];
            if (ch.prefix && ch.prefix.toUpperCase().startsWith(prefix.charAt(0))) {
              document.getElementById('af-category').value = ch.id;
              onAssetCategoryChange();
              break;
            }
          }
        }
      }
    }
  }

  // Show duplicate warning if found
  if (result.duplicate_asset) {
    var dup = result.duplicate_asset;
    var dupWarning = document.createElement('div');
    dupWarning.id = 'duplicate-warning';
    dupWarning.style.cssText = 'margin-top:12px;padding:12px;background:#fee2e2;border-left:4px solid #ef4444;border-radius:4px';
    dupWarning.innerHTML = '<div style="font-weight:600;color:#dc2626;margin-bottom:4px">⚠️ Duplicate detected</div>'
      + '<div style="font-size:13px">An asset with serial <strong>' + esc(ext.serial_number) + '</strong> already exists:</div>'
      + '<div style="font-size:13px;margin-top:4px"><strong>' + esc(dup.asset_tag) + '</strong> — ' + esc(dup.name) + '</div>'
      + '<div style="margin-top:8px">'
      + '<a href="#/assets/' + esc(dup.id) + '" class="btn sm" style="margin-right:8px">View existing</a>'
      + '<button class="btn sm" onclick="document.getElementById(\'duplicate-warning\').remove()">Continue anyway</button>'
      + '</div>';
    banner.parentNode.insertBefore(dupWarning, banner.nextSibling);
  }
}

window.handleScanSelect = handleScanSelect;

// Override saveAsset to include scanned image
var _originalSaveAsset = saveAsset;
saveAsset = async function(editId) {
  // Check if we have a scanned image to upload
  var scannedFile = _scannedImageFile;
  var formImageInput = document.getElementById('af-image');
  var imageFile = formImageInput && formImageInput.files && formImageInput.files[0] || scannedFile;

  // Call original saveAsset logic but handle image separately
  var name = document.getElementById('af-name').value.trim();
  if (!name) { toast('Name is required', 'error'); return; }

  var data = {
    asset_tag: document.getElementById('af-tag').value.trim() || undefined,
    name: name,
    serial_number: document.getElementById('af-serial').value.trim() || null,
    category_id: document.getElementById('af-category').value || null,
    manufacturer: document.getElementById('af-manufacturer').value.trim() || null,
    model: document.getElementById('af-model').value.trim() || null,
    status: document.getElementById('af-status').value,
    purchase_date: document.getElementById('af-pdate').value || null,
    purchase_cost: parseFloat(document.getElementById('af-pcost').value) || null,
    assigned_to: document.getElementById('af-assign').value || null,
    notes: document.getElementById('af-notes').value.trim() || null,
    hostname: document.getElementById('af-hostname').value.trim() || null,
    os: document.getElementById('af-os').value.trim() || null,
    cpu: document.getElementById('af-cpu').value.trim() || null,
    ram_gb: parseInt(document.getElementById('af-ram').value) || null,
    disk_gb: parseInt(document.getElementById('af-disk').value) || null,
    mac_address: document.getElementById('af-mac').value.trim() || null,
    ip_address: document.getElementById('af-ip').value.trim() || null,
    enrolled_user: document.getElementById('af-enrolled-user').value.trim() || null
  };

  try {
    var result;
    if (editId) {
      result = await API.updateAsset(editId, data);
      if (imageFile && imageFile !== scannedFile) {
        try {
          var imageUrl = await API.uploadImage(editId, imageFile);
          await API.updateAsset(editId, { image_url: imageUrl });
        } catch(e) { console.warn('Image upload failed:', e.message); }
      } else if (scannedFile) {
        try {
          var imageUrl2 = await API.uploadImage(editId, scannedFile);
          await API.updateAsset(editId, { image_url: imageUrl2 });
        } catch(e) { console.warn('Image upload failed:', e.message); }
      }
      toast('Asset updated', 'success');
      navigate('#/assets/' + editId);
    } else {
      result = await API.createAsset(data);
      if (imageFile && result.id) {
        try {
          var imageUrl3 = await API.uploadImage(result.id, imageFile);
          await API.updateAsset(result.id, { image_url: imageUrl3 });
        } catch(e) { console.warn('Image upload failed:', e.message); }
      }
      toast('Asset created: ' + (result.asset_tag || ''), 'success');
      navigate('#/assets/' + result.id);
    }
  } catch(e) { /* toasted */ }
};
window.saveAsset = saveAsset;
