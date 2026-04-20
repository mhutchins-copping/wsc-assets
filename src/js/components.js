// ─── Reusable UI Components ────────────────────

// Render a data table
function renderTable(opts) {
  var columns = opts.columns;  // [{key, label, sortable, render, mono}]
  var data = opts.data || [];
  var onSort = opts.onSort;
  var sortKey = opts.sortKey || '';
  var sortDir = opts.sortDir || 'asc';
  var onRowClick = opts.onRowClick; // function(row)
  var emptyMsg = opts.emptyMsg || 'No data';
  var wrapClass = opts.wrapClass ? ' ' + opts.wrapClass : '';

  var html = '<div class="table-wrap' + wrapClass + '"><table><thead><tr>';

  columns.forEach(function(col) {
    var sorted = sortKey === col.key;
    var cls = sorted ? ' class="sorted"' : '';
    var arrow = sorted ? (sortDir === 'asc' ? ' <span class="sort-arrow">&#9650;</span>' : ' <span class="sort-arrow">&#9660;</span>') : '';
    var onclick = col.sortable && onSort ? ' onclick="' + onSort + '(\'' + col.key + '\')"' : '';
    // labelHtml lets callers inject controls (e.g. a select-all checkbox)
    // into the header cell. Falls back to the escaped label otherwise.
    var labelMarkup = col.labelHtml != null ? col.labelHtml : esc(col.label);
    html += '<th' + cls + onclick + '>' + labelMarkup + arrow + '</th>';
  });

  html += '</tr></thead><tbody>';

  if (data.length === 0) {
    html += '<tr><td colspan="' + columns.length + '" class="table-empty">' + esc(emptyMsg) + '</td></tr>';
  } else {
    data.forEach(function(row) {
      var click = onRowClick ? ' onclick="' + onRowClick + '(\'' + esc(row.id) + '\')" style="cursor:pointer"' : '';
      html += '<tr' + click + '>';
      columns.forEach(function(col) {
        var cls = col.mono ? ' class="mono"' : '';
        var val = col.render ? col.render(row) : esc(row[col.key] || '—');
        html += '<td' + cls + '>' + val + '</td>';
      });
      html += '</tr>';
    });
  }

  html += '</tbody></table></div>';
  return html;
}
window.renderTable = renderTable;

// Render pagination controls
function renderPagination(opts) {
  var page = opts.page || 1;
  var pages = opts.pages || 1;
  var total = opts.total || 0;
  var onPage = opts.onPage; // function name string

  if (pages <= 1) return '<div class="pagination"><span>' + total + ' items</span></div>';

  var html = '<div class="pagination">';
  html += '<span>Page ' + page + ' of ' + pages + ' (' + total + ' items)</span>';
  html += '<div class="pagination-btns">';

  html += '<button ' + (page <= 1 ? 'disabled' : 'onclick="' + onPage + '(' + (page - 1) + ')"') + '>&laquo;</button>';

  // Show page buttons
  var start = Math.max(1, page - 2);
  var end = Math.min(pages, page + 2);

  for (var i = start; i <= end; i++) {
    html += '<button' + (i === page ? ' class="active"' : '') + ' onclick="' + onPage + '(' + i + ')">' + i + '</button>';
  }

  html += '<button ' + (page >= pages ? 'disabled' : 'onclick="' + onPage + '(' + (page + 1) + ')"') + '>&raquo;</button>';
  html += '</div></div>';

  return html;
}
window.renderPagination = renderPagination;

// Render filter pills
function renderFilters(opts) {
  var filters = opts.filters; // [{value, label}]
  var active = opts.active || '';
  var onClick = opts.onClick; // function name string

  var html = '<div class="filter-bar">';
  filters.forEach(function(f) {
    var cls = f.value === active ? ' active' : '';
    html += '<button class="filter-pill' + cls + '" onclick="' + onClick + '(\'' + esc(f.value) + '\')">' + esc(f.label) + '</button>';
  });
  html += '</div>';
  return html;
}
window.renderFilters = renderFilters;

// Searchable dropdown helper (renders into a modal body)
function searchDropdown(opts) {
  var items = opts.items;  // [{id, label, sub}]
  var onSelect = opts.onSelect; // function name
  var placeholder = opts.placeholder || 'Search...';

  var html = '<input type="text" class="form-input" placeholder="' + esc(placeholder) + '" oninput="filterDropdown(this)" style="margin-bottom:12px">';
  html += '<div class="dropdown-list" style="max-height:300px;overflow-y:auto">';
  items.forEach(function(item) {
    html += '<div class="dropdown-item" data-search="' + esc((item.label + ' ' + (item.sub || '')).toLowerCase()) + '" onclick="' + onSelect + '(\'' + esc(item.id) + '\')" style="padding:10px 12px;cursor:pointer;border-radius:6px;transition:background 0.15s"'
      + ' onmouseover="this.style.background=\'var(--surface2)\'" onmouseout="this.style.background=\'transparent\'">'
      + '<div style="font-weight:500">' + esc(item.label) + '</div>'
      + (item.sub ? '<div style="font-size:11px;font-family:var(--mono);color:var(--text3)">' + esc(item.sub) + '</div>' : '')
      + '</div>';
  });
  html += '</div>';
  return html;
}
window.searchDropdown = searchDropdown;

function filterDropdown(input) {
  var q = input.value.toLowerCase();
  var items = input.parentElement.querySelectorAll('.dropdown-item');
  items.forEach(function(el) {
    el.style.display = el.dataset.search.includes(q) ? '' : 'none';
  });
}
window.filterDropdown = filterDropdown;
