// ─── Step 8: Locations Management ──────────────

Router.register('/locations', function() {
  var el = document.getElementById('view-locations');
  el.innerHTML = '<div class="toolbar">'
    + '<div class="toolbar-right">'
    + '<button class="btn primary sm" onclick="openLocationForm()">+ New Location</button>'
    + '</div></div>'
    + '<div id="locations-grid">' + skeleton(4) + '</div>';

  loadLocations();
});

async function loadLocations() {
  var gridEl = document.getElementById('locations-grid');
  if (!API.baseUrl) {
    gridEl.innerHTML = '<div class="view-placeholder">'
      + '<div class="view-placeholder-icon">&#128205;</div>'
      + '<div class="view-placeholder-title">Locations</div>'
      + '<div class="view-placeholder-sub">Configure your API endpoint in Settings to manage locations</div></div>';
    return;
  }

  try {
    var result = await API.getLocations();
    var data = result.data || [];

    if (!data.length) {
      gridEl.innerHTML = '<div class="table-empty">No locations found</div>';
      return;
    }

    var typeIcons = { office: '🏢', depot: '🏗️', agency: '🏛️', remote: '📡', storage: '📦' };

    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">';
    data.forEach(function(loc) {
      var icon = typeIcons[loc.type] || '📍';
      var count = loc.asset_count || 0;

      html += '<div class="card" style="cursor:pointer" onclick="viewLocation(\'' + esc(loc.id) + '\')">'
        + '<div class="card-body">'
        + '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">'
        + '<div style="display:flex;align-items:center;gap:10px">'
        + '<span style="font-size:24px">' + icon + '</span>'
        + '<div>'
        + '<div style="font-size:15px;font-weight:600">' + esc(loc.name) + '</div>'
        + '<div style="font-size:11px;font-family:var(--mono);color:var(--text3);text-transform:uppercase">' + esc(loc.type) + '</div>'
        + '</div></div>'
        + '<span class="badge' + (count > 0 ? ' deployed' : ' retired') + '" style="font-size:10px">' + count + ' asset' + (count !== 1 ? 's' : '') + '</span>'
        + '</div>'
        + '<div style="font-size:12px;color:var(--text2)">' + esc(loc.address || 'No address on file') + '</div>'
        + (loc.notes ? '<div style="font-size:11px;color:var(--text3);margin-top:6px;font-family:var(--mono)">' + esc(loc.notes) + '</div>' : '')
        + '<div style="display:flex;gap:6px;margin-top:12px">'
        + '<button class="btn sm" onclick="event.stopPropagation();openLocationForm(\'' + esc(loc.id) + '\')">Edit</button>'
        + '<button class="btn sm danger" onclick="event.stopPropagation();deleteLocationConfirm(\'' + esc(loc.id) + '\',\'' + esc(loc.name) + '\',' + count + ')">Delete</button>'
        + '</div>'
        + '</div></div>';
    });
    html += '</div>';

    gridEl.innerHTML = html;
  } catch(e) {
    gridEl.innerHTML = '<div class="table-empty">Failed to load locations</div>';
  }
}

async function viewLocation(id) {
  if (!API.baseUrl) return;

  try {
    var loc = await API.getLocation(id);

    var html = '<div style="margin-bottom:12px">'
      + '<div style="font-size:18px;font-weight:700">' + esc(loc.name) + '</div>'
      + '<div style="font-size:12px;font-family:var(--mono);color:var(--text3)">' + esc(loc.address || '') + ' &middot; ' + esc(loc.type) + '</div>'
      + '</div>';

    if (loc.assets && loc.assets.length) {
      html += '<div class="table-wrap"><table><thead><tr>'
        + '<th>Tag</th><th>Name</th><th>Category</th><th>Status</th><th>Assigned To</th></tr></thead><tbody>';
      loc.assets.forEach(function(a) {
        html += '<tr style="cursor:pointer" onclick="closeModal();navigate(\'#/assets/' + esc(a.id) + '\')">'
          + '<td class="mono">' + esc(a.asset_tag) + '</td>'
          + '<td>' + esc(a.name) + '</td>'
          + '<td>' + esc(a.category_name || '—') + '</td>'
          + '<td>' + statusBadge(a.status) + '</td>'
          + '<td>' + esc(a.assigned_to_name || '—') + '</td>'
          + '</tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div class="table-empty">No assets at this location</div>';
    }

    openModal(loc.name + ' — Assets', html);
  } catch(e) { toast('Failed to load location', 'error'); }
}
window.viewLocation = viewLocation;

// ─── Location Form (Create / Edit) ────────────

async function openLocationForm(editId) {
  var loc = null;
  var title = 'New Location';

  if (editId) {
    try {
      loc = await API.getLocation(editId);
      title = 'Edit Location';
    } catch(e) { toast('Could not load location', 'error'); return; }
  }

  var html = '<div class="form-group"><label class="form-label">Name</label>'
    + '<input type="text" id="lf-name" class="form-input" value="' + esc(loc ? loc.name : '') + '" placeholder="e.g. Council Chambers"></div>';

  html += '<div class="form-group"><label class="form-label">Address</label>'
    + '<input type="text" id="lf-address" class="form-input" value="' + esc(loc ? loc.address : '') + '" placeholder="Full address"></div>';

  html += '<div class="form-group"><label class="form-label">Type</label>'
    + '<select id="lf-type" class="form-select">';
  ['office', 'depot', 'agency', 'remote', 'storage'].forEach(function(t) {
    html += '<option value="' + t + '"' + (loc && loc.type === t ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
  });
  html += '</select></div>';

  html += '<div class="form-group"><label class="form-label">Notes</label>'
    + '<textarea id="lf-notes" class="form-textarea" placeholder="Optional notes">' + esc(loc ? loc.notes || '' : '') + '</textarea></div>';

  html += '<button class="btn primary full" onclick="saveLocation(\'' + (editId || '') + '\')">' + (editId ? 'Update' : 'Create Location') + '</button>';

  openModal(title, html);
}
window.openLocationForm = openLocationForm;

async function saveLocation(editId) {
  var name = document.getElementById('lf-name').value.trim();
  if (!name) { toast('Name is required', 'error'); return; }

  var data = {
    name: name,
    address: document.getElementById('lf-address').value.trim() || null,
    type: document.getElementById('lf-type').value,
    notes: document.getElementById('lf-notes').value.trim() || null
  };

  try {
    if (editId) {
      await API.updateLocation(editId, data);
      closeModal();
      toast('Location updated', 'success');
    } else {
      await API.createLocation(data);
      closeModal();
      toast('Location created', 'success');
    }
    loadLocations();
  } catch(e) { /* toasted */ }
}
window.saveLocation = saveLocation;

async function deleteLocationConfirm(id, name, assetCount) {
  if (assetCount > 0) {
    toast('Cannot delete — ' + assetCount + ' assets still at this location', 'error');
    return;
  }
  var ok = await confirmDialog('Delete location <strong>' + esc(name) + '</strong>?', 'Delete');
  if (!ok) return;
  try {
    await API.deleteLocation(id);
    toast('Location deleted', 'success');
    loadLocations();
  } catch(e) { /* toasted */ }
}
window.deleteLocationConfirm = deleteLocationConfirm;
