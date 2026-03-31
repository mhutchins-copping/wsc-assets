// ─── Audits View ───────────────────────────────

Router.register('/audits', function(param) {
  if (param) {
    renderAuditDetail(param);
    return;
  }

  var el = document.getElementById('view-audits');
  el.innerHTML = '<div class="view-placeholder">'
    + '<div class="view-placeholder-icon">&#9989;</div>'
    + '<div class="view-placeholder-title">Audits</div>'
    + '<div class="view-placeholder-sub">Asset auditing with QR scanning — Phase 2</div></div>';
});

function renderAuditDetail(id) {
  var el = document.getElementById('view-audit-detail');
  el.innerHTML = '<div class="view-placeholder">'
    + '<div class="view-placeholder-icon">&#9989;</div>'
    + '<div class="view-placeholder-title">Audit Detail</div>'
    + '<div class="view-placeholder-sub">Audit ' + esc(id) + ' — Phase 2</div></div>';
}
