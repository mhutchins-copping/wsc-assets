// WSC Assets — Entry Point
import './css/app.css';

function setTheme(mode) {
  mode = mode || 'light';
  document.documentElement.setAttribute('data-theme', mode);
  localStorage.setItem('wsc_theme', mode);
}
window.setTheme = setTheme;

import './js/utils.js';
import './js/db.js';
import './js/auth.js';
import './js/router.js';
import './js/components.js';
import './js/qr.js';
import './js/dashboard.js';
import './js/assets.js';
import './js/checkout.js';
import './js/people.js';
import './js/categories.js';
import './js/audits.js';
import './js/reports.js';
import './js/issues.js';
import './js/flags.js';
import './js/loans.js';
import './js/phoneEnrol.js';
import './js/runbook.js';
import './js/settings.js';
import './js/account.js';
