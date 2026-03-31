// ─── Step 9 (bonus): Categories Management ────

Router.register('/categories', function() {
  var el = document.getElementById('view-categories');
  el.innerHTML = '<div class="toolbar">'
    + '<div class="toolbar-right">'
    + '<button class="btn primary sm" onclick="openCategoryForm()">+ New Category</button>'
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
        + '<button class="btn sm" onclick="openCategoryForm(null,\'' + esc(parent.id) + '\')">+ Subcategory</button>'
        + '<button class="btn sm" onclick="openCategoryFormEdit(\'' + esc(parent.id) + '\')">Edit</button>'
        + '</div></div>';

      if (parent.children && parent.children.length) {
        html += '<div style="padding:4px 20px 12px">';
        parent.children.forEach(function(child) {
          html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">'
            + '<div style="display:flex;align-items:center;gap:10px">'
            + '<span style="font-size:16px">' + (child.icon || '📄') + '</span>'
            + '<div>'
            + '<span style="font-weight:500">' + esc(child.name) + '</span>'
            + '<span style="font-size:11px;font-family:var(--mono);color:var(--text3);margin-left:8px">WSC-' + esc(child.prefix) + '-####</span>'
            + '</div></div>'
            + '<div style="display:flex;align-items:center;gap:10px">'
            + '<span style="font-size:12px;font-family:var(--mono);color:var(--text2)">' + (child.asset_count || 0) + ' assets</span>'
            + '<button class="icon-btn" onclick="openCategoryFormEdit(\'' + esc(child.id) + '\')" title="Edit">&#9998;</button>'
            + '<button class="icon-btn" onclick="deleteCategoryConfirm(\'' + esc(child.id) + '\',\'' + esc(child.name) + '\',' + (child.asset_count || 0) + ')" title="Delete">&#10005;</button>'
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

function openCategoryForm(editId, parentId) {
  var title = editId ? 'Edit Category' : 'New Category';

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

  html += '<button class="btn primary full" onclick="saveCategory(\'' + (editId || '') + '\')">' + (editId ? 'Update' : 'Create') + '</button>';

  openModal(title, html);
}
window.openCategoryForm = openCategoryForm;

async function openCategoryFormEdit(editId) {
  try {
    // Fetch all to find the one we need
    var result = await API.getCategories();
    var all = result.flat || [];
    var cat = all.find(function(c) { return c.id === editId; });
    if (!cat) { toast('Category not found', 'error'); return; }

    openCategoryForm(editId);

    // Fill in values after modal is rendered
    setTimeout(function() {
      document.getElementById('cf-name').value = cat.name;
      document.getElementById('cf-prefix').value = cat.prefix;
      if (document.getElementById('cf-icon')) document.getElementById('cf-icon').value = cat.icon || '';
      var parentEl = document.getElementById('cf-parent');
      if (parentEl && parentEl.tagName === 'SELECT') parentEl.value = cat.parent_id || '';
    }, 50);
  } catch(e) { toast('Failed to load category', 'error'); }
}
window.openCategoryFormEdit = openCategoryFormEdit;

async function saveCategory(editId) {
  var name = document.getElementById('cf-name').value.trim();
  var prefix = document.getElementById('cf-prefix').value.trim().toUpperCase();
  if (!name || !prefix) { toast('Name and prefix are required', 'error'); return; }

  var data = {
    name: name,
    prefix: prefix,
    icon: document.getElementById('cf-icon').value.trim() || null,
    parent_id: document.getElementById('cf-parent').value || null
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
