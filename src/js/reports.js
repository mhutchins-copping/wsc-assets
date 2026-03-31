// ─── Reports View ──────────────────────────────

Router.register('/reports', function() {
  var el = document.getElementById('view-reports');
  el.innerHTML = '<div class="view-placeholder">'
    + '<div class="view-placeholder-icon">&#128202;</div>'
    + '<div class="view-placeholder-title">Reports</div>'
    + '<div class="view-placeholder-sub">Asset reports and analytics — Phase 2</div></div>';
});
