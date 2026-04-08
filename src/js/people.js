// ─── Step 7: People Management ─────────────────

var _peopleSearch = '';
var _peopleDept = '';

Router.register('/people', function(param) {
  if (param) {
    renderPersonDetail(param);
    return;
  }
  renderPeopleList();
});

function renderPeopleList() {
  var el = document.getElementById('view-people');
  el.innerHTML = '<div class="toolbar">'
    + '<div class="toolbar-left">'
    + '<div class="toolbar-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
    + '<input type="text" placeholder="Search people..." value="' + esc(_peopleSearch) + '" oninput="peopleSearchDebounced(this.value)"></div>'
    + '</div>'
    + '<div class="toolbar-right">'
    + '<button class="btn primary sm" onclick="openPersonForm()">+ New Person</button>'
    + '</div></div>'
    + '<div id="people-filters"></div>'
    + '<div id="people-table">' + skeleton(6) + '</div>';

  renderPeopleFilters();
  loadPeople();
}

function renderPeopleFilters() {
  var depts = [
    { value: '', label: 'All Departments' },
    { value: 'Corporate & Community', label: 'Corporate & Community' },
    { value: 'Infrastructure Services', label: 'Infrastructure' },
    { value: 'Finance', label: 'Finance' },
    { value: 'Planning & Environment', label: 'Planning & Environment' },
    { value: 'Water & Sewerage', label: 'Water & Sewerage' },
    { value: 'Executive / GM Office', label: 'Executive' }
  ];
  document.getElementById('people-filters').innerHTML = renderFilters({
    filters: depts,
    active: _peopleDept,
    onClick: 'filterPeopleDept'
  });
}

function filterPeopleDept(dept) {
  _peopleDept = dept;
  loadPeople();
  renderPeopleFilters();
}
window.filterPeopleDept = filterPeopleDept;

var peopleSearchDebounced = debounce(function(val) {
  _peopleSearch = val;
  loadPeople();
}, 200);
window.peopleSearchDebounced = peopleSearchDebounced;

async function loadPeople() {
  var tableEl = document.getElementById('people-table');
  if (!API.baseUrl) {
    tableEl.innerHTML = '<div class="view-placeholder">'
      + '<div class="view-placeholder-icon">&#128101;</div>'
      + '<div class="view-placeholder-title">People</div>'
      + '<div class="view-placeholder-sub">Configure your API endpoint in Settings to manage people</div></div>';
    return;
  }

  try {
    var params = {};
    if (_peopleSearch) params.search = _peopleSearch;
    if (_peopleDept) params.department = _peopleDept;
    var result = await API.getPeople(params);

    var columns = [
      { key: 'name', label: 'Name', sortable: true, render: function(r) {
        return '<div style="font-weight:500">' + esc(r.name) + '</div>';
      }},
      { key: 'email', label: 'Email', mono: true },
      { key: 'department', label: 'Department' },
      { key: 'position', label: 'Position' },
      { key: 'asset_count', label: 'Assets', mono: true, render: function(r) {
        var count = r.asset_count || 0;
        return count > 0 ? '<span style="font-weight:600;color:var(--accent)">' + count + '</span>' : '<span style="color:var(--text3)">0</span>';
      }}
    ];

    tableEl.innerHTML = renderTable({
      columns: columns,
      data: result.data,
      onRowClick: 'viewPerson',
      emptyMsg: 'No people found'
    });
  } catch(e) {
    tableEl.innerHTML = '<div class="table-empty">Failed to load people</div>';
  }
}

function viewPerson(id) { navigate('#/people/' + id); }
window.viewPerson = viewPerson;

// ─── Person Detail ─────────────────────────────

async function renderPersonDetail(id) {
  var el = document.getElementById('view-person-detail');
  el.innerHTML = skeleton(8);

  if (!API.baseUrl) {
    el.innerHTML = '<div class="view-placeholder"><div class="view-placeholder-sub">Configure API in Settings</div></div>';
    return;
  }

  try {
    var person = await API.getPerson(id);

    var html = '<div style="margin-bottom:10px"><button class="btn sm" onclick="navigate(\'#/people\')">&larr; Back</button></div>';

    html += '<div class="detail-header">'
      + '<div class="detail-header-info">'
      + '<div class="detail-header-name">' + esc(person.name) + '</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--text2)">';
    if (person.position) html += '<span>' + esc(person.position) + '</span>';
    if (person.department) html += '<span>&middot; ' + esc(person.department) + '</span>';
    html += '</div></div>'
      + '<div class="detail-header-actions">'
      + '<button class="btn sm" onclick="openPersonForm(\'' + esc(person.id) + '\')">Edit</button>'
      + '<button class="btn danger sm" onclick="deactivatePerson(\'' + esc(person.id) + '\')">Deactivate</button>'
      + '</div></div>';

    // Contact info card
    html += '<div class="card" style="margin-bottom:14px"><div class="card-header"><span class="card-title">Contact Details</span></div>'
      + '<div class="card-body"><div class="detail-grid">'
      + detailFieldP('Email', person.email)
      + detailFieldP('Phone', person.phone)
      + detailFieldP('Department', person.department)
      + detailFieldP('Position', person.position)
      + detailFieldP('Status', person.active ? 'Active' : 'Inactive')
      + '</div></div></div>';

    // Assigned assets
    html += '<div class="card"><div class="card-header"><span class="card-title">Assigned Assets (' + (person.assets ? person.assets.length : 0) + ')</span></div>';

    if (person.assets && person.assets.length) {
      html += '<div style="padding:0"><div class="table-wrap" style="border:none;border-radius:0"><table><thead><tr>'
        + '<th>Tag</th><th>Name</th><th>Category</th></tr></thead><tbody>';
      person.assets.forEach(function(a) {
        html += '<tr style="cursor:pointer" onclick="navigate(\'#/assets/' + esc(a.id) + '\')">'
          + '<td class="mono">' + esc(a.asset_tag) + '</td>'
          + '<td>' + esc(a.name) + '</td>'
          + '<td>' + esc(a.category_name || '—') + '</td>'
          + '</tr>';
      });
      html += '</tbody></table></div></div>';
    } else {
      html += '<div class="card-body"><div class="table-empty">No assets assigned</div></div>';
    }
    html += '</div>';

    // Notes
    if (person.notes) {
      html += '<div class="card" style="margin-top:12px"><div class="card-header"><span class="card-title">Notes</span></div>'
        + '<div class="card-body"><div style="font-size:12px;white-space:pre-wrap;color:var(--text2)">' + esc(person.notes) + '</div></div></div>';
    }

    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<div class="table-empty">Person not found</div>';
  }
}

function detailFieldP(label, value) {
  return '<div><div class="detail-field-label">' + esc(label) + '</div>'
    + '<div class="detail-field-value' + (!value ? ' empty' : '') + '">' + esc(value || '—') + '</div></div>';
}

// ─── Person Form (Create / Edit) ──────────────

async function openPersonForm(editId) {
  var person = null;
  var title = 'New Person';

  if (editId) {
    try {
      person = await API.getPerson(editId);
      title = 'Edit Person';
    } catch(e) { toast('Could not load person', 'error'); return; }
  }

  var html = '<div class="form-group"><label class="form-label">Name</label>'
    + '<input type="text" id="pf-name" class="form-input" value="' + esc(person ? person.name : '') + '" placeholder="Full name"></div>';

  html += '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Email</label>'
    + '<input type="email" id="pf-email" class="form-input" value="' + esc(person ? person.email : '') + '" placeholder="email@walgett.nsw.gov.au"></div>'
    + '<div class="form-group"><label class="form-label">Phone</label>'
    + '<input type="text" id="pf-phone" class="form-input" value="' + esc(person ? person.phone : '') + '" placeholder="Phone number"></div></div>';

  html += '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Department</label>'
    + '<select id="pf-dept" class="form-select">'
    + '<option value="">Select...</option>';
  ['Corporate & Community', 'Infrastructure Services', 'Finance', 'Planning & Environment', 'Water & Sewerage', 'Executive / GM Office'].forEach(function(d) {
    html += '<option value="' + d + '"' + (person && person.department === d ? ' selected' : '') + '>' + d + '</option>';
  });
  html += '</select></div>'
    + '<div class="form-group"><label class="form-label">Position</label>'
    + '<input type="text" id="pf-position" class="form-input" value="' + esc(person ? person.position : '') + '" placeholder="e.g. Admin Officer"></div></div>';

  html += '<div class="form-group"><label class="form-label">Notes</label>'
    + '<textarea id="pf-notes" class="form-textarea" placeholder="Optional notes">' + esc(person ? person.notes || '' : '') + '</textarea></div>';

  html += '<button class="btn primary full" onclick="savePerson(\'' + (editId || '') + '\')">' + (editId ? 'Update' : 'Create Person') + '</button>';

  openModal(title, html);
}
window.openPersonForm = openPersonForm;

async function savePerson(editId) {
  var name = document.getElementById('pf-name').value.trim();
  if (!name) { toast('Name is required', 'error'); return; }

  var data = {
    name: name,
    email: document.getElementById('pf-email').value.trim() || null,
    phone: document.getElementById('pf-phone').value.trim() || null,
    department: document.getElementById('pf-dept').value || null,
    position: document.getElementById('pf-position').value.trim() || null,
    notes: document.getElementById('pf-notes').value.trim() || null
  };

  try {
    if (editId) {
      await API.updatePerson(editId, data);
      closeModal();
      toast('Person updated', 'success');
      renderPersonDetail(editId);
    } else {
      var result = await API.createPerson(data);
      closeModal();
      toast('Person created', 'success');
      // Refresh list if on list view, otherwise navigate
      if (location.hash === '#/people') {
        loadPeople();
      } else {
        navigate('#/people/' + result.id);
      }
    }
  } catch(e) { /* toasted */ }
}
window.savePerson = savePerson;

async function deactivatePerson(id) {
  var ok = await confirmDialog('Deactivate this person? They will no longer appear in dropdown lists.', 'Deactivate');
  if (!ok) return;
  try {
    await API.deletePerson(id);
    toast('Person deactivated', 'success');
    navigate('#/people');
  } catch(e) { /* toasted */ }
}
window.deactivatePerson = deactivatePerson;
