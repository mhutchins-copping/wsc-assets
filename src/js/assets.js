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
var _locations = null;
var _people = null;
var _manufacturers = [];
var _models = [];
var _suppliers = [];

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
    _manufacturers = []; _models = []; _suppliers = [];
    var mfSet = {}, mdSet = {}, spSet = {};
    (result.data || []).forEach(function(a) {
      if (a.manufacturer && !mfSet[a.manufacturer]) { _manufacturers.push(a.manufacturer); mfSet[a.manufacturer] = 1; }
      if (a.model && !mdSet[a.model]) { _models.push(a.model); mdSet[a.model] = 1; }
      if (a.supplier && !spSet[a.supplier]) { _suppliers.push(a.supplier); spSet[a.supplier] = 1; }
    });

    var columns = [
      { key: 'asset_tag', label: 'Tag', sortable: true, mono: true },
      { key: 'name', label: 'Name', sortable: true },
      { key: 'category_name', label: 'Category', sortable: true },
      { key: 'status', label: 'Status', render: function(r) { return statusBadge(r.status); } },
      { key: 'assigned_to_name', label: 'Assigned To', sortable: true },
      { key: 'location_name', label: 'Location', sortable: true },
      { key: 'warranty_expiry', label: 'Warranty', render: function(r) {
        if (!r.warranty_expiry) return '<span style="color:var(--text3)">—</span>';
        var days = Math.ceil((new Date(r.warranty_expiry) - new Date()) / 86400000);
        var color = days < 0 ? 'var(--red)' : days < 30 ? 'var(--amber)' : 'var(--text3)';
        return '<span style="font-family:var(--mono);font-size:12px;color:' + color + '">' + fmtDate(r.warranty_expiry) + '</span>';
      }}
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

    var warrantyHtml = '—';
    if (asset.warranty_expiry) {
      var days = Math.ceil((new Date(asset.warranty_expiry) - new Date()) / 86400000);
      var wColor = days < 0 ? 'var(--red)' : days < 30 ? 'var(--amber)' : days < 90 ? 'var(--amber)' : 'var(--green)';
      warrantyHtml = fmtDate(asset.warranty_expiry) + ' <span style="color:' + wColor + ';font-weight:600">(' + (days < 0 ? 'Expired' : days + 'd remaining') + ')</span>';
    }

    var html = '<div style="margin-bottom:16px"><button class="btn sm" onclick="navigate(\'#/assets\')">&larr; Back to Assets</button></div>';

    html += '<div class="detail-header">'
      + '<div class="detail-header-info">'
      + '<div class="detail-header-tag">' + esc(asset.asset_tag) + '</div>'
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
      + '<button class="btn sm" onclick="printAssetLabel(\'' + esc(asset.id) + '\')">Print Label</button>'
      + '<button class="btn danger sm" onclick="retireAsset(\'' + esc(asset.id) + '\')">Retire</button>'
      + '</div></div>';

    // Info grid
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">'
      + '<div class="card"><div class="card-body"><div class="detail-grid">'
      + detailField('Serial Number', asset.serial_number)
      + detailField('Category', asset.category_name)
      + detailField('Manufacturer', asset.manufacturer)
      + detailField('Model', asset.model)
      + detailField('Purchase Date', fmtDate(asset.purchase_date))
      + detailField('Purchase Cost', fmtCurrency(asset.purchase_cost))
      + detailField('PO Number', asset.purchase_order)
      + detailField('Supplier', asset.supplier)
      + detailField('Warranty', warrantyHtml, true)
      + detailField('Location', asset.location_name)
      + '</div></div></div>';

    // Right column: assignment + QR
    html += '<div>';

    // Assignment card
    html += '<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">Assignment</span></div><div class="card-body">';
    if (asset.assigned_to) {
      html += '<div style="font-size:15px;font-weight:600;margin-bottom:4px">' + esc(asset.assigned_to_name || '—') + '</div>'
        + '<div style="font-size:12px;font-family:var(--mono);color:var(--text3)">'
        + esc(asset.assigned_to_department || '') + (asset.assigned_to_email ? ' &middot; ' + esc(asset.assigned_to_email) : '')
        + '</div>'
        + '<div style="font-size:11px;font-family:var(--mono);color:var(--text3);margin-top:4px">Since ' + fmtDate(asset.assigned_date) + '</div>';
    } else {
      html += '<div style="color:var(--text3);font-family:var(--mono);font-size:13px">Not assigned</div>';
    }
    html += '</div></div>';

    // QR Code card
    html += '<div class="card"><div class="card-header"><span class="card-title">QR Code</span></div>'
      + '<div class="card-body" style="text-align:center">'
      + '<div id="asset-qr-code"></div>'
      + '<div style="font-size:11px;font-family:var(--mono);color:var(--text3);margin-top:8px">' + esc(asset.asset_tag) + '</div>'
      + '</div></div>';

    html += '</div></div>';

    // Notes
    if (asset.notes) {
      html += '<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">Notes</span></div>'
        + '<div class="card-body"><div style="font-size:13px;white-space:pre-wrap">' + esc(asset.notes) + '</div></div></div>';
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
    + '<input type="text" id="maint-by" class="form-input" value="Matt" placeholder="Who did the work"></div>'
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
      performed_by: document.getElementById('maint-by').value.trim() || 'Matt',
      next_due: document.getElementById('maint-next').value || null
    });
    closeModal();
    toast('Maintenance recorded', 'success');
    renderAssetDetail(assetId);
  } catch(e) { /* toasted */ }
}
window.saveMaintenance = saveMaintenance;

async function retireAsset(assetId) {
  var ok = await confirmDialog('Are you sure you want to retire this asset?', 'Retire');
  if (!ok) return;
  try {
    await API.deleteAsset(assetId);
    toast('Asset retired', 'success');
    navigate('#/assets');
  } catch(e) { /* toasted */ }
}
window.retireAsset = retireAsset;

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

  // PO + Supplier
  html += '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Purchase Order #</label>'
    + '<input type="text" id="af-po" class="form-input" value="' + esc(asset ? asset.purchase_order : '') + '" placeholder="Authority PO number"></div>'
    + '<div class="form-group"><label class="form-label">Supplier</label>'
    + '<input type="text" id="af-supplier" class="form-input" list="dl-sup" value="' + esc(asset ? asset.supplier : '') + '" placeholder="e.g. Scorptec">'
    + datalist('dl-sup', _suppliers) + '</div></div>';

  // Warranty
  html += '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Warranty (months)</label>'
    + '<input type="number" id="af-warranty" class="form-input" value="' + (asset && asset.warranty_months ? asset.warranty_months : '') + '" placeholder="36" oninput="calcWarrantyExpiry()">'
    + '</div>'
    + '<div class="form-group"><label class="form-label">Warranty Expiry</label>'
    + '<input type="date" id="af-wexpiry" class="form-input" value="' + esc(asset ? asset.warranty_expiry || '' : '') + '" readonly>'
    + '<div class="form-hint">Auto-calculated from purchase date + months</div></div></div>';

  // Location + Assign to
  html += '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Location</label>'
    + '<select id="af-location" class="form-select"><option value="">Select location...</option>';
  (_locations || []).forEach(function(l) {
    var sel = asset && asset.location_id === l.id ? ' selected' : '';
    html += '<option value="' + esc(l.id) + '"' + sel + '>' + esc(l.name) + '</option>';
  });
  html += '</select></div>'
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

  // Image
  html += '<div class="form-group"><label class="form-label">Photo</label>'
    + '<input type="file" id="af-image" class="form-input" accept="image/*" style="padding:8px">'
    + (asset && asset.image_url ? '<div style="margin-top:8px"><img src="' + esc(asset.image_url) + '" style="max-width:200px;border-radius:8px"></div>' : '')
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
      _locations ? Promise.resolve({ data: _locations }) : API.getLocations(),
      _people ? Promise.resolve({ data: _people }) : API.getPeople()
    ]);
    _categories = results[0].data;
    _locations = results[1].data;
    _people = results[2].data;
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

function calcWarrantyExpiry() {
  var pdate = document.getElementById('af-pdate').value;
  var months = parseInt(document.getElementById('af-warranty').value);
  var expiryInput = document.getElementById('af-wexpiry');
  if (pdate && months) {
    var d = new Date(pdate);
    d.setMonth(d.getMonth() + months);
    expiryInput.value = d.toISOString().slice(0, 10);
  }
}
window.calcWarrantyExpiry = calcWarrantyExpiry;

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
    purchase_order: document.getElementById('af-po').value.trim() || null,
    supplier: document.getElementById('af-supplier').value.trim() || null,
    warranty_months: parseInt(document.getElementById('af-warranty').value) || null,
    warranty_expiry: document.getElementById('af-wexpiry').value || null,
    location_id: document.getElementById('af-location').value || null,
    assigned_to: document.getElementById('af-assign').value || null,
    notes: document.getElementById('af-notes').value.trim() || null
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
