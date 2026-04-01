// ─── API Client ────────────────────────────────
// Wraps all fetch calls to the Cloudflare Worker API

var API = {
  baseUrl: '',  // Set in settings — e.g. 'https://wsc-assets-api.matt-hc.workers.dev'
  apiKey: '',   // Set after login

  init: function() {
    this.baseUrl = localStorage.getItem('wsc_api_url') || '';
    this.apiKey = sessionStorage.getItem('wsc_api_key') || localStorage.getItem('wsc_api_key') || '';
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
    var headers = { 'X-Api-Key': this.apiKey };

    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }

    try {
      var res = await fetch(url, {
        method: opts.method || 'GET',
        headers: Object.assign(headers, opts.headers || {}),
        body: opts.body || undefined
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

  // ─── Locations
  getLocations: function() { return this.fetch('/api/locations'); },
  getLocation: function(id) { return this.fetch('/api/locations/' + id); },
  createLocation: function(data) { return this.fetch('/api/locations', { method: 'POST', body: data }); },
  updateLocation: function(id, data) { return this.fetch('/api/locations/' + id, { method: 'PUT', body: data }); },
  deleteLocation: function(id) { return this.fetch('/api/locations/' + id, { method: 'DELETE' }); },

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

  // ─── Stats
  getStats: function() { return this.fetch('/api/stats'); },

  // ─── Import/Export
  importCSV: function(csvText) { return this.fetch('/api/import/csv', { method: 'POST', body: csvText, headers: { 'Content-Type': 'text/plain' } }); },
  exportCSV: function(params) { return this.fetch('/api/export/csv?' + new URLSearchParams(params || {})); },

  // ─── Images (R2)
  uploadImage: async function(assetId, file) {
    var key = assetId + '/' + Date.now() + '.' + file.name.split('.').pop();
    await this.fetch('/images/' + key, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type }
    });
    return '/images/' + key;
  }
};

API.init();
window.API = API;
