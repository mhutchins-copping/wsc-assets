// ─── API Client ────────────────────────────────
// Wraps all fetch calls to the Cloudflare Worker API.
//
// Auth order, most-preferred first:
//   1. Cloudflare Access cookie (CF_Authorization) — rides along automatically
//      via credentials:'include'; worker reads Cf-Access-Authenticated-User-Email.
//   2. Session bearer token — short-lived, issued in exchange for the master
//      key. Held in sessionStorage only.
//   3. Legacy X-Api-Key — kept only for scripted callers that predate the
//      bearer-token flow. No UI path writes this any more.

var API = {
  // Default: same-origin (assets.it-wsc.com) so the Cloudflare Access cookie
  // rides along on every request and the edge injects the identity header
  // before the worker runs. Resolved at init() to the real origin so that
  // truthiness checks (e.g. !API.baseUrl) still make sense.
  baseUrl: 'https://assets.it-wsc.com',
  // Break-glass endpoint lives on api.it-wsc.com which is NOT behind CF
  // Access, so the master-key path still works even when SSO is broken.
  directApiUrl: 'https://api.it-wsc.com',
  apiKey: '',   // set at runtime only (e.g. by automation tests); not persisted

  init: function() {
    // Resolve same-origin dynamically so local dev (localhost) also works.
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      this.baseUrl = window.location.origin;
    }
    // Per-tab override for the master-key session — set in sessionStorage
    // by Auth.loginWithMasterKey so master-key users bypass CF Access on
    // api.it-wsc.com even after a page refresh. No user-facing knob to
    // set this directly; it's purely internal to the master-key flow.
    var sessionUrl = sessionStorage.getItem('wsc_api_url');
    if (sessionUrl && sessionUrl.trim()) {
      this.baseUrl = sessionUrl.trim();
    }
    // Legacy: clear pre-existing API URL / key overrides from earlier
    // builds that exposed them via the Settings UI. That UI has been
    // retired -- the API URL is fixed by the deployment, browser users
    // auth via CF Access SSO, and API keys are for scripted callers only.
    localStorage.removeItem('wsc_api_url');
    localStorage.removeItem('wsc_api_key');
  },

  fetch: async function(path, opts) {
    opts = opts || {};
    var url = this.baseUrl + path;
    var headers = {};

    // Prefer the session bearer token over the raw master key. Auth.init()
    // upgrades any stored master key into a token on first successful call.
    var token = Auth && Auth._sessionToken ? Auth._sessionToken : '';
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    } else if (this.apiKey) {
      headers['X-Api-Key'] = this.apiKey;
    }

    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData) && !(opts.body instanceof Blob) && !(opts.body instanceof ArrayBuffer)) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }

    try {
      var res = await fetch(url, {
        method: opts.method || 'GET',
        headers: Object.assign(headers, opts.headers || {}),
        body: opts.body || undefined,
        // Send the Cloudflare Access cookie on cross-origin calls so the worker
        // can read the Cf-Access-Authenticated-User-Email header at the edge.
        credentials: 'include'
      });

      if (!res.ok) {
        var err;
        try { err = await res.json(); } catch(e) { err = { error: res.statusText }; }
        throw new Error(err.error || 'Request failed (' + res.status + ')');
      }

      // Handle CSV export (non-JSON response)
      var ct = res.headers.get('content-type') || '';
      if (ct.includes('text/csv')) return res;

      return res.json();
    } catch(e) {
      if (e.message !== 'Failed to fetch') toast(e.message, 'error');
      throw e;
    }
  },

  // ─── Assets
  getAssets: function(params) { return this.fetch('/api/assets?' + new URLSearchParams(params)); },
  getAsset: function(id) { return this.fetch('/api/assets/' + id); },
  getAssetByTag: function(tag) { return this.fetch('/api/assets/tag/' + encodeURIComponent(tag)); },
  createAsset: function(data) { return this.fetch('/api/assets', { method: 'POST', body: data }); },
  updateAsset: function(id, data) { return this.fetch('/api/assets/' + id, { method: 'PUT', body: data }); },
  deleteAsset: function(id) { return this.fetch('/api/assets/' + id, { method: 'DELETE' }); },
  purgeAsset: function(id) { return this.fetch('/api/assets/' + id + '/purge', { method: 'DELETE' }); },
  checkoutAsset: function(id, data) { return this.fetch('/api/assets/' + id + '/checkout', { method: 'POST', body: data }); },
  checkinAsset: function(id, data) { return this.fetch('/api/assets/' + id + '/checkin', { method: 'POST', body: data }); },
  addMaintenance: function(id, data) { return this.fetch('/api/assets/' + id + '/maintenance', { method: 'POST', body: data }); },
  getNextTag: function(prefix) { return this.fetch('/api/assets/next-tag/' + encodeURIComponent(prefix)); },

  // ─── People
  getPeople: function(params) { return this.fetch('/api/people?' + new URLSearchParams(params || {})); },
  getPerson: function(id) { return this.fetch('/api/people/' + id); },
  createPerson: function(data) { return this.fetch('/api/people', { method: 'POST', body: data }); },
  updatePerson: function(id, data) { return this.fetch('/api/people/' + id, { method: 'PUT', body: data }); },
  deletePerson: function(id) { return this.fetch('/api/people/' + id, { method: 'DELETE' }); },

  // ─── Categories
  getCategories: function() { return this.fetch('/api/categories'); },
  createCategory: function(data) { return this.fetch('/api/categories', { method: 'POST', body: data }); },
  updateCategory: function(id, data) { return this.fetch('/api/categories/' + id, { method: 'PUT', body: data }); },
  deleteCategory: function(id) { return this.fetch('/api/categories/' + id, { method: 'DELETE' }); },

  // ─── Activity
  getActivity: function(params) { return this.fetch('/api/activity?' + new URLSearchParams(params || {})); },

  // ─── Audits
  getAudits: function() { return this.fetch('/api/audits'); },
  getAudit: function(id) { return this.fetch('/api/audits/' + id); },
  startAudit: function(data) { return this.fetch('/api/audits', { method: 'POST', body: data }); },
  scanAudit: function(id, data) { return this.fetch('/api/audits/' + id + '/scan', { method: 'POST', body: data }); },
  completeAudit: function(id) { return this.fetch('/api/audits/' + id + '/complete', { method: 'POST', body: {} }); },
  deleteAudit: function(id) { return this.fetch('/api/audits/' + id, { method: 'DELETE' }); },

  // ─── Stats & Reports
  getStats: function() { return this.fetch('/api/stats'); },
  getReports: function() { return this.fetch('/api/reports'); },

  // ─── Import/Export
  importCSV: function(csvText) { return this.fetch('/api/import/csv', { method: 'POST', body: csvText, headers: { 'Content-Type': 'text/plain' } }); },
  exportCSV: function(params) { return this.fetch('/api/export/csv?' + new URLSearchParams(params || {})); },

  // ─── Entra ID Sync
  // The worker reads Entra credentials from its own secrets; the frontend
  // only tells it which domain to scope the import to.
  syncEntra: function(opts) {
    return this.fetch('/api/people/sync-entra', {
      method: 'POST',
      body: opts || {}
    });
  },
  entraStatus: function() { return this.fetch('/api/settings/entra-status'); },

  // ─── Auth (session management)
  signOut: function() { return this.fetch('/api/auth/sign-out', { method: 'POST' }); },

  // ─── Asset Issues (signing receipts)
  issueAsset: function(assetId, data) {
    return this.fetch('/api/assets/' + assetId + '/issue', { method: 'POST', body: data || {} });
  },
  getIssues: function(params) {
    return this.fetch('/api/issues?' + new URLSearchParams(params || {}));
  },
  getIssue: function(id) { return this.fetch('/api/issues/' + id); },
  resendIssue: function(id) { return this.fetch('/api/issues/' + id + '/resend', { method: 'POST', body: {} }); },
  cancelIssue: function(id) { return this.fetch('/api/issues/' + id + '/cancel', { method: 'POST', body: {} }); },

  // ─── Asset Flags (user-filed fault reports)
  flagAsset: function(assetId, data) {
    return this.fetch('/api/assets/' + assetId + '/flag', { method: 'POST', body: data || {} });
  },
  getFlags: function(params) {
    return this.fetch('/api/flags?' + new URLSearchParams(params || {}));
  },
  resolveFlag: function(id, notes) {
    return this.fetch('/api/flags/' + id + '/resolve', { method: 'POST', body: { notes: notes || '' } });
  },
  dismissFlag: function(id, notes) {
    return this.fetch('/api/flags/' + id + '/dismiss', { method: 'POST', body: { notes: notes || '' } });
  },

  // ─── Loaner pool
  getLoans: function(params) {
    return this.fetch('/api/loans?' + new URLSearchParams(params || {}));
  },
  startLoan: function(assetId, data) {
    return this.fetch('/api/assets/' + assetId + '/loan', { method: 'POST', body: data || {} });
  },
  returnLoan: function(loanId) {
    return this.fetch('/api/loans/' + loanId + '/return', { method: 'POST', body: {} });
  },

  // ─── Images (R2)
  uploadImage: async function(assetId, file) {
    // Sanitise both halves of the key so it passes the worker's strict regex
    // (letters/digits/_/- in the prefix, plus . in the filename).
    var safeAsset = String(assetId || '').replace(/[^A-Za-z0-9_-]/g, '');
    var extMatch = /\.([A-Za-z0-9]{1,8})$/.exec(file.name || '');
    var ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
    var key = safeAsset + '/' + Date.now() + '.' + ext;
    try {
      await this.fetch('/images/' + key, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'image/jpeg' }
      });
      return '/images/' + key;
    } catch(e) {
      throw e;
    }
  },

};

API.init();
window.API = API;
