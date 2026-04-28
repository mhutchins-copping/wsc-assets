// ─── Consumables / Inventory ───────────────────
// Quantity-tracked stock for commodity items (keyboards, mice, cables,
// chargers, toner). Distinct from assets — no per-unit identity.
//
// Routes:
//   #/consumables               → list
//   #/consumables/new           → add form
//   #/consumables/edit/<id>     → edit form
//   #/consumables/<id>          → detail + movement history
//
// Permissions:
//   * read = viewer+ (everyone in council)
//   * write/issue/adjust = manager+ (gated server-side; UI hides buttons)

var consumablesState = {
  category: '',
  lowStockOnly: false,
  search: ''
};

Router.register('/consumables', function(param) {
  if (param === 'new') return renderConsumableForm();
  if (param && param.indexOf('edit/') === 0) return renderConsumableForm(param.replace('edit/', ''));
  if (param) return renderConsumableDetail(param);
  return renderConsumablesList();
});

// Starter list of common categories - shown in the dropdown but free
// text is also accepted (datalist on the form). The operator's free
// to add new categories like "case", "screen protector", "battery",
// "usb drive", "stand" — anything they want to track.
var CONSUMABLE_CATEGORIES = [
  { value: 'keyboard',         label: 'Keyboard' },
  { value: 'mouse',            label: 'Mouse' },
  { value: 'charger',          label: 'Charger' },
  { value: 'headset',          label: 'Headset' },
  { value: 'dock',             label: 'Docking station' },
  { value: 'cable',            label: 'Cable / adapter' },
  { value: 'case',             label: 'Case / sleeve' },
  { value: 'screen_protector', label: 'Screen protector' },
  { value: 'battery',          label: 'Battery' },
  { value: 'usb_drive',        label: 'USB drive' },
  { value: 'stand',            label: 'Stand / mount' },
  { value: 'mousepad',         label: 'Mousepad' },
  { value: 'toner',            label: 'Toner' },
  { value: 'other',            label: 'Other' }
];

function consumableCategoryLabel(cat) {
  for (var i = 0; i < CONSUMABLE_CATEGORIES.length; i++) {
    if (CONSUMABLE_CATEGORIES[i].value === cat) return CONSUMABLE_CATEGORIES[i].label;
  }
  return cat;
}
window.consumableCategoryLabel = consumableCategoryLabel;

// ─── List ─────────────────────────────────────────
function renderConsumablesList() {
  var el = document.getElementById('view-consumables');
  if (!el) return;
  var canWrite = Auth.user && (Auth.user.role === 'admin' || Auth.user.role === 'manager');
  el.innerHTML = '<div class="toolbar">'
    + '<div class="toolbar-left">'
    + '<div class="toolbar-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
    + '<input type="text" placeholder="Search by name, supplier, description…" value="' + esc(consumablesState.search) + '" oninput="consumablesSearchDebounced(this.value)"></div>'
    + '</div>'
    + '<div class="toolbar-right">'
    + (canWrite ? '<button class="btn primary sm" onclick="navigate(\'#/consumables/new\')">+ New Item</button>' : '')
    + '</div></div>'
    + '<div id="consumables-filters"></div>'
    + '<div id="consumables-table">' + skeleton(6) + '</div>';
  renderConsumablesFilters();
  loadConsumables();
}

var consumablesSearchDebounced = debounce(function(val) {
  consumablesState.search = val;
  loadConsumables();
}, 200);
window.consumablesSearchDebounced = consumablesSearchDebounced;

function renderConsumablesFilters() {
  var filters = [{ value: '', label: 'All' }].concat(CONSUMABLE_CATEGORIES.map(function(c) {
    return { value: c.value, label: c.label };
  }));
  document.getElementById('consumables-filters').innerHTML = renderFilters({
    filters: filters, active: consumablesState.category, onClick: 'filterConsumablesCategory'
  })
  + '<div style="margin:6px 0 14px;display:flex;align-items:center;gap:8px;font-size:13px">'
  + '<input type="checkbox" id="cons-low-only" ' + (consumablesState.lowStockOnly ? 'checked' : '') + ' onchange="filterConsumablesLowStock(this.checked)" style="margin:0">'
  + '<label for="cons-low-only" style="cursor:pointer;color:var(--text2)">Show only low-stock items</label>'
  + '</div>';
}

function filterConsumablesCategory(c) {
  consumablesState.category = c;
  renderConsumablesFilters();
  loadConsumables();
}
window.filterConsumablesCategory = filterConsumablesCategory;

function filterConsumablesLowStock(b) {
  consumablesState.lowStockOnly = !!b;
  loadConsumables();
}
window.filterConsumablesLowStock = filterConsumablesLowStock;

async function loadConsumables() {
  var tableEl = document.getElementById('consumables-table');
  if (!tableEl) return;
  try {
    var params = {};
    if (consumablesState.category) params.category = consumablesState.category;
    if (consumablesState.lowStockOnly) params.low_stock = 1;
    if (consumablesState.search) params.search = consumablesState.search;
    var res = await API.getConsumables(params);
    var rows = res.data || [];
    if (!rows.length) {
      tableEl.innerHTML = '<div class="view-placeholder">'
        + '<div class="view-placeholder-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></div>'
        + '<div class="view-placeholder-title">No consumables yet</div>'
        + '<div class="view-placeholder-sub">Add stock items like keyboards, mice, chargers, toner.</div>'
        + '</div>';
      return;
    }
    window.__consumablesIndex = {};
    rows.forEach(function(r) { window.__consumablesIndex[r.id] = r; });
    var columns = [
      { key: 'name', label: 'Item', render: function(r) {
        var lowBadge = r.is_low_stock ? ' <span class="badge" style="background:#fee2e2;color:#991b1b">Low</span>' : '';
        return '<strong>' + esc(r.name) + '</strong>' + lowBadge
          + '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + esc(consumableCategoryLabel(r.category)) + (r.supplier ? ' &middot; ' + esc(r.supplier) : '') + '</div>';
      }},
      { key: 'quantity', label: 'On hand', render: function(r) {
        var col = r.is_low_stock ? '#dc2626' : 'var(--text)';
        return '<span style="font-weight:600;color:' + col + '">' + r.quantity + '</span>'
          + '<span style="color:var(--text3);font-weight:400"> / min ' + r.min_stock + '</span>';
      }},
      { key: 'unit_cost', label: 'Unit cost', render: function(r) { return r.unit_cost != null ? fmtCurrency(r.unit_cost) : '<span style="color:var(--text3)">—</span>'; } },
      { key: 'location_name', label: 'Location', render: function(r) { return esc(r.location_name || '—'); } },
      { key: '__actions', label: 'Actions', render: function(r) {
        if (!canWrite()) return '<span style="color:var(--text3)">—</span>';
        return '<button class="btn primary sm" onclick="event.stopPropagation();openIssueConsumable(\'' + esc(r.id) + '\')">Issue</button>'
          + ' <button class="btn sm" onclick="event.stopPropagation();openAdjustConsumable(\'' + esc(r.id) + '\')">Adjust</button>';
      }}
    ];
    tableEl.innerHTML = renderTable({
      columns: columns, data: rows, emptyMsg: 'No items',
      onRowClick: 'openConsumable'
    });
  } catch (e) {
    tableEl.innerHTML = '<div class="table-empty">Failed to load consumables</div>';
  }
}
window.loadConsumables = loadConsumables;

function canWrite() {
  return Auth.user && (Auth.user.role === 'admin' || Auth.user.role === 'manager');
}

function openConsumable(id) { navigate('#/consumables/' + id); }
window.openConsumable = openConsumable;

// ─── Detail ───────────────────────────────────────
async function renderConsumableDetail(id) {
  var el = document.getElementById('view-consumables');
  if (!el) return;
  el.innerHTML = skeleton(8);
  try {
    var c = await API.getConsumable(id);
    var lowBadge = (c.quantity <= c.min_stock) ? ' <span class="badge" style="background:#fee2e2;color:#991b1b">Low stock</span>' : '';
    var html = '<div style="margin-bottom:12px"><button class="btn sm" onclick="navigate(\'#/consumables\')">&larr; Back</button></div>';

    html += '<div class="detail-header">'
      + '<div class="detail-header-info">'
      + '<div class="detail-header-tag">' + esc(consumableCategoryLabel(c.category)) + (c.supplier ? ' &middot; ' + esc(c.supplier) : '') + '</div>'
      + '<div class="detail-header-name">' + esc(c.name) + lowBadge + '</div>'
      + '</div>'
      + '<div class="detail-header-actions">';
    if (canWrite()) {
      html += '<button class="btn primary sm" onclick="openIssueConsumable(\'' + esc(c.id) + '\')">Issue</button>'
        + '<button class="btn sm" onclick="openAdjustConsumable(\'' + esc(c.id) + '\')">Adjust stock</button>'
        + '<button class="btn sm" onclick="navigate(\'#/consumables/edit/' + esc(c.id) + '\')">Edit</button>';
    }
    html += '</div></div>';

    // Stock summary card
    html += '<div class="card" style="margin-bottom:12px"><div class="card-body">'
      + '<div class="detail-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">'
      + detailField('On hand', '<span style="font-size:18px;font-weight:700;color:' + (c.quantity <= c.min_stock ? '#dc2626' : 'var(--text)') + '">' + c.quantity + '</span>', true)
      + detailField('Min stock', String(c.min_stock))
      + detailField('Unit cost', c.unit_cost != null ? fmtCurrency(c.unit_cost) : null)
      + detailField('Location', c.location_name)
      + '</div></div></div>';

    // Other details
    var rows = [
      ['Description', c.description],
      ['Notes', c.notes]
    ];
    if (c.category === 'toner') {
      rows.push(['Printer compatibility', c.toner_printer_models]);
      rows.push(['Toner colour', c.toner_colour]);
      rows.push(['Yield (pages)', c.toner_yield != null ? String(c.toner_yield) : null]);
      rows.push(['Cartridge code', c.toner_cartridge_code]);
    }
    var hasAny = rows.some(function(r) { return r[1]; });
    if (hasAny) {
      html += '<div class="card" style="margin-bottom:12px"><div class="card-header"><span class="card-title">Details</span></div>'
        + '<div class="card-body"><div class="detail-grid" style="grid-template-columns:1fr 1fr">';
      rows.forEach(function(r) { html += detailField(r[0], r[1]); });
      html += '</div></div></div>';
    }

    // Movement history
    html += '<div class="card"><div class="card-header"><span class="card-title">Movement history</span></div><div class="card-body">';
    if (c.movements && c.movements.length) {
      html += '<div class="table-wrap"><table><thead><tr>'
        + '<th>Date</th><th>Type</th><th>Change</th><th>Person</th><th>Asset</th><th>Notes</th><th>By</th>'
        + '</tr></thead><tbody>';
      c.movements.forEach(function(m) {
        var sign = m.quantity_change > 0 ? '+' : '';
        var col = m.quantity_change > 0 ? '#059669' : '#dc2626';
        html += '<tr>'
          + '<td class="mono">' + fmtDateTime(m.created_at) + '</td>'
          + '<td>' + movementBadge(m.movement_type) + '</td>'
          + '<td><span style="font-weight:600;color:' + col + '">' + sign + m.quantity_change + '</span></td>'
          + '<td>' + esc(m.person_name || '—') + '</td>'
          + '<td>' + (m.asset_tag ? '<a href="#/assets/' + esc(m.asset_id) + '" class="mono">' + esc(m.asset_tag) + '</a>' : '<span style="color:var(--text3)">—</span>') + '</td>'
          + '<td>' + esc(m.notes || '—') + '</td>'
          + '<td class="mono" style="font-size:11px;color:var(--text3)">' + esc(m.performed_by_name || m.performed_by_email || '—') + '</td>'
          + '</tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div class="table-empty">No movements yet</div>';
    }
    html += '</div></div>';

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="table-empty">Failed to load consumable<br><span style="font-size:11px;color:var(--text3)">' + esc(e.message) + '</span></div>';
  }
}

function movementBadge(t) {
  var palette = {
    added:       { bg: '#d1fae5', fg: '#065f46', label: 'Added' },
    issued:      { bg: '#fef3c7', fg: '#92400e', label: 'Issued' },
    returned:    { bg: '#dbeafe', fg: '#1e40af', label: 'Returned' },
    adjusted:    { bg: '#e5e7eb', fg: '#374151', label: 'Adjusted' },
    written_off: { bg: '#fee2e2', fg: '#991b1b', label: 'Written off' }
  };
  var p = palette[t] || palette.adjusted;
  return '<span class="badge" style="background:' + p.bg + ';color:' + p.fg + '">' + p.label + '</span>';
}

// ─── Add / edit form ──────────────────────────────
async function renderConsumableForm(editId) {
  var el = document.getElementById('view-consumables');
  if (!el) return;
  if (!canWrite()) {
    el.innerHTML = '<div class="view-placeholder"><div class="view-placeholder-icon">&#128274;</div><div class="view-placeholder-title">Manager+ required</div></div>';
    return;
  }
  var c = null;
  if (editId) {
    try { c = await API.getConsumable(editId); }
    catch (e) { el.innerHTML = '<div class="table-empty">Failed to load</div>'; return; }
  }
  // Locations for dropdown
  var locations = [];
  try { locations = await API.getLocations(); } catch(e) {}

  var html = '<div style="margin-bottom:12px"><button class="btn sm" onclick="navigate(\'#/consumables' + (editId ? '/' + esc(editId) : '') + '\')">&larr; Cancel</button></div>';
  html += '<h2 style="margin:0 0 18px;font-size:18px">' + (editId ? 'Edit ' + esc(c.name) : 'New consumable item') + '</h2>';
  html += '<div class="card"><div class="card-body">';

  html += '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Name *</label>'
    + '<input id="cons-name" type="text" class="form-input" value="' + esc(c ? c.name : '') + '" placeholder="e.g. USB-C 65W charger" autofocus></div>'
    + '<div class="form-group"><label class="form-label">Category *</label>'
    + '<input id="cons-category" type="text" class="form-input" list="cons-category-list" value="' + esc(c ? c.category : '') + '" placeholder="e.g. keyboard, charger, case, battery…" oninput="renderTonerFields()">'
    + '<datalist id="cons-category-list">'
    + CONSUMABLE_CATEGORIES.map(function(cat) { return '<option value="' + esc(cat.value) + '">' + esc(cat.label) + '</option>'; }).join('')
    + '</datalist>'
    + '<div class="form-hint">Pick from the list or type your own. Free-text — track whatever you want.</div></div>'
    + '</div>';

  html += '<div class="form-group"><label class="form-label">Description</label>'
    + '<textarea id="cons-description" class="form-textarea" rows="2" placeholder="Optional">' + esc(c ? c.description || '' : '') + '</textarea></div>';

  html += '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Supplier</label>'
    + '<input id="cons-supplier" type="text" class="form-input" value="' + esc(c ? c.supplier || '' : '') + '" placeholder="e.g. Officeworks"></div>'
    + '<div class="form-group"><label class="form-label">Unit cost ($)</label>'
    + '<input id="cons-unit-cost" type="number" step="0.01" class="form-input" value="' + (c && c.unit_cost != null ? c.unit_cost : '') + '" placeholder="29.95"></div>'
    + '</div>';

  if (!editId) {
    html += '<div class="form-row">'
      + '<div class="form-group"><label class="form-label">Initial quantity</label>'
      + '<input id="cons-quantity" type="number" min="0" class="form-input" value="0"></div>'
      + '<div class="form-group"><label class="form-label">Min stock</label>'
      + '<input id="cons-min-stock" type="number" min="0" class="form-input" value="0">'
      + '<div class="form-hint">Triggers low-stock badge when on-hand drops to this.</div></div>'
      + '</div>';
  } else {
    html += '<div class="form-row">'
      + '<div class="form-group"><label class="form-label">On hand (read-only)</label>'
      + '<input type="number" class="form-input" value="' + c.quantity + '" disabled>'
      + '<div class="form-hint">Use Adjust stock on the detail page to change this.</div></div>'
      + '<div class="form-group"><label class="form-label">Min stock</label>'
      + '<input id="cons-min-stock" type="number" min="0" class="form-input" value="' + c.min_stock + '"></div>'
      + '</div>';
  }

  html += '<div class="form-group"><label class="form-label">Location</label>'
    + '<select id="cons-location" class="form-select">'
    + '<option value="">—</option>'
    + (locations || []).map(function(l) {
        return '<option value="' + esc(l.id) + '"' + ((c && c.location_id === l.id) ? ' selected' : '') + '>' + esc(l.name) + '</option>';
      }).join('')
    + '</select></div>';

  html += '<div class="form-group"><label class="form-label">Notes</label>'
    + '<textarea id="cons-notes" class="form-textarea" rows="2" placeholder="Optional">' + esc(c ? c.notes || '' : '') + '</textarea></div>';

  html += '<div id="cons-toner-fields" style="' + (c && c.category === 'toner' ? '' : 'display:none') + '">'
    + '<h3 style="font-size:13px;margin:18px 0 10px;color:var(--text2);text-transform:uppercase;letter-spacing:0.05em">Toner-specific</h3>'
    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Printer compatibility</label>'
    + '<input id="cons-toner-models" type="text" class="form-input" value="' + esc(c ? c.toner_printer_models || '' : '') + '" placeholder="HP M404, HP M428"></div>'
    + '<div class="form-group"><label class="form-label">Cartridge code</label>'
    + '<input id="cons-toner-code" type="text" class="form-input" value="' + esc(c ? c.toner_cartridge_code || '' : '') + '" placeholder="CF259A"></div>'
    + '</div>'
    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Toner colour</label>'
    + '<select id="cons-toner-colour" class="form-select">'
    + ['', 'black', 'cyan', 'magenta', 'yellow'].map(function(col) {
        return '<option value="' + col + '"' + ((c && c.toner_colour === col) ? ' selected' : '') + '>' + (col || '—') + '</option>';
      }).join('')
    + '</select></div>'
    + '<div class="form-group"><label class="form-label">Yield (pages)</label>'
    + '<input id="cons-toner-yield" type="number" min="0" class="form-input" value="' + (c && c.toner_yield != null ? c.toner_yield : '') + '"></div>'
    + '</div></div>';

  html += '<div style="margin-top:18px;display:flex;justify-content:space-between">'
    + '<button class="btn" onclick="navigate(\'#/consumables' + (editId ? '/' + esc(editId) : '') + '\')">Cancel</button>'
    + '<button class="btn primary" onclick="saveConsumable(' + (editId ? "'" + esc(editId) + "'" : 'null') + ')">' + (editId ? 'Save changes' : 'Create item') + '</button>'
    + '</div>';

  html += '</div></div>';
  el.innerHTML = html;
}

function renderTonerFields() {
  var sel = document.getElementById('cons-category');
  var box = document.getElementById('cons-toner-fields');
  if (!sel || !box) return;
  box.style.display = sel.value === 'toner' ? '' : 'none';
}
window.renderTonerFields = renderTonerFields;

async function saveConsumable(editId) {
  var name = document.getElementById('cons-name').value.trim();
  if (!name) { toast('Name is required', 'error'); return; }
  var data = {
    name: name,
    category: document.getElementById('cons-category').value,
    description: document.getElementById('cons-description').value.trim() || null,
    supplier: document.getElementById('cons-supplier').value.trim() || null,
    unit_cost: document.getElementById('cons-unit-cost').value === '' ? null : parseFloat(document.getElementById('cons-unit-cost').value),
    min_stock: parseInt(document.getElementById('cons-min-stock').value) || 0,
    location_id: document.getElementById('cons-location').value || null,
    notes: document.getElementById('cons-notes').value.trim() || null,
    toner_printer_models: document.getElementById('cons-toner-models') ? document.getElementById('cons-toner-models').value.trim() || null : null,
    toner_colour: document.getElementById('cons-toner-colour') ? document.getElementById('cons-toner-colour').value || null : null,
    toner_yield: document.getElementById('cons-toner-yield') && document.getElementById('cons-toner-yield').value ? parseInt(document.getElementById('cons-toner-yield').value) : null,
    toner_cartridge_code: document.getElementById('cons-toner-code') ? document.getElementById('cons-toner-code').value.trim() || null : null
  };
  if (!editId) {
    data.quantity = parseInt(document.getElementById('cons-quantity').value) || 0;
  }
  try {
    if (editId) {
      await API.updateConsumable(editId, data);
      toast('Saved', 'success');
      navigate('#/consumables/' + editId);
    } else {
      var r = await API.createConsumable(data);
      toast('Item added', 'success');
      navigate('#/consumables/' + r.id);
    }
  } catch (e) { /* toasted */ }
}
window.saveConsumable = saveConsumable;

// ─── Issue / adjust modals ────────────────────────
function openIssueConsumable(id) {
  var c = (window.__consumablesIndex || {})[id];
  // If we don't have it cached (came from detail page), load lazily
  if (!c) {
    API.getConsumable(id).then(function(loaded) {
      window.__consumablesIndex = window.__consumablesIndex || {};
      window.__consumablesIndex[id] = loaded;
      renderIssueModal(loaded);
    });
    return;
  }
  renderIssueModal(c);
}
window.openIssueConsumable = openIssueConsumable;

async function renderIssueModal(c) {
  var people = [];
  try {
    var r = await API.getPeople({ limit: 500 });
    people = r.data || r || [];
  } catch (e) {}
  var personOptions = people.map(function(p) {
    return '<option value="' + esc(p.id) + '">' + esc(p.name) + (p.department ? ' — ' + esc(p.department) : '') + '</option>';
  }).join('');
  openModal('Issue: ' + c.name,
    '<div style="font-size:12px;color:var(--text2);margin-bottom:14px">'
    + 'Currently ' + c.quantity + ' on hand. Decrements stock and records a movement.'
    + '</div>'
    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Quantity</label>'
    + '<input id="issue-qty" type="number" min="1" max="' + c.quantity + '" class="form-input" value="1"></div>'
    + '<div class="form-group"><label class="form-label">Issue to (optional)</label>'
    + '<select id="issue-person" class="form-select"><option value="">— No specific staff member —</option>' + personOptions + '</select>'
    + '<div class="form-hint">Leave blank for "general stock issue".</div></div>'
    + '</div>'
    + '<div class="form-group"><label class="form-label">Notes (optional)</label>'
    + '<textarea id="issue-notes" class="form-textarea" rows="2" placeholder="e.g. replacement for broken unit"></textarea></div>'
    + '<button class="btn primary" onclick="submitIssueConsumable(\'' + esc(c.id) + '\')">Issue</button>'
  );
}

async function submitIssueConsumable(id) {
  var qty = parseInt(document.getElementById('issue-qty').value) || 0;
  if (qty < 1) { toast('Quantity must be at least 1', 'error'); return; }
  var data = {
    quantity: qty,
    person_id: document.getElementById('issue-person').value || null,
    notes: document.getElementById('issue-notes').value.trim() || null
  };
  try {
    await API.issueConsumable(id, data);
    closeModal();
    toast('Issued ' + qty, 'success');
    // Refresh whichever view we're on
    var hash = location.hash || '';
    if (hash.indexOf('#/consumables/') === 0) {
      renderConsumableDetail(id);
    } else {
      loadConsumables();
    }
    if (typeof updateLowStockBadge === 'function') updateLowStockBadge();
  } catch (e) { /* toasted */ }
}
window.submitIssueConsumable = submitIssueConsumable;

function openAdjustConsumable(id) {
  var c = (window.__consumablesIndex || {})[id];
  if (!c) {
    API.getConsumable(id).then(function(loaded) {
      window.__consumablesIndex = window.__consumablesIndex || {};
      window.__consumablesIndex[id] = loaded;
      renderAdjustModal(loaded);
    });
    return;
  }
  renderAdjustModal(c);
}
window.openAdjustConsumable = openAdjustConsumable;

function renderAdjustModal(c) {
  openModal('Adjust stock: ' + c.name,
    '<div style="font-size:12px;color:var(--text2);margin-bottom:14px">'
    + 'Currently ' + c.quantity + ' on hand. Use a positive number to add stock, negative to remove (e.g. count adjustment, write-off, return).'
    + '</div>'
    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Change</label>'
    + '<input id="adj-change" type="number" class="form-input" value="0" placeholder="+10 or -3"></div>'
    + '<div class="form-group"><label class="form-label">Type</label>'
    + '<select id="adj-type" class="form-select">'
    + '<option value="">Auto (added if +, adjusted if −)</option>'
    + '<option value="added">Added (new stock)</option>'
    + '<option value="returned">Returned (came back)</option>'
    + '<option value="adjusted">Adjusted (count correction)</option>'
    + '<option value="written_off">Written off (lost / damaged)</option>'
    + '</select></div>'
    + '</div>'
    + '<div class="form-group"><label class="form-label">Notes (optional)</label>'
    + '<textarea id="adj-notes" class="form-textarea" rows="2" placeholder="Why?"></textarea></div>'
    + '<button class="btn primary" onclick="submitAdjustConsumable(\'' + esc(c.id) + '\')">Apply</button>'
  );
}

async function submitAdjustConsumable(id) {
  var change = parseInt(document.getElementById('adj-change').value);
  if (isNaN(change) || change === 0) { toast('Enter a non-zero number', 'error'); return; }
  var data = {
    quantity_change: change,
    movement_type: document.getElementById('adj-type').value || undefined,
    notes: document.getElementById('adj-notes').value.trim() || null
  };
  try {
    await API.adjustConsumable(id, data);
    closeModal();
    toast('Stock updated', 'success');
    var hash = location.hash || '';
    if (hash.indexOf('#/consumables/') === 0) {
      renderConsumableDetail(id);
    } else {
      loadConsumables();
    }
    if (typeof updateLowStockBadge === 'function') updateLowStockBadge();
  } catch (e) { /* toasted */ }
}
window.submitAdjustConsumable = submitAdjustConsumable;

// ─── Sidebar low-stock badge ──────────────────────
async function updateLowStockBadge() {
  var badge = document.getElementById('consumables-badge');
  if (!badge) return;
  if (!Auth.user || (Auth.user.role !== 'admin' && Auth.user.role !== 'manager')) {
    badge.style.display = 'none';
    return;
  }
  try {
    var r = await API.getConsumables({ low_stock: 1 });
    var n = r.low_stock_count || (r.data || []).length;
    if (n > 0) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  } catch(e) { badge.style.display = 'none'; }
}
window.updateLowStockBadge = updateLowStockBadge;

document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() { if (Auth.isLoggedIn) updateLowStockBadge(); }, 1100);
});
