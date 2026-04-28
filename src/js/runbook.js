// ─── Intune Runbook (admin-only in-app view) ──────────
// Renders docs/INTUNE-RUNBOOK.md inside the asset register so the
// IT officer can reference it without context-switching to GitHub.
// Vite imports the markdown at build time as a raw string; marked
// converts to HTML at view time. Doc edits ship via normal commits
// to docs/INTUNE-RUNBOOK.md - no separate copy to keep in sync.
//
// Access: gated by both the sidebar nav `data-require="admin"` (which
// the auth.js loop hides for non-admins) and the route handler below
// (which redirects non-admins). Defence in depth - same pattern as the
// rest of the admin views.

import { marked } from 'marked';
import runbookMarkdown from '../../docs/INTUNE-RUNBOOK.md?raw';

Router.register('/runbook', renderRunbook);

function renderRunbook() {
  var el = document.getElementById('view-runbook');
  if (!el) return;

  if (!Auth.user || Auth.user.role !== 'admin') {
    el.innerHTML = '<div class="view-placeholder">'
      + '<div class="view-placeholder-icon">&#128274;</div>'
      + '<div class="view-placeholder-title">Admin access required</div>'
      + '<div class="view-placeholder-sub">The IT runbook is restricted to admin role holders.</div>'
      + '</div>';
    return;
  }

  // marked options: GitHub-flavoured-ish, with header IDs so internal
  // anchor links (#prerequisites etc.) work for in-page navigation.
  marked.use({ gfm: true, breaks: false });
  var html = marked.parse(runbookMarkdown);

  el.innerHTML = '<div class="runbook-wrap"><article class="runbook">' + html + '</article></div>';

  // Smooth-scroll to anchor if URL hash points at one. Default browser
  // behaviour breaks because the hash router intercepts. Implement
  // manually for in-doc nav.
  document.querySelectorAll('.runbook a[href^="#"]').forEach(function(a) {
    a.addEventListener('click', function(e) {
      var href = a.getAttribute('href');
      if (href && href.length > 1) {
        var target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });
}
