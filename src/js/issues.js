// ─── Receipts / Issues (admin view) ────────────

var issuesState = {
  status: ''   // '', 'pending', 'signed', 'cancelled', 'expired'
};

Router.register('/issues', function() { renderIssuesList(); });

function renderIssuesList() {
  var el = document.getElementById('view-issues');
  if (!el) return;
  el.innerHTML = '<div class="toolbar">'
    + '<div class="toolbar-left"><h2 style="margin:0;font-size:18px">Receipts</h2></div>'
    + '<div class="toolbar-right">'
    + '<button class="btn sm" onclick="loadIssues()">Refresh</button>'
    + '</div></div>'
    + '<div id="issues-filters"></div>'
    + '<div id="issues-table">' + skeleton(6) + '</div>';
  renderIssuesFilters();
  loadIssues();
}

function renderIssuesFilters() {
  // Cancelled status intentionally omitted -- cancel now deletes the row
  // so there are never any rows to filter to.
  var filters = [
    { value: '', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'signed', label: 'Signed' },
    { value: 'expired', label: 'Expired' }
  ];
  document.getElementById('issues-filters').innerHTML = renderFilters({
    filters: filters, active: issuesState.status, onClick: 'filterIssuesStatus'
  });
}

function filterIssuesStatus(status) {
  issuesState.status = status;
  loadIssues();
  renderIssuesFilters();
}
window.filterIssuesStatus = filterIssuesStatus;

async function loadIssues() {
  var tableEl = document.getElementById('issues-table');
  if (!tableEl) return;
  try {
    var params = {};
    if (issuesState.status) params.status = issuesState.status;
    var res = await API.getIssues(params);
    var rows = res.data || [];

    var columns = [
      { key: 'asset_tag', label: 'Asset', mono: true, render: function(r) {
        return '<span style="font-family:var(--mono)">' + esc(r.asset_tag) + '</span>'
          + '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + esc(r.asset_name || '') + '</div>';
      }},
      { key: 'person_name', label: 'Recipient', render: function(r) {
        return esc(r.person_name || '')
          + (r.person_email ? '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + esc(r.person_email) + '</div>' : '');
      }},
      { key: 'status', label: 'Status', render: function(r) { return issueStatusBadge(r.status); }},
      { key: 'issued_at', label: 'Issued', render: function(r) {
        return '<span style="font-family:var(--mono);font-size:11px;color:var(--text3)">' + fmtDate(r.issued_at) + '</span>';
      }},
      { key: 'signed_at', label: 'Signed', render: function(r) {
        return r.signed_at ? '<span style="font-family:var(--mono);font-size:11px;color:var(--text3)">' + fmtDate(r.signed_at) + '</span>' : '<span style="color:var(--text3)">—</span>';
      }},
      { key: '__actions', label: 'Actions', render: function(r) {
        var btns = '';
        if (r.status === 'pending' && Auth.isAdmin()) {
          btns += '<button class="btn sm" onclick="event.stopPropagation();resendIssue(\'' + esc(r.id) + '\')">Resend</button>';
          btns += ' <button class="btn sm" onclick="event.stopPropagation();cancelIssueConfirm(\'' + esc(r.id) + '\')">Cancel</button>';
        }
        if (r.status === 'signed') {
          btns += '<button class="btn sm" onclick="event.stopPropagation();viewIssueSignature(\'' + esc(r.id) + '\')">View</button>';
        }
        return btns || '<span style="color:var(--text3)">—</span>';
      }}
    ];

    tableEl.innerHTML = renderTable({
      columns: columns,
      data: rows,
      emptyMsg: 'No receipts yet',
      wrapClass: 'issues-table'
    });
  } catch(e) {
    tableEl.innerHTML = '<div class="table-empty">Failed to load receipts</div>';
  }
}
window.loadIssues = loadIssues;

function issueStatusBadge(status) {
  var bg, color;
  switch (status) {
    case 'pending':   bg = '#fef3c7'; color = '#92400e'; break;
    case 'signed':    bg = '#d1fae5'; color = '#065f46'; break;
    case 'expired':   bg = '#fee2e2'; color = '#991b1b'; break;
    case 'cancelled': bg = '#e5e7eb'; color = '#4b5563'; break;
    default:          bg = '#e5e7eb'; color = '#4b5563';
  }
  return '<span style="background:' + bg + ';color:' + color + ';padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500;text-transform:capitalize">' + esc(status || 'unknown') + '</span>';
}
window.issueStatusBadge = issueStatusBadge;

async function resendIssue(id) {
  try {
    await API.resendIssue(id);
    toast('Link resent', 'success');
    loadIssues();
  } catch (e) { /* toasted */ }
}
window.resendIssue = resendIssue;

async function cancelIssueConfirm(id) {
  var ok = await confirmDialog('Cancel this signing link? The recipient won\'t be able to sign afterwards.', 'Cancel link');
  if (!ok) return;
  try {
    await API.cancelIssue(id);
    toast('Link cancelled', 'success');
    loadIssues();
  } catch (e) { /* toasted */ }
}
window.cancelIssueConfirm = cancelIssueConfirm;

async function viewIssueSignature(id) {
  try {
    var issue = await API.getIssue(id);
    var sigImg = issue.signature_data_url
      ? '<img src="' + issue.signature_data_url + '" style="max-width:100%;border:1px solid var(--border);border-radius:8px;background:#fff">'
      : '<div style="color:var(--text3)">No signature on file</div>';
    var html = '<div style="font-size:14px">'
      + '<div style="margin-bottom:10px"><strong>' + esc(issue.asset_tag) + '</strong> — ' + esc(issue.asset_name || '') + '</div>'
      + '<div style="margin-bottom:10px"><span style="color:var(--text3)">Signed by:</span> ' + esc(issue.person_name) + (issue.signature_name ? ' (typed: ' + esc(issue.signature_name) + ')' : '') + '</div>'
      + '<div style="margin-bottom:10px"><span style="color:var(--text3)">Date:</span> ' + esc(fmtDate(issue.signed_at || issue.issued_at)) + '</div>'
      + (issue.signature_ip ? '<div style="margin-bottom:10px"><span style="color:var(--text3)">IP:</span> ' + esc(issue.signature_ip) + '</div>' : '')
      + '<div style="margin:14px 0 6px;font-size:12px;color:var(--text3)">Signature</div>'
      + sigImg
      + (issue.terms_text ? '<div style="margin:14px 0 6px;font-size:12px;color:var(--text3)">Terms shown at signing</div><div style="background:var(--surface2,#f5f5f5);padding:10px;border-radius:6px;font-size:12px;line-height:1.5;white-space:pre-wrap">' + esc(issue.terms_text) + '</div>' : '')
      + '</div>';
    openModal('Signed receipt', html);
  } catch (e) { /* toasted */ }
}
window.viewIssueSignature = viewIssueSignature;
