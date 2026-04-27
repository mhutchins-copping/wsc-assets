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
var _categoryProfiles = {};
var _assetFormAsset = null;

async function getCategoryProfile(catId) {
  if (!catId) return { show_specs: true, show_phone: false, custom_fields: [] };
  if (_categoryProfiles[catId]) return _categoryProfiles[catId];
  var cats = _categories;
  if (!cats) {
    try {
      var res = await API.getCategories();
      cats = res.data || res.tree || [];
      _categories = cats;
    } catch (e) { cats = []; }
  }
  var profile = null;
  (cats || []).forEach(function(parent) {
    if (parent.children && parent.children.length) {
      parent.children.forEach(function(child) {
        if (child.id === catId) {
          profile = child.field_profile || null;
        }
      });
    } else if (parent.id === catId) {
      profile = parent.field_profile || null;
    }
  });
  profile = profile || { show_specs: true, show_phone: false, custom_fields: [] };
  _categoryProfiles[catId] = profile;
  return profile;
}

// Multi-select for batch label printing. Keyed by asset id; value keeps
// just the fields the label-sheet renderer needs so switching pages or
// tightening filters doesn't invalidate an in-progress selection.
var assetSelection = new Map();
// Minimal current-page snapshot (id/tag/name) so selecting a row doesn't
// require another API round-trip.
var _lastAssetPage = [];

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
    + '<button class="btn sm" onclick="printFilteredLabels()">Print labels</button>'
    + '<button class="btn sm" onclick="exportAssetCSV()">Export CSV</button>'
    + (Auth.isAdmin() ? '<button class="btn primary sm" onclick="navigate(\'#/assets/new\')">+ New Asset</button>' : '')
    + '</div></div>'
    + '<div id="asset-filters"></div>'
    + '<div id="asset-selection-bar" style="display:none"></div>'
    + '<div id="asset-table">' + skeleton(8) + '</div>'
    + '<div id="asset-pagination"></div>';

  renderAssetFilters();
  renderAssetSelectionBar();
  loadAssets();
}

async function renderAssetFilters() {
  var statusFilters = [
    { value: '', label: 'All' },
    { value: 'available', label: 'Available' },
    { value: 'deployed', label: 'Deployed' },
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'retired', label: 'Retired' },
    { value: 'lost', label: 'Lost' }
  ];

  var html = '<div style="display:flex;flex-direction:column;gap:6px">'
    + renderFilters({
        filters: statusFilters,
        active: assetState.status,
        onClick: 'filterAssetStatus'
      });

  // Category chips — one per leaf (child) category so users pick a
  // concrete type (Laptop, Phone, Switch) rather than the parent
  // groupings which aren't actionable on their own.
  if (!_categories) {
    try {
      var catRes = await API.getCategories();
      _categories = catRes.data || catRes.tree || [];
    } catch (e) { _categories = []; }
  }
  var leaves = [];
  (_categories || []).forEach(function(parent) {
    if (parent.children && parent.children.length) {
      parent.children.forEach(function(child) {
        leaves.push({ value: child.id, label: child.name });
      });
    }
  });
  if (leaves.length) {
    var catFilters = [{ value: '', label: 'All types' }].concat(leaves);
    html += renderFilters({
      filters: catFilters,
      active: assetState.category,
      onClick: 'filterAssetCategory'
    });
  }
  html += '</div>';

  document.getElementById('asset-filters').innerHTML = html;
}

function filterAssetStatus(status) {
  assetState.status = status;
  assetState.page = 1;
  loadAssets();
  renderAssetFilters();
}
window.filterAssetStatus = filterAssetStatus;

function filterAssetCategory(categoryId) {
  assetState.category = categoryId;
  assetState.page = 1;
  loadAssets();
  renderAssetFilters();
}
window.filterAssetCategory = filterAssetCategory;

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

    var pageAllSelected = (result.data || []).length > 0
      && (result.data || []).every(function(r) { return assetSelection.has(r.id); });
    var columns = [
      // Selection checkbox. stopPropagation keeps the row-click (navigate to
      // detail) from firing when the user only wants to tick the box.
      { key: '__sel', label: '',
        labelHtml: '<input type="checkbox" ' + (pageAllSelected ? 'checked ' : '') + 'onclick="event.stopPropagation();toggleAssetPageSelection(this.checked)" title="Select all on this page">',
        render: function(r) {
          var checked = assetSelection.has(r.id) ? ' checked' : '';
          return '<input type="checkbox" class="asset-select" data-id="' + esc(r.id) + '"' + checked + ' onclick="event.stopPropagation();toggleAssetSelection(\'' + esc(r.id) + '\')">';
        }
      },
      { key: 'asset_tag', label: 'Tag', sortable: true, mono: true },
      { key: 'name', label: 'Name', sortable: true },
      { key: 'serial_number', label: 'Serial', mono: true },
      { key: 'category_name', label: 'Category', sortable: true },
      { key: 'manufacturer', label: 'Manufacturer' },
      { key: 'status', label: 'Status', render: function(r) { return statusBadge(r.status); } },
      { key: 'assigned_to_name', label: 'Assigned To', sortable: true },
      { key: 'updated_at', label: 'Updated', sortable: true, render: function(r) { return '<span style="font-family:var(--mono);font-size:11px;color:var(--text3)">' + fmtDate(r.updated_at) + '</span>'; } }
    ];
    // Stash the current page so toggleAssetSelection can look up tag/name
    // without a re-fetch. Only the fields the label sheet needs get kept.
    _lastAssetPage = (result.data || []).map(function(r) {
      return { id: r.id, asset_tag: r.asset_tag, name: r.name };
    });

    // Mobile: swap the table for stacked cards. Better thumb-reachable
    // layout; the desktop table becomes horizontal-scroll and tiny at
    // that width, and phone is the primary daily-use surface.
    if (window.matchMedia('(max-width: 768px)').matches) {
      tableEl.innerHTML = renderAssetCards(result.data || []);
    } else {
      tableEl.innerHTML = renderTable({
        columns: columns,
        data: result.data,
        sortKey: assetState.sort,
        sortDir: assetState.dir,
        onSort: 'assetSort',
        onRowClick: 'viewAsset',
        emptyMsg: 'No assets found',
        wrapClass: 'asset-table'
      });
    }

    document.getElementById('asset-pagination').innerHTML = renderPagination({
      page: result.page,
      pages: result.pages,
      total: result.total,
      onPage: 'assetPage'
    });

    renderAssetSelectionBar();
  } catch(e) {
    tableEl.innerHTML = '<div class="table-empty">Failed to load assets</div>';
  }
}

function viewAsset(id) { navigate('#/assets/' + id); }
window.viewAsset = viewAsset;

// Auto-fill retirement date = purchase date + 3 years when the user
// sets or changes a purchase date and the retirement field is empty.
// Respects an explicit value the user typed in retirement.
function autofillRetirement() {
  var pd = document.getElementById('af-purchase-date');
  var rd = document.getElementById('af-retirement-date');
  if (!pd || !rd || !pd.value || rd.value) return;
  var d = new Date(pd.value);
  if (isNaN(d.getTime())) return;
  d.setFullYear(d.getFullYear() + 3);
  rd.value = d.toISOString().slice(0, 10);
}
window.autofillRetirement = autofillRetirement;

// Render a small chip next to a retirement date indicating how far
// away it is. Returns '' if no date. "Retires in 14 months" / "Due
// for replacement" / "Overdue by 4 months".
function retirementBadge(retirementDateStr) {
  if (!retirementDateStr) return '';
  var target = new Date(retirementDateStr);
  if (isNaN(target.getTime())) return '';
  var now = new Date();
  var monthsDiff = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  var tone, label;
  if (monthsDiff < 0) {
    tone = 'red';
    label = 'Overdue by ' + Math.abs(monthsDiff) + ' month' + (Math.abs(monthsDiff) === 1 ? '' : 's');
  } else if (monthsDiff <= 6) {
    tone = 'amber';
    label = monthsDiff === 0 ? 'Due this month' : 'Due in ' + monthsDiff + ' month' + (monthsDiff === 1 ? '' : 's');
  } else if (monthsDiff <= 12) {
    tone = 'amber-l';
    label = 'Due in ' + monthsDiff + ' months';
  } else {
    var years = Math.round(monthsDiff / 12);
    tone = 'green';
    label = 'Retires in ' + years + ' year' + (years === 1 ? '' : 's');
  }
  var colors = {
    red: 'background:var(--red-l);color:var(--red)',
    amber: 'background:var(--amber-l);color:var(--amber)',
    'amber-l': 'background:var(--amber-l);color:var(--amber);opacity:0.85',
    green: 'background:var(--accent-l);color:var(--accent)'
  };
  return '<span style="display:inline-block;' + colors[tone]
    + ';font-size:11px;font-weight:500;padding:2px 8px;border-radius:4px;margin-left:8px">'
    + esc(label) + '</span>';
}
window.retirementBadge = retirementBadge;

// Mobile card layout for the asset list. Each row becomes a self-contained
// card so there's no horizontal scroll and the tap target is larger than a
// table cell. Selection checkbox lives on the top-right; tapping anywhere
// else on the card opens the detail view. Sorting is hidden here -- the
// default (updated_at desc) is what a field walker wants anyway, and full
// sort is available on desktop.
function renderAssetCards(data) {
  if (!data.length) {
    return '<div class="table-empty">No assets found</div>';
  }
  return '<div class="asset-cards">' + data.map(function(r) {
    var checked = assetSelection.has(r.id) ? ' checked' : '';
    var metaParts = [];
    if (r.assigned_to_name) metaParts.push(esc(r.assigned_to_name));
    else if (r.category_name) metaParts.push(esc(r.category_name));
    if (r.manufacturer) metaParts.push(esc(r.manufacturer));
    var meta = metaParts.join(' &middot; ');
    return '<div class="asset-card" onclick="viewAsset(\'' + esc(r.id) + '\')">'
      + '<label class="asset-card-sel" onclick="event.stopPropagation()">'
      +   '<input type="checkbox" class="asset-select" data-id="' + esc(r.id) + '"' + checked
      +   ' onclick="event.stopPropagation();toggleAssetSelection(\'' + esc(r.id) + '\')">'
      + '</label>'
      + '<div class="asset-card-main">'
      +   '<div class="asset-card-top">'
      +     '<span class="asset-card-tag">' + esc(r.asset_tag || '') + '</span>'
      +     statusBadge(r.status)
      +   '</div>'
      +   '<div class="asset-card-name">' + esc(r.name || '') + '</div>'
      +   (meta ? '<div class="asset-card-meta">' + meta + '</div>' : '')
      +   (r.serial_number ? '<div class="asset-card-serial">S/N ' + esc(r.serial_number) + '</div>' : '')
      + '</div>'
      + '</div>';
  }).join('') + '</div>';
}
window.renderAssetCards = renderAssetCards;

// Re-render the list when the viewport crosses the 768px breakpoint.
// Only fires on an actual media-query transition -- harmless when we're
// not on the assets view.
(function () {
  if (!window.matchMedia) return;
  var mq = window.matchMedia('(max-width: 768px)');
  var handler = function () {
    var active = document.querySelector('.view.active');
    if (active && active.id === 'view-assets' && typeof loadAssets === 'function') {
      loadAssets();
    }
  };
  if (mq.addEventListener) mq.addEventListener('change', handler);
  else if (mq.addListener) mq.addListener(handler);
})();

// ─── Multi-select helpers ─────────────────────

function toggleAssetSelection(id) {
  if (assetSelection.has(id)) {
    assetSelection.delete(id);
  } else {
    var rec = _lastAssetPage.find(function(r) { return r.id === id; });
    if (rec) assetSelection.set(id, rec);
  }
  renderAssetSelectionBar();
  // Keep the select-all checkbox in the header in sync.
  var headerBox = document.querySelector('#asset-table thead input[type="checkbox"]');
  if (headerBox) {
    var allSelected = _lastAssetPage.length > 0
      && _lastAssetPage.every(function(r) { return assetSelection.has(r.id); });
    headerBox.checked = allSelected;
  }
}
window.toggleAssetSelection = toggleAssetSelection;

function toggleAssetPageSelection(checked) {
  _lastAssetPage.forEach(function(r) {
    if (checked) assetSelection.set(r.id, r);
    else assetSelection.delete(r.id);
  });
  document.querySelectorAll('#asset-table tbody input.asset-select').forEach(function(cb) {
    cb.checked = checked;
  });
  renderAssetSelectionBar();
}
window.toggleAssetPageSelection = toggleAssetPageSelection;

function clearAssetSelection() {
  assetSelection.clear();
  document.querySelectorAll('#asset-table input[type="checkbox"]').forEach(function(cb) {
    cb.checked = false;
  });
  renderAssetSelectionBar();
}
window.clearAssetSelection = clearAssetSelection;

function renderAssetSelectionBar() {
  var bar = document.getElementById('asset-selection-bar');
  if (!bar) return;
  var n = assetSelection.size;
  if (n === 0) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  bar.style.display = 'flex';
  bar.style.alignItems = 'center';
  bar.style.gap = '10px';
  bar.style.padding = '8px 12px';
  bar.style.background = 'var(--surface2, #f5f5f5)';
  bar.style.border = '1px solid var(--border, #e5e5e5)';
  bar.style.borderRadius = '6px';
  bar.style.margin = '8px 0';
  var html = '<span style="font-size:13px"><strong>' + n + '</strong> selected</span>';
  if (Auth.isAdmin()) {
    html += '<button class="btn primary sm" onclick="openBulkCheckout()">Check out</button>'
      + '<button class="btn sm" onclick="openBulkCheckin()">Check in</button>'
      + '<button class="btn sm" onclick="openBulkStatusChange()">Change status</button>'
      + '<button class="btn danger sm" onclick="bulkDisposeAssets()">Dispose</button>';
  }
  html += '<button class="btn sm" onclick="printSelectedLabels()">Print labels</button>'
    + '<button class="btn sm" onclick="clearAssetSelection()">Clear</button>';
  bar.innerHTML = html;
}
window.renderAssetSelectionBar = renderAssetSelectionBar;

async function printSelectedLabels() {
  if (assetSelection.size === 0) return;
  // Values are already id/tag/name records — no extra fetch needed.
  var assets = Array.from(assetSelection.values());
  await renderLabelSheet(assets);
}
window.printSelectedLabels = printSelectedLabels;

// ─── Bulk Status Change ────────────────────────

function openBulkStatusChange() {
  var ids = Array.from(assetSelection.keys());
  if (!ids.length) return;
  var html = '<div class="form-group"><label class="form-label">New Status</label>'
    + '<select id="bulk-status" class="form-select">'
    + '<option value="available">Available</option>'
    + '<option value="deployed">Deployed</option>'
    + '<option value="maintenance">Maintenance</option>'
    + '<option value="retired">Retired</option>'
    + '<option value="lost">Lost</option>'
    + '</select></div>'
    + '<button class="btn primary full" id="bulk-status-submit" onclick="doBulkStatusChange()">Update ' + ids.length + ' Assets</button>';
  openModal('Change Status', html);
}
window.openBulkStatusChange = openBulkStatusChange;

async function doBulkStatusChange() {
  var ids = Array.from(assetSelection.keys());
  var status = document.getElementById('bulk-status').value;
  var submit = document.getElementById('bulk-status-submit');
  if (submit) { submit.disabled = true; submit.textContent = 'Updating…'; }

  var ok = 0, fail = 0;
  await Promise.all(ids.map(function(id) {
    return API.updateAsset(id, { status: status })
      .then(function() { ok++; })
      .catch(function() { fail++; });
  }));

  closeModal();
  toast('Updated ' + ok + ' asset' + (ok === 1 ? '' : 's') + (fail ? ' · ' + fail + ' failed' : ''), fail ? 'error' : 'success');
  loadAssets();
  clearAssetSelection();
}
window.doBulkStatusChange = doBulkStatusChange;

// ─── Bulk Dispose ──────────────────────────────

async function bulkDisposeAssets() {
  var ids = Array.from(assetSelection.keys());
  if (!ids.length) return;
  var confirmed = await confirmDialog('Dispose ' + ids.length + ' selected asset' + (ids.length === 1 ? '' : 's') + '? This cannot be undone from the list view.', 'Dispose Assets');
  if (!confirmed) return;

  var ok = 0, fail = 0;
  await Promise.all(ids.map(function(id) {
    return API.deleteAsset(id)
      .then(function() { ok++; })
      .catch(function() { fail++; });
  }));

  toast('Disposed ' + ok + ' asset' + (ok === 1 ? '' : 's') + (fail ? ' · ' + fail + ' failed' : ''), fail ? 'error' : 'success');
  loadAssets();
  clearAssetSelection();
}
window.bulkDisposeAssets = bulkDisposeAssets;

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

async function renderAssetDetail(id, preloaded) {
  var el = document.getElementById('view-asset-detail');

  // If caller supplied a fresh asset (e.g. from checkout/checkin response),
  // skip the skeleton flicker and the re-fetch entirely. This avoids a
  // read-after-write race against D1 replicas.
  if (!preloaded) el.innerHTML = skeleton(10);

  if (!API.baseUrl) {
    el.innerHTML = '<div class="view-placeholder"><div class="view-placeholder-sub">Configure API in Settings</div></div>';
    return;
  }

  try {
    var asset;
    if (preloaded && preloaded.id === id) {
      // The checkout/checkin endpoints return the updated row but without
      // history / maintenance. Merge those in from a follow-up fetch so the
      // tabs still work, but the header + details + assignment render
      // immediately from the fresh data.
      asset = preloaded;
      try {
        var full = await API.getAsset(id);
        asset.history = full.history || [];
        asset.maintenance = full.maintenance || [];
      } catch (e) {
        asset.history = asset.history || [];
        asset.maintenance = asset.maintenance || [];
      }
    } else {
      asset = await API.getAsset(id);
    }

    var profile = await getCategoryProfile(asset.category_id);

    var html = '<div style="margin-bottom:12px"><button class="btn sm" onclick="navigate(\'#/assets\')">&larr; Back</button></div>';

    html += '<div class="detail-header">'
      + '<div class="detail-header-info">'
      + '<div class="detail-header-tag">' + esc(asset.asset_tag)
      + (asset.serial_number ? ' &middot; S/N: ' + esc(asset.serial_number) : '') + '</div>'
      + '<div class="detail-header-name">' + esc(asset.name) + ' ' + statusBadge(asset.status) + '</div>'
      + '</div>'
      + '<div class="detail-header-actions">';

    if (Auth.isAdmin()) {
      if (asset.status === 'available') {
        // Loaner-pool assets get their own Loan flow so the operator picks a
        // due date up front; regular assets stick with the permanent-checkout
        // button that doesn't carry a return expectation.
        if (asset.is_loaner) {
          html += '<button class="btn primary sm" onclick="openLoanModal(\'' + esc(asset.id) + '\')">Loan out</button>';
        } else {
          html += '<button class="btn primary sm" onclick="openCheckout(\'' + esc(asset.id) + '\')">Check Out</button>';
        }
      }
      if (asset.status === 'deployed') {
        if (asset.is_loaner) {
          html += '<button class="btn sm" onclick="returnLoanForAsset(\'' + esc(asset.id) + '\')">Return</button>';
        } else {
          html += '<button class="btn sm" onclick="openCheckin(\'' + esc(asset.id) + '\')">Check In</button>';
        }
      }
      html += '<button class="btn sm" onclick="navigate(\'#/assets/edit/' + esc(asset.id) + '\')">Edit</button>'
        + '<button class="btn sm" onclick="openMaintenanceForm(\'' + esc(asset.id) + '\')">+ Maintenance</button>';
    }
    // Print is safe for any role — it's a read operation against the asset.
    html += '<button class="btn sm" onclick="printAssetLabel(\'' + esc(asset.id) + '\')">Print</button>';
    // Flag a problem: owner-or-admin. For non-admins this is the main
    // self-service action — the backend accepts the request because the
    // asset is theirs. Admins keep the button so support staff can raise an internal
    // flag on behalf of a caller who can't sign in.
    html += '<button class="btn sm" onclick="openFlagModal(\'' + esc(asset.id) + '\')">Flag a problem</button>';
    if (Auth.isAdmin()) {
      html += '<button class="btn danger sm" onclick="permanentDeleteAsset(\'' + esc(asset.id) + '\')">Delete</button>';
    }
    html += '</div></div>';

    // Info grid: 2-column layout (details/photo on left, assignment/qr on right)
    // Retirement date value gets a status chip (green / amber / red)
    // reflecting how close it is to end-of-life.
    var retirementValueHtml = asset.retirement_date
      ? esc(fmtDate(asset.retirement_date)) + retirementBadge(asset.retirement_date)
      : null;

    html += '<div class="asset-detail-grid">'
      // Left column
      + '<div class="asset-detail-col">'
      + '<div class="card"><div class="card-header"><span class="card-title">Details</span></div>'
      + '<div class="card-body"><div class="detail-grid" style="grid-template-columns:1fr 1fr">'
      + detailField('Category', asset.category_name)
      + detailField('Manufacturer', asset.manufacturer)
      + detailField('Model', asset.model)
      + detailField('Purchase Date', asset.purchase_date ? fmtDate(asset.purchase_date) : null)
      + detailField('Retirement Date', retirementValueHtml, true)
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

    // Specs — unified PC + phone fields. Render only populated rows so
    // a phone asset doesn't show a grid of PC-specific em-dashes.
    var specRows = [];
    if (profile.show_specs !== false) {
      specRows.push(['Hostname', asset.hostname]);
      specRows.push(['Operating System', asset.os]);
      specRows.push(['CPU', asset.cpu]);
      specRows.push(['RAM', asset.ram_gb ? asset.ram_gb + ' GB' : null]);
      specRows.push(['Disk', asset.disk_gb ? asset.disk_gb + ' GB' : null]);
      specRows.push(['MAC Address', asset.mac_address]);
      specRows.push(['IP Address', asset.ip_address]);
      specRows.push(['Enrolled User', asset.enrolled_user]);
    }
    if (profile.show_phone !== false) {
      specRows.push(['Phone Number', asset.phone_number]);
      specRows.push(['Carrier', asset.carrier]);
    }
    specRows = specRows.filter(function(row) { return row[1]; });

    if (specRows.length) {
      html += '<div class="card" style="margin-bottom:12px"><div class="card-header"><span class="card-title">Specs</span></div>'
        + '<div class="card-body"><div class="detail-grid" style="grid-template-columns:1fr 1fr 1fr 1fr">';
      specRows.forEach(function(row) {
        html += detailField(row[0], row[1]);
      });
      html += '</div></div></div>';
    }

    // Additional Information — custom metadata from category profile
    if (profile.custom_fields && profile.custom_fields.length && asset.metadata) {
      var customRows = [];
      profile.custom_fields.forEach(function(field) {
        if (asset.metadata[field.key] != null) {
          customRows.push([field.label, asset.metadata[field.key]]);
        }
      });
      if (customRows.length) {
        html += '<div class="card" style="margin-bottom:12px"><div class="card-header"><span class="card-title">Additional Information</span></div>'
          + '<div class="card-body"><div class="detail-grid" style="grid-template-columns:1fr 1fr 1fr 1fr">';
        customRows.forEach(function(row) {
          html += detailField(row[0], row[1]);
        });
        html += '</div></div></div>';
      }
    }

    // Notes
    if (asset.notes) {
      html += '<div class="card" style="margin-bottom:12px"><div class="card-header"><span class="card-title">Notes</span></div>'
        + '<div class="card-body"><div style="font-size:12px;white-space:pre-wrap;color:var(--text2)">' + esc(asset.notes) + '</div></div></div>';
    }

    // Tabs: History + Maintenance + Receipts
    html += '<div class="tabs">'
      + '<button class="tab active" onclick="switchAssetTab(this,\'asset-tab-history\')">History</button>'
      + '<button class="tab" onclick="switchAssetTab(this,\'asset-tab-maintenance\')">Maintenance</button>'
      + '<button class="tab" onclick="switchAssetTab(this,\'asset-tab-receipts\')">Receipts</button>'
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

    // Receipts tab — populated async after initial render to avoid holding
    // up the detail view on a secondary fetch. Send-link button is always
    // visible so an admin can re-issue a receipt later (e.g. lost email).
    html += '<div id="asset-tab-receipts" class="asset-tab-content" style="display:none">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'
      + '<div style="font-size:12px;color:var(--text3)">Signed receipts for this asset</div>';
    if (Auth.isAdmin() && asset.assigned_to) {
      html += '<button class="btn primary sm" onclick="sendAssetIssue(\'' + esc(asset.id) + '\',\'' + esc(asset.assigned_to) + '\')">Email signing link to ' + esc(asset.assigned_to_name || 'recipient') + '</button>';
    } else if (Auth.isAdmin()) {
      html += '<span style="font-size:11px;color:var(--text3)">Assign the asset to someone to email them a receipt link.</span>';
    } else {
      html += '<span></span>';
    }
    html += '</div><div id="asset-issues-list">' + skeleton(3) + '</div></div>';

    el.innerHTML = html;

    // Fetch receipts in the background — don't block the main render.
    loadAssetIssues(asset.id);

    // Generate QR code — use the same short scan URL the printed labels use
    // so a scan from the sticker and a scan from the screen behave identically.
    generateQRToElement('asset-qr-code', qrUrlForTag(asset.asset_tag), 160);

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

// ─── Label Printing ───────────────────────────
// Defaults target Avery L7160 (21 labels per A4, 63.5×38.1mm each) so the
// same layout works when the user swaps plain paper for real sticker stock.
// Adjust when switching sheet types.
var LABEL_SHEET = {
  pageMarginTopMm: 15.15,
  pageMarginLeftMm: 7.21,
  cols: 3,
  rows: 7,
  cellWidthMm: 63.5,
  cellHeightMm: 38.1,
  colGapMm: 2.54,
  rowGapMm: 0
};

// Opens a print-ready A4 sheet populated with QR labels for the given assets.
// QR data URLs are generated in the parent window (where the qrcode module is
// already loaded) and inlined into the popup so the popup needs no JS deps.
async function renderLabelSheet(assets) {
  if (!assets || !assets.length) { toast('No assets to print', 'error'); return; }
  var s = LABEL_SHEET;

  var qrs;
  try {
    qrs = await Promise.all(assets.map(function(a) {
      return generateQRDataURL(qrUrlForTag(a.asset_tag), 280);
    }));
  } catch (e) {
    toast('Failed to generate QR codes', 'error');
    return;
  }

  var cells = assets.map(function(a, i) {
    var name = (a.name || '').replace(/\s+/g, ' ').trim();
    return '<div class="lbl">'
      + '<img class="lbl-qr" src="' + qrs[i] + '" alt="">'
      + '<div class="lbl-text">'
      +   '<div class="lbl-tag">' + esc(a.asset_tag || '') + '</div>'
      +   '<div class="lbl-name">' + esc(name) + '</div>'
      +   '<div class="lbl-org">WSC IT</div>'
      + '</div></div>';
  }).join('');

  var w = window.open('', '_blank');
  if (!w) { toast('Popup blocked — allow popups for this site', 'error'); return; }

  var css = ''
    + '@page { size: A4 portrait; margin: 0; }'
    + 'html,body{margin:0;padding:0;background:#fff;color:#111;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}'
    + '.toolbar{position:sticky;top:0;z-index:10;background:#fafafa;border-bottom:1px solid #eee;padding:10px 16px;display:flex;gap:10px;align-items:center;font-size:13px}'
    + '.toolbar button{padding:6px 12px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;font-size:13px}'
    + '.toolbar .count{color:#555}'
    + '.sheet{padding:' + s.pageMarginTopMm + 'mm ' + s.pageMarginLeftMm + 'mm;display:grid;'
    +   'grid-template-columns:repeat(' + s.cols + ',' + s.cellWidthMm + 'mm);'
    +   'grid-auto-rows:' + s.cellHeightMm + 'mm;'
    +   'column-gap:' + s.colGapMm + 'mm;row-gap:' + s.rowGapMm + 'mm}'
    // Cut guides: darkish dashed border that prints cleanly. Applied via the
    // .guides body class so the toolbar toggle can flip it without rerender.
    + '.lbl{display:flex;align-items:center;gap:3mm;padding:2mm;box-sizing:border-box;overflow:hidden;break-inside:avoid;border:1px dashed transparent}'
    + 'body.guides .lbl{border-color:#666;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    + '.lbl-qr{width:28mm;height:28mm;flex-shrink:0;display:block}'
    + '.lbl-text{flex:1;min-width:0;line-height:1.15}'
    + '.lbl-tag{font-family:"JetBrains Mono",Menlo,Consolas,monospace;font-weight:700;font-size:10pt}'
    + '.lbl-name{font-size:7.5pt;color:#333;margin-top:1mm;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}'
    + '.lbl-org{font-size:6.5pt;color:#888;margin-top:1.5mm;font-family:"JetBrains Mono",Menlo,Consolas,monospace;letter-spacing:.5px}'
    + '@media print { .toolbar{display:none} .sheet{padding:' + s.pageMarginTopMm + 'mm ' + s.pageMarginLeftMm + 'mm} }';

  var perSheet = s.cols * s.rows;
  var pageCount = Math.ceil(assets.length / perSheet);
  var html = '<!DOCTYPE html><html><head><title>WSC Asset Labels</title><meta charset="utf-8"><style>' + css + '</style></head><body class="guides">'
    + '<div class="toolbar">'
    +   '<div class="count">' + assets.length + ' label' + (assets.length === 1 ? '' : 's')
    +     ' &middot; ' + s.cols + '&times;' + s.rows + ' per A4'
    +     ' &middot; ' + pageCount + ' page' + (pageCount === 1 ? '' : 's') + '</div>'
    +   '<label style="display:flex;gap:6px;align-items:center;cursor:pointer;user-select:none"><input type="checkbox" checked onchange="document.body.classList.toggle(\'guides\',this.checked)"> Cut guides</label>'
    +   '<button onclick="window.print()">Print</button>'
    +   '<button onclick="window.close()">Close</button>'
    + '</div>'
    + '<div class="sheet">' + cells + '</div>'
    + '<scr' + 'ipt>setTimeout(function(){window.print()},400)</scr' + 'ipt>'
    + '</body></html>';

  w.document.open();
  w.document.write(html);
  w.document.close();
}

async function printAssetLabel(assetId) {
  try {
    var asset = await API.getAsset(assetId);
    await renderLabelSheet([asset]);
  } catch (e) { /* already toasted */ }
}
window.printAssetLabel = printAssetLabel;

// ─── Asset-scoped issues (receipts tab) ──────
// Lists signed/pending issues for a single asset and lets admins re-issue
// or chase outstanding signatures. Shares the resend/cancel/view helpers
// defined in issues.js.

async function loadAssetIssues(assetId) {
  var el = document.getElementById('asset-issues-list');
  if (!el) return;
  try {
    var res = await API.getIssues({});
    var rows = (res.data || []).filter(function(r) { return r.asset_id === assetId; });
    if (!rows.length) {
      el.innerHTML = '<div class="table-empty">No receipts sent for this asset yet.</div>';
      return;
    }
    var html = '<div class="table-wrap"><table><thead><tr>'
      + '<th>Recipient</th><th>Status</th><th>Issued</th><th>Signed</th><th>Actions</th>'
      + '</tr></thead><tbody>';
    rows.forEach(function(r) {
      html += '<tr>'
        + '<td>' + esc(r.person_name || '') + (r.person_email ? '<div style="font-size:11px;color:var(--text3)">' + esc(r.person_email) + '</div>' : '') + '</td>'
        + '<td>' + issueStatusBadge(r.status) + '</td>'
        + '<td class="mono">' + fmtDate(r.issued_at) + '</td>'
        + '<td class="mono">' + (r.signed_at ? fmtDate(r.signed_at) : '—') + '</td>'
        + '<td>';
      if (r.status === 'pending' && Auth.isAdmin()) {
        html += '<button class="btn sm" onclick="resendIssue(\'' + esc(r.id) + '\').then(function(){ loadAssetIssues(\'' + esc(assetId) + '\'); })">Resend</button> '
          + '<button class="btn sm" onclick="cancelIssueConfirm(\'' + esc(r.id) + '\').then(function(){ loadAssetIssues(\'' + esc(assetId) + '\'); })">Cancel</button>';
      } else if (r.status === 'signed') {
        html += '<button class="btn sm" onclick="viewIssueSignature(\'' + esc(r.id) + '\')">View</button>';
      }
      html += '</td></tr>';
    });
    html += '</tbody></table></div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="table-empty">Failed to load receipts</div>';
  }
}
window.loadAssetIssues = loadAssetIssues;

async function sendAssetIssue(assetId, personId) {
  var ok = await confirmDialog('Email a receipt-signing link to the assigned recipient?', 'Send link');
  if (!ok) return;
  try {
    await API.issueAsset(assetId, { person_id: personId });
    toast('Signing link sent', 'success');
    loadAssetIssues(assetId);
  } catch (e) { /* toasted */ }
}
window.sendAssetIssue = sendAssetIssue;

// Prints labels for every asset matching the current filter/search state,
// walking the paginated list server-side so the output matches what the
// user sees in the filter bar (not just the current visible page).
async function printFilteredLabels() {
  if (!API.baseUrl) { toast('Configure API first', 'error'); return; }
  try {
    var all = [];
    var page = 1;
    while (page <= 20) {
      var params = { page: page, limit: 100, sort: assetState.sort, dir: assetState.dir };
      if (assetState.search) params.search = assetState.search;
      if (assetState.status) params.status = assetState.status;
      if (assetState.category) params.category = assetState.category;
      var res = await API.getAssets(params);
      all = all.concat(res.data || []);
      if (!res.data || res.data.length < 100 || all.length >= (res.total || 0)) break;
      page++;
    }
    if (!all.length) { toast('No assets match the current filter', 'error'); return; }
    await renderLabelSheet(all);
  } catch (e) { /* already toasted */ }
}
window.printFilteredLabels = printFilteredLabels;

// ─── Step 4: Asset Create/Edit Form ────────────

async function renderAssetForm(editId) {
  var el = document.getElementById('view-asset-form');
  if (!Auth.isAdmin()) {
    el.innerHTML = '<div style="max-width:520px;margin:40px auto;padding:24px;background:var(--surface);border:1px solid var(--border);border-radius:12px;text-align:center">'
      + '<div style="font-size:40px;margin-bottom:12px">&#128274;</div>'
      + '<h2 style="margin:0 0 8px;font-size:17px">Admin access required</h2>'
      + '<p style="margin:0 0 16px;font-size:13px;color:var(--text2)">Creating and editing assets is restricted to administrators.</p>'
      + '<button class="btn" onclick="history.back()">Back</button>'
      + '</div>';
    return;
  }
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
    + '<select id="af-category" class="form-select" onchange="onAssetCategoryChange(this.value)">'
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

  // Assign to
  html += '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Assign To</label>'
    + '<select id="af-assign" class="form-select"><option value="">Not assigned</option>';
  (_people || []).forEach(function(p) {
    var sel = asset && asset.assigned_to === p.id ? ' selected' : '';
    html += '<option value="' + esc(p.id) + '"' + sel + '>' + esc(p.name) + (p.department ? ' (' + esc(p.department) + ')' : '') + '</option>';
  });
  html += '</select><div class="form-hint">Setting this will change status to Deployed</div></div></div>';

  // Lifecycle — purchase + retirement dates. Retirement auto-fills as
  // purchase_date + 3 years (council IT policy) when the user types a
  // purchase date, but stays editable.
  html += '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Purchase Date</label>'
    + '<input type="date" id="af-purchase-date" class="form-input" value="' + esc(asset ? asset.purchase_date || '' : '') + '" onchange="autofillRetirement()">'
    + '<div class="form-hint">When the device was bought. Drives the retirement date.</div></div>'
    + '<div class="form-group"><label class="form-label">Retirement Date</label>'
    + '<input type="date" id="af-retirement-date" class="form-input" value="' + esc(asset ? asset.retirement_date || '' : '') + '">'
    + '<div class="form-hint">Defaults to purchase + 3 years. Edit for longer-lived gear.</div></div>'
    + '</div>';

  // Loaner pool flag — toggling this puts the asset into the short-term
  // lending pool (visitor devices etc.) instead of permanent allocation.
  var isLoaner = asset && asset.is_loaner ? 'checked' : '';
  html += '<div class="form-group" style="display:flex;align-items:center;gap:8px">'
    + '<input type="checkbox" id="af-is-loaner" ' + isLoaner + ' style="width:auto;margin:0">'
    + '<label class="form-label" for="af-is-loaner" style="margin:0">In loaner pool</label>'
    + '<span class="form-hint" style="margin:0">Short-term lends with a due date (visitor devices, spare units).</span>'
    + '</div>';

  // Notes
  html += '<div class="form-group"><label class="form-label">Notes</label>'
    + '<textarea id="af-notes" class="form-textarea" placeholder="Optional notes">' + esc(asset ? asset.notes || '' : '') + '</textarea></div>';

  // Hardware Specs (collapsible)
  var hasSpecs = asset && (asset.hostname || asset.os || asset.cpu || asset.ram_gb || asset.disk_gb || asset.mac_address);
  html += '<details id="af-specs-details"' + (hasSpecs ? ' open' : '') + ' style="margin-bottom:16px">'
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

  // Phone fields (toggled independently of IT specs)
  html += '<div id="af-phone-fields" style="margin-bottom:16px">'
    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Phone Number</label>'
    + '<input type="tel" id="af-phone-number" class="form-input" value="' + esc(asset ? asset.phone_number : '') + '" placeholder="04XX XXX XXX"></div>'
    + '<div class="form-group"><label class="form-label">Carrier</label>'
    + '<input type="text" id="af-carrier" class="form-input" value="' + esc(asset ? asset.carrier : '') + '" placeholder="Telstra / Optus / Vodafone"></div></div>'
    + '</div>';

  // Custom fields container
  html += '<div id="af-additional-fields"></div>';

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

  // Keep a reference so onAssetCategoryChange can pre-fill custom fields
  _assetFormAsset = asset || null;

  // Adjust field visibility based on category profile
  onAssetCategoryChange(asset && asset.category_id ? asset.category_id : '');
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

window.onAssetCategoryChange = async function(catId) {
  var sel = document.getElementById('af-category');
  var tagInput = document.getElementById('af-tag');
  if (sel && tagInput) {
    var opt;
    if (catId) {
      opt = sel.querySelector('option[value="' + catId + '"]');
    } else {
      opt = sel.selectedOptions[0];
    }
    if (opt && opt.value && opt.dataset.prefix && API.baseUrl && !tagInput.value) {
      try {
        var result = await API.getNextTag(opt.dataset.prefix);
        tagInput.value = result.tag;
      } catch(e) { /* keep empty */ }
    }
  }

  var profile;
  if (!catId) {
    profile = { show_specs: true, show_phone: true, custom_fields: [] };
  } else {
    profile = await getCategoryProfile(catId);
    if (!profile) profile = { show_specs: true, show_phone: false, custom_fields: [] };
  }

  var specsDetails = document.getElementById('af-specs-details');
  if (specsDetails) {
    specsDetails.style.display = profile.show_specs !== false ? '' : 'none';
  }

  var phoneFields = document.getElementById('af-phone-fields');
  if (phoneFields) {
    phoneFields.style.display = profile.show_phone !== false ? '' : 'none';
  }

  var customContainer = document.getElementById('af-additional-fields');
  if (!customContainer) return;
  customContainer.innerHTML = '';
  if (profile.custom_fields && profile.custom_fields.length) {
    var html = '<div style="margin-bottom:16px"><div style="font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text2);margin-bottom:12px">Additional Fields</div>';
    profile.custom_fields.forEach(function(field) {
      var val = '';
      if (_assetFormAsset && _assetFormAsset.metadata && _assetFormAsset.metadata[field.key] != null) {
        val = String(_assetFormAsset.metadata[field.key]);
      }
      var inputId = 'af-custom-' + field.key;
      if (field.type === 'number') {
        html += '<div class="form-group"><label class="form-label">' + esc(field.label) + '</label>'
          + '<input type="number" id="' + inputId + '" class="form-input" value="' + esc(val) + '" placeholder="' + esc(field.label) + '"></div>';
      } else {
        html += '<div class="form-group"><label class="form-label">' + esc(field.label) + '</label>'
          + '<input type="text" id="' + inputId + '" class="form-input" value="' + esc(val) + '" placeholder="' + esc(field.label) + '"></div>';
      }
    });
    html += '</div>';
    customContainer.innerHTML = html;
  }
};


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
    assigned_to: document.getElementById('af-assign').value || null,
    notes: document.getElementById('af-notes').value.trim() || null,
    purchase_date: document.getElementById('af-purchase-date').value || null,
    retirement_date: document.getElementById('af-retirement-date').value || null,
    hostname: document.getElementById('af-hostname').value.trim() || null,
    os: document.getElementById('af-os').value.trim() || null,
    cpu: document.getElementById('af-cpu').value.trim() || null,
    ram_gb: parseInt(document.getElementById('af-ram').value) || null,
    disk_gb: parseInt(document.getElementById('af-disk').value) || null,
    mac_address: document.getElementById('af-mac').value.trim() || null,
    ip_address: document.getElementById('af-ip').value.trim() || null,
    enrolled_user: document.getElementById('af-enrolled-user').value.trim() || null,
    phone_number: (document.getElementById('af-phone-number') ? document.getElementById('af-phone-number').value.trim() : '') || null,
    carrier: (document.getElementById('af-carrier') ? document.getElementById('af-carrier').value.trim() : '') || null,
    is_loaner: document.getElementById('af-is-loaner') && document.getElementById('af-is-loaner').checked ? 1 : 0
  };

  // Collect custom metadata
  var metadata = {};
  var customContainer = document.getElementById('af-additional-fields');
  if (customContainer) {
    var inputs = customContainer.querySelectorAll('input');
    inputs.forEach(function(input) {
      if (input.id.indexOf('af-custom-') === 0) {
        var key = input.id.replace('af-custom-', '');
        if (input.value !== '') {
          metadata[key] = input.type === 'number' ? (parseFloat(input.value) || input.value) : input.value.trim();
        }
      }
    });
  }
  if (Object.keys(metadata).length) {
    data.metadata = metadata;
  }

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

// ─── Flag a problem (user self-service) ─────────

function openFlagModal(assetId) {
  openModal('Flag a problem',
    '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">'
    + 'Tell the team what\u2019s wrong with this asset. An email goes to the team right away.'
    + '</div>'
    + '<div class="form-group"><label class="form-label">Category</label>'
    + '<select id="flag-category" class="form-select">'
    + '<option value="damaged">Damaged (cracked screen, broken keys, etc.)</option>'
    + '<option value="slow">Running slow / performance issue</option>'
    + '<option value="lost">Lost or stolen</option>'
    + '<option value="other">Other</option>'
    + '</select></div>'
    + '<div class="form-group"><label class="form-label">What\u2019s happening?</label>'
    + '<textarea id="flag-desc" class="form-textarea" rows="4" placeholder="e.g. Screen cracked after it fell off the desk yesterday"></textarea></div>'
    + '<button class="btn primary" onclick="submitFlag(\'' + esc(assetId) + '\')">Send to Support</button>'
  );
}
window.openFlagModal = openFlagModal;

async function submitFlag(assetId) {
  var category = document.getElementById('flag-category').value;
  var description = document.getElementById('flag-desc').value.trim();
  try {
    await API.flagAsset(assetId, { category: category, description: description });
    closeModal();
    toast('Thanks \u2014 the team has been notified', 'success');
    renderAssetDetail(assetId);
  } catch(e) { /* toasted */ }
}
window.submitFlag = submitFlag;
