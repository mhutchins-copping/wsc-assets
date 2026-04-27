// ─── Step 9 (bonus): Categories Management ────

Router.register('/categories', function() {
  var el = document.getElementById('view-categories');
  el.innerHTML = '<div class="toolbar">'
    + '<div class="toolbar-right">'
    + (Auth.isAdmin() ? '<button class="btn primary sm" onclick="openCategoryForm()">+ New Category</button>' : '')
    + '</div></div>'
    + '<div id="categories-tree">' + skeleton(6) + '</div>';

  loadCategories();
});

async function loadCategories() {
  var treeEl = document.getElementById('categories-tree');
  if (!API.baseUrl) {
    treeEl.innerHTML = '<div class="view-placeholder">'
      + '<div class="view-placeholder-icon">&#128193;</div>'
      + '<div class="view-placeholder-title">Categories</div>'
      + '<div class="view-placeholder-sub">Configure your API endpoint in Settings to manage categories</div></div>';
    return;
  }

  try {
    var result = await API.getCategories();
    var data = result.data || [];
    var html = '';

    data.forEach(function(parent) {
      html += '<div class="card" style="margin-bottom:12px">'
        + '<div class="card-header">'
        + '<div style="display:flex;align-items:center;gap:8px">'
        + '<span style="font-size:18px">' + (parent.icon || '📁') + '</span>'
        + '<span class="card-title" style="font-size:14px">' + esc(parent.name) + '</span>'
        + '<span style="font-size:10px;font-family:var(--mono);color:var(--text3);background:var(--surface2);padding:2px 8px;border-radius:10px">' + esc(parent.prefix) + '</span>'
        + '</div>'
        + '<div style="display:flex;gap:6px">'
        + (Auth.isAdmin() ? '<button class="btn sm" onclick="openCategoryForm(null,\'' + esc(parent.id) + '\')">+ Subcategory</button>' : '')
        + (Auth.isAdmin() ? '<button class="btn sm" onclick="openCategoryFormEdit(\'' + esc(parent.id) + '\')">Edit</button>' : '')
        + '</div></div>';

      if (parent.children && parent.children.length) {
        html += '<div style="padding:4px 20px 12px">';
        parent.children.forEach(function(child) {
          var profile = child.field_profile || {};
          var profileHints = [];
          if (profile.show_specs) profileHints.push('specs');
          if (profile.show_phone) profileHints.push('phone');
          if (profile.custom_fields && profile.custom_fields.length) {
            profileHints.push(profile.custom_fields.length + ' custom field' + (profile.custom_fields.length === 1 ? '' : 's'));
          }
          var profileBadge = profileHints.length
            ? '<span style="font-size:10px;color:var(--text3);background:var(--surface2);padding:1px 6px;border-radius:4px;margin-left:6px">' + esc(profileHints.join(' · ')) + '</span>'
            : '';

          html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">'
            + '<div style="display:flex;align-items:center;gap:10px">'
            + '<span style="font-size:16px">' + (child.icon || '📄') + '</span>'
            + '<div>'
            + '<span style="font-weight:500">' + esc(child.name) + '</span>'
            + '<span style="font-size:11px;font-family:var(--mono);color:var(--text3);margin-left:8px">WSC-' + esc(child.prefix) + '-####</span>'
            + profileBadge
            + '</div></div>'
            + '<div style="display:flex;align-items:center;gap:10px">'
            + '<span style="font-size:12px;font-family:var(--mono);color:var(--text2)">' + (child.asset_count || 0) + ' assets</span>'
            + (Auth.isAdmin() ? '<button class="icon-btn" onclick="openCategoryFormEdit(\'' + esc(child.id) + '\')" title="Edit">&#9998;</button>' : '')
            + (Auth.isAdmin() ? '<button class="icon-btn" onclick="deleteCategoryConfirm(\'' + esc(child.id) + '\',\'' + esc(child.name) + '\',' + (child.asset_count || 0) + ')" title="Delete">&#10005;</button>' : '')
            + '</div></div>';
        });
        html += '</div>';
      } else {
        html += '<div class="card-body"><div class="table-empty" style="padding:12px 0">No subcategories</div></div>';
      }

      html += '</div>';
    });

    treeEl.innerHTML = html || '<div class="table-empty">No categories</div>';
  } catch(e) {
    treeEl.innerHTML = '<div class="table-empty">Failed to load categories</div>';
  }
}

// ─── Category Form ─────────────────────────────

function openCategoryForm(editId, parentId, prefilled) {
  var title = editId ? 'Edit Category' : 'New Category';
  var profile = (prefilled && prefilled.field_profile) || {};

  var html = '<div class="form-group"><label class="form-label">Name</label>'
    + '<input type="text" id="cf-name" class="form-input" placeholder="e.g. Laptop"></div>';

  html += '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Prefix</label>'
    + '<input type="text" id="cf-prefix" class="form-input" placeholder="e.g. L" maxlength="4" style="text-transform:uppercase">'
    + '<div class="form-hint">Used for asset tags: WSC-[prefix]-####</div></div>'
    + '<div class="form-group"><label class="form-label">Icon (emoji)</label>'
    + '<input type="text" id="cf-icon" class="form-input" placeholder="e.g. 💻" maxlength="4"></div></div>';

  if (parentId) {
    html += '<input type="hidden" id="cf-parent" value="' + esc(parentId) + '">';
  } else {
    html += '<div class="form-group"><label class="form-label">Parent Category</label>'
      + '<select id="cf-parent" class="form-select"><option value="">None (top-level)</option></select>'
      + '<div class="form-hint">Leave empty to create a parent category</div></div>';
  }

  // Field Profile
  var showSpecs = profile.show_specs !== false ? 'checked' : '';
  var showPhone = profile.show_phone !== false ? 'checked' : '';
  html += '<div style="margin:16px 0;border-top:1px solid var(--border);padding-top:12px">'
    + '<div style="font-weight:600;font-size:13px;margin-bottom:10px">Field Profile</div>'
    + '<div style="display:flex;gap:16px;margin-bottom:12px">'
    + '<label class="co-ack-label" style="display:flex;gap:6px;align-items:center;cursor:pointer;font-size:13px">'
    + '<input type="checkbox" id="cf-show-specs" ' + showSpecs + '>'
    + '<span>Show hardware specs (hostname, OS, CPU, RAM, etc.)</span></label>'
    + '<label class="co-ack-label" style="display:flex;gap:6px;align-items:center;cursor:pointer;font-size:13px">'
    + '<input type="checkbox" id="cf-show-phone" ' + showPhone + '>'
    + '<span>Show phone fields (number, carrier)</span></label>'
    + '</div>'
    + '<div id="cf-custom-fields"></div>'
    + '<button class="btn sm" type="button" onclick="addCustomField()">+ Add custom field</button>'
    + '</div>';

  html += '<button class="btn primary full" onclick="saveCategory(\'' + (editId || '') + '\')">' + (editId ? 'Update' : 'Create') + '</button>';

  openModal(title, html);

  // Populate parent dropdown if not given a fixed parent
  if (!parentId) {
    setTimeout(function() {
      API.getCategories().then(function(res) {
        var parents = (res.data || []).filter(function(c) { return !c.parent_id; });
        var sel = document.getElementById('cf-parent');
        if (!sel || sel.tagName !== 'SELECT') return;
        parents.forEach(function(p) {
          var opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name;
          sel.appendChild(opt);
        });
        if (prefilled && prefilled.parent_id) sel.value = prefilled.parent_id;
      });
    }, 0);
  }

  // Pre-fill values
  if (prefilled) {
    setTimeout(function() {
      document.getElementById('cf-name').value = prefilled.name || '';
      document.getElementById('cf-prefix').value = prefilled.prefix || '';
      var iconEl = document.getElementById('cf-icon');
      if (iconEl) iconEl.value = prefilled.icon || '';
      renderCustomFieldRows(profile.custom_fields || []);
    }, 50);
  }
}
window.openCategoryForm = openCategoryForm;

async function openCategoryFormEdit(editId) {
  try {
    var result = await API.getCategories();
    var all = result.flat || [];
    var cat = all.find(function(c) { return c.id === editId; });
    if (!cat) { toast('Category not found', 'error'); return; }

    openCategoryForm(editId, cat.parent_id, cat);
  } catch(e) { toast('Failed to load category', 'error'); }
}
window.openCategoryFormEdit = openCategoryFormEdit;

// ─── Custom Fields Builder ─────────────────────

function renderCustomFieldRows(fields) {
  var container = document.getElementById('cf-custom-fields');
  if (!container) return;
  container.innerHTML = '';
  (fields || []).forEach(function(f, idx) {
    addCustomFieldRow(f.label, f.key, f.type, idx);
  });
}
window.renderCustomFieldRows = renderCustomFieldRows;

function addCustomField() {
  var container = document.getElementById('cf-custom-fields');
  if (!container) return;
  var idx = container.querySelectorAll('.cf-custom-row').length;
  addCustomFieldRow('', '', 'text', idx);
}
window.addCustomField = addCustomField;

function addCustomFieldRow(label, key, type, idx) {
  var container = document.getElementById('cf-custom-fields');
  if (!container) return;
  var row = document.createElement('div');
  row.className = 'cf-custom-row';
  row.style.cssText = 'display:flex;gap:8px;align-items:flex-end;margin-bottom:8px';
  row.innerHTML =
    '<div class="form-group" style="flex:1;margin:0">'
    + '<label class="form-label" style="font-size:11px">Label</label>'
    + '<input type="text" class="form-input cf-custom-label" value="' + esc(label) + '" placeholder="e.g. Screen Size">'
    + '</div>'
    + '<div class="form-group" style="flex:1;margin:0">'
    + '<label class="form-label" style="font-size:11px">Key</label>'
    + '<input type="text" class="form-input cf-custom-key" value="' + esc(key) + '" placeholder="e.g. screen_size">'
    + '</div>'
    + '<div class="form-group" style="width:90px;margin:0">'
    + '<label class="form-label" style="font-size:11px">Type</label>'
    + '<select class="form-select cf-custom-type">'
    + '<option value="text"' + (type === 'text' ? ' selected' : '') + '>Text</option>'
    + '<option value="number"' + (type === 'number' ? ' selected' : '') + '>Number</option>'
    + '</select>'
    + '</div>'
    + '<button class="btn danger sm" type="button" onclick="this.parentElement.remove()" style="margin-bottom:4px">&times;</button>';
  container.appendChild(row);

  // Auto-generate key from label
  var labelInput = row.querySelector('.cf-custom-label');
  var keyInput = row.querySelector('.cf-custom-key');
  if (labelInput && keyInput && !key) {
    labelInput.addEventListener('input', function() {
      if (!keyInput.dataset.edited) {
        keyInput.value = labelInput.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 30);
      }
    });
    keyInput.addEventListener('input', function() {
      keyInput.dataset.edited = '1';
    });
  }
}

function collectCustomFields() {
  var fields = [];
  document.querySelectorAll('.cf-custom-row').forEach(function(row) {
    var label = row.querySelector('.cf-custom-label').value.trim();
    var key = row.querySelector('.cf-custom-key').value.trim();
    var type = row.querySelector('.cf-custom-type').value;
    if (label && key) {
      fields.push({ label: label, key: key, type: type });
    }
  });
  return fields;
}

async function saveCategory(editId) {
  var name = document.getElementById('cf-name').value.trim();
  var prefix = document.getElementById('cf-prefix').value.trim().toUpperCase();
  if (!name || !prefix) { toast('Name and prefix are required', 'error'); return; }

  var fieldProfile = {
    show_specs: document.getElementById('cf-show-specs').checked,
    show_phone: document.getElementById('cf-show-phone').checked,
    custom_fields: collectCustomFields()
  };

  var data = {
    name: name,
    prefix: prefix,
    icon: document.getElementById('cf-icon').value.trim() || null,
    parent_id: document.getElementById('cf-parent').value || null,
    field_profile: fieldProfile
  };

  try {
    if (editId) {
      await API.updateCategory(editId, data);
      toast('Category updated', 'success');
    } else {
      await API.createCategory(data);
      toast('Category created', 'success');
    }
    closeModal();
    loadCategories();
  } catch(e) { /* toasted */ }
}
window.saveCategory = saveCategory;

async function deleteCategoryConfirm(id, name, assetCount) {
  if (assetCount > 0) {
    toast('Cannot delete — ' + assetCount + ' assets in this category', 'error');
    return;
  }
  var ok = await confirmDialog('Delete category <strong>' + esc(name) + '</strong>?', 'Delete');
  if (!ok) return;
  try {
    await API.deleteCategory(id);
    toast('Category deleted', 'success');
    loadCategories();
  } catch(e) { /* toasted */ }
}
window.deleteCategoryConfirm = deleteCategoryConfirm;
