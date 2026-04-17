// ─── API Client ────────────────────────────────
// Wraps all fetch calls to the Cloudflare Worker API

var API = {
  baseUrl: 'https://api.it-wsc.com',  // Hardcoded — no per-device config needed
  apiKey: '',   // Optional — origin-based auth used when accessed via Cloudflare Access

  init: function() {
    // Allow override from localStorage (for dev/testing), otherwise use hardcoded default
    this.baseUrl = localStorage.getItem('wsc_api_url') || this.baseUrl;
    this.apiKey = localStorage.getItem('wsc_api_key') || '';
  },

  setUrl: function(url) {
    this.baseUrl = url.replace(/\/+$/, '');
    localStorage.setItem('wsc_api_url', this.baseUrl);
  },

  setKey: function(key) {
    this.apiKey = key;
    localStorage.setItem('wsc_api_key', key);
  },

  fetch: async function(path, opts) {
    opts = opts || {};
    var url = this.baseUrl + path;
    var headers = {};
    // Auth paths:
    //  - Cloudflare Access cookie (CF_Authorization) rides along automatically via credentials:'include'
    //    and the worker reads Cf-Access-Authenticated-User-Email at the edge.
    //  - Master key (break-glass): sent as X-Api-Key.
    //  - Stored API key (scripts/external): sent as X-Api-Key.
    var masterKey = Auth && Auth._masterKey ? Auth._masterKey : '';
    if (masterKey) {
      headers['X-Api-Key'] = masterKey;
    } else if (this.apiKey) {
      headers['X-Api-Key'] = this.apiKey;
    }

    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
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
  syncEntra: function(config) { return this.fetch('/api/people/sync-entra', { method: 'POST', body: config }); },

  // ─── Images (R2)
  uploadImage: async function(assetId, file) {
    // Sanitise both halves of the key so it passes the worker's strict regex
    // (letters/digits/_/- in the prefix, plus . in the filename).
    var safeAsset = String(assetId || '').replace(/[^A-Za-z0-9_-]/g, '');
    var extMatch = /\.([A-Za-z0-9]{1,8})$/.exec(file.name || '');
    var ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
    var key = safeAsset + '/' + Date.now() + '.' + ext;
    await this.fetch('/images/' + key, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'image/jpeg' }
    });
    return '/images/' + key;
  },

  // ─── AI Label Extraction
  extractFromImage: async function(file) {
    // For image upload, we need to use XMLHttpRequest to track progress and handle errors
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      var masterKey = window.Auth && window.Auth._masterKey ? window.Auth._masterKey : '';
      var apiKey = masterKey || API.apiKey;

      xhr.open('POST', API.baseUrl + '/api/assets/extract-from-image', true);
      xhr.setRequestHeader('Content-Type', file.type || 'image/jpeg');
      if (apiKey) {
        xhr.setRequestHeader('X-Api-Key', apiKey);
      }

      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch(e) {
            reject(new Error('Invalid response'));
          }
        } else {
          try {
            var err = JSON.parse(xhr.responseText);
            reject(new Error(err.error || 'Request failed (' + xhr.status + ')'));
          } catch(e) {
            reject(new Error('Request failed (' + xhr.status + ')'));
          }
        }
      };

      xhr.onerror = function() {
        reject(new Error('Network error'));
      };

      xhr.send(file);
    });
  }
};

API.init();
window.API = API;
