// ─── Phone Enrolment ───────────────────────────────
// Mobile-first form for registering a phone in the asset register.
// Works on iOS Safari and Android Chrome without a native app.
//
// IMEI is the canonical phone identifier (goes into serial_number, same
// as BIOS serial does for laptops). Dial *#06# on any phone to see it.
// Barcode scanning via BarcodeDetector is offered when the browser
// supports it (Android Chrome today; iOS Safari 17+); the primary path
// is still paste/type so this works everywhere.

var _phoneState = {
  people: [],
  bcStream: null,
  bcInterval: null
};

Router.register('/phone-enrol', renderPhoneEnrol);
Router.register('/phone-enrol-batch', renderPhoneEnrolBatch);

async function loadPhonePeople() {
  if (_phoneState.people.length) return _phoneState.people;
  try {
    var res = await API.getPeople();
    _phoneState.people = (res.data || []).filter(function(p) { return p.active !== 0; });
  } catch (e) { /* continue without picker */ }
  return _phoneState.people;
}

function peopleOptionsHtml(selected) {
  var html = '<option value="">Not assigned</option>';
  (_phoneState.people || []).forEach(function(p) {
    var sel = selected === p.id ? ' selected' : '';
    html += '<option value="' + esc(p.id) + '"' + sel + '>'
      + esc(p.name + (p.department ? ' — ' + p.department : ''))
      + '</option>';
  });
  return html;
}

async function renderPhoneEnrol() {
  var el = document.getElementById('view-phone-enrol');
  el.innerHTML = phoneEnrolFormHtml();

  autoDetectPhoneFields();

  // Load people for the assignee picker.
  await loadPhonePeople();
  var sel = document.getElementById('phone-assigned');
  if (sel) sel.innerHTML = peopleOptionsHtml(null);
}

function phoneEnrolFormHtml() {
  var barcodeSupported = ('BarcodeDetector' in window);
  return '<div style="max-width:560px;margin:0 auto">'
    + '<div style="margin-bottom:18px;display:flex;justify-content:space-between;align-items:center">'
    + '<button class="btn sm" onclick="history.back()">&larr; Back</button>'
    + '<a class="btn sm" href="#/phone-enrol-batch">Enrol multiple →</a>'
    + '</div>'
    + '<div class="card"><div class="card-header"><span class="card-title">Enrol a phone</span></div>'
    + '<div class="card-body">'
    + '<p style="font-size:13px;color:var(--text2);margin:0 0 16px">Register an iPhone or Android device in the asset register. The IMEI is the phone\'s unique serial.</p>'

    + '<div class="form-group">'
    + '<label class="form-label">IMEI <span style="color:var(--red)">*</span></label>'
    + '<input id="phone-imei" type="tel" inputmode="numeric" maxlength="17" placeholder="15-digit IMEI" class="form-input">'
    + '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">'
    + '<button type="button" class="btn sm" onclick="pastePhoneImei()">Paste</button>'
    + (barcodeSupported ? '<button type="button" class="btn sm" onclick="scanPhoneImei()">Scan barcode</button>' : '')
    + '</div>'
    + '<details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;color:var(--text3)">How to find your IMEI</summary>'
    + '<ul style="font-size:12px;color:var(--text3);line-height:1.7;margin:6px 0 0;padding-left:18px">'
    + '<li>Easiest: dial <strong>*#06#</strong> in your Phone app — IMEI shows on screen. Hold to copy.</li>'
    + '<li>iPhone: Settings → General → About → scroll to IMEI (long-press to copy).</li>'
    + '<li>Android: Settings → About phone → IMEI.</li>'
    + '<li>Or check the SIM tray / under the back cover / the original box.</li>'
    + '</ul></details>'
    + '</div>'

    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Make</label>'
    + '<select id="phone-make" class="form-select">'
    + '<option value="">Select…</option>'
    + '<option value="Apple">Apple</option>'
    + '<option value="Samsung">Samsung</option>'
    + '<option value="Google">Google</option>'
    + '<option value="Oppo">Oppo</option>'
    + '<option value="Nokia">Nokia</option>'
    + '<option value="Other">Other</option>'
    + '</select></div>'

    + '<div class="form-group"><label class="form-label">Model</label>'
    + '<input id="phone-model" type="text" placeholder="e.g. iPhone 15, Galaxy S24" class="form-input">'
    + '</div></div>'

    + '<div class="form-group"><label class="form-label">OS version</label>'
    + '<input id="phone-os" type="text" placeholder="e.g. iOS 18.1, Android 14" class="form-input">'
    + '</div>'

    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Phone number</label>'
    + '<input id="phone-number" type="tel" placeholder="04XX XXX XXX" class="form-input">'
    + '</div>'

    + '<div class="form-group"><label class="form-label">Carrier</label>'
    + '<select id="phone-carrier" class="form-select">'
    + '<option value="">Select…</option>'
    + '<option value="Telstra">Telstra</option>'
    + '<option value="Optus">Optus</option>'
    + '<option value="Vodafone">Vodafone</option>'
    + '<option value="TPG">TPG</option>'
    + '<option value="Other">Other</option>'
    + '</select></div></div>'

    + '<div class="form-group"><label class="form-label">Assigned to</label>'
    + '<select id="phone-assigned" class="form-select">'
    + '<option value="">Not assigned</option>'
    + '</select></div>'

    + '<div class="form-group"><label class="form-label">Notes</label>'
    + '<textarea id="phone-notes" class="form-textarea" rows="2" placeholder="Optional — condition, accessories, etc."></textarea>'
    + '</div>'

    + '<button class="btn primary full" onclick="savePhone()" id="phone-save-btn">Enrol phone</button>'
    + '<div id="phone-save-result" style="margin-top:10px"></div>'
    + '</div></div></div>';
}

// Best-effort prefill from user-agent data.
function autoDetectPhoneFields() {
  var ua = navigator.userAgent || '';
  var makeSel = document.getElementById('phone-make');
  var osInput = document.getElementById('phone-os');
  if (!makeSel || !osInput) return;

  if (/iPhone|iPad|iPod/.test(ua)) {
    makeSel.value = 'Apple';
    var m = ua.match(/OS (\d+)[_\.](\d+)(?:[_\.](\d+))?/);
    if (m) osInput.value = 'iOS ' + m[1] + '.' + m[2] + (m[3] ? '.' + m[3] : '');
  } else if (/Android/.test(ua)) {
    var androidVer = ua.match(/Android (\d+(?:\.\d+)?)/);
    if (androidVer) osInput.value = 'Android ' + androidVer[1];
    if (/Samsung|SM-/.test(ua)) makeSel.value = 'Samsung';
    else if (/Pixel/.test(ua)) makeSel.value = 'Google';
    else if (/Oppo|OPPO/.test(ua)) makeSel.value = 'Oppo';
  }
}

async function pastePhoneImei() {
  try {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      toast('Clipboard access not available — paste manually', 'error');
      return;
    }
    var text = await navigator.clipboard.readText();
    var digits = (text || '').replace(/\D/g, '');
    if (digits.length < 14 || digits.length > 16) {
      toast('That doesn\'t look like an IMEI (need 15 digits)', 'error');
      return;
    }
    document.getElementById('phone-imei').value = digits.slice(0, 15);
  } catch (e) {
    toast('Clipboard blocked — paste manually', 'error');
  }
}
window.pastePhoneImei = pastePhoneImei;

// Camera-driven barcode scan. BarcodeDetector is Chromium-only; iOS
// Safari added partial support in 17+. Falls back gracefully when the
// API or the camera aren't available.
async function scanPhoneImei() {
  if (!('BarcodeDetector' in window)) {
    toast('Barcode scanning not supported in this browser', 'error');
    return;
  }
  var html = '<div style="text-align:center">'
    + '<video id="bc-video" playsinline muted autoplay style="width:100%;max-width:420px;border-radius:8px;background:#000;display:block;margin:0 auto"></video>'
    + '<p style="font-size:12px;color:var(--text3);margin:8px 0 12px">Aim the camera at the IMEI barcode</p>'
    + '<button class="btn" onclick="closeModal();stopBarcodeScan()">Cancel</button>'
    + '</div>';
  openModal('Scan IMEI', html);

  try {
    _phoneState.bcStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }
    });
    var video = document.getElementById('bc-video');
    if (!video) { stopBarcodeScan(); return; }
    video.srcObject = _phoneState.bcStream;
    await video.play();

    var detector = new window.BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13'] });
    _phoneState.bcInterval = setInterval(async function () {
      try {
        var barcodes = await detector.detect(video);
        for (var i = 0; i < barcodes.length; i++) {
          var raw = (barcodes[i].rawValue || '').replace(/\D/g, '');
          if (raw.length >= 15) {
            var imei = raw.slice(0, 15);
            document.getElementById('phone-imei').value = imei;
            closeModal();
            stopBarcodeScan();
            toast('IMEI scanned: ' + imei, 'success');
            return;
          }
        }
      } catch (e) { /* keep trying */ }
    }, 400);
  } catch (e) {
    stopBarcodeScan();
    closeModal();
    toast('Camera denied or unavailable', 'error');
  }
}
window.scanPhoneImei = scanPhoneImei;

function stopBarcodeScan() {
  if (_phoneState.bcInterval) { clearInterval(_phoneState.bcInterval); _phoneState.bcInterval = null; }
  if (_phoneState.bcStream) {
    _phoneState.bcStream.getTracks().forEach(function(t) { t.stop(); });
    _phoneState.bcStream = null;
  }
}
window.stopBarcodeScan = stopBarcodeScan;

// ─── Batch enrolment ─────────────────────────────
// Shared (Make / Model / OS / Carrier) set once, per-unit rows (IMEI /
// phone number / assignee) repeated. Submits sequentially so the
// auto-tag generator (which reads the latest tag and increments) can't
// collide on two parallel inserts claiming the same number.

var _batchRowCounter = 0;

async function renderPhoneEnrolBatch() {
  var el = document.getElementById('view-phone-enrol');
  _batchRowCounter = 0;
  el.innerHTML = batchFormHtml();
  await loadPhonePeople();
  // Seed with three blank rows so the form looks populated on first
  // render; user can add more.
  for (var i = 0; i < 3; i++) addBatchRow();
}

function batchFormHtml() {
  return '<div style="max-width:820px;margin:0 auto">'
    + '<div style="margin-bottom:18px;display:flex;justify-content:space-between;align-items:center">'
    + '<button class="btn sm" onclick="history.back()">&larr; Back</button>'
    + '<a class="btn sm" href="#/phone-enrol">Single enrol</a>'
    + '</div>'
    + '<div class="card"><div class="card-header"><span class="card-title">Enrol multiple phones</span></div>'
    + '<div class="card-body">'
    + '<p style="font-size:13px;color:var(--text2);margin:0 0 16px">Set the shared details once, then add a row per device. IMEI is required per device; everything else is optional. Click <strong>Enrol all</strong> at the bottom when ready.</p>'

    // Shared fields.
    + '<div style="background:var(--surface2);padding:14px;border-radius:8px;margin-bottom:16px">'
    + '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Shared across this batch</div>'
    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">Make</label>'
    + '<select id="batch-make" class="form-select">'
    + '<option value="">—</option>'
    + '<option value="Apple">Apple</option>'
    + '<option value="Samsung">Samsung</option>'
    + '<option value="Google">Google</option>'
    + '<option value="Oppo">Oppo</option>'
    + '<option value="Nokia">Nokia</option>'
    + '<option value="Other">Other</option>'
    + '</select></div>'
    + '<div class="form-group"><label class="form-label">Model</label>'
    + '<input type="text" id="batch-model" class="form-input" placeholder="e.g. iPhone 15, Galaxy S24"></div>'
    + '</div>'
    + '<div class="form-row">'
    + '<div class="form-group"><label class="form-label">OS</label>'
    + '<input type="text" id="batch-os" class="form-input" placeholder="e.g. iOS 18.1, Android 14"></div>'
    + '<div class="form-group"><label class="form-label">Carrier</label>'
    + '<select id="batch-carrier" class="form-select">'
    + '<option value="">—</option>'
    + '<option value="Telstra">Telstra</option>'
    + '<option value="Optus">Optus</option>'
    + '<option value="Vodafone">Vodafone</option>'
    + '<option value="TPG">TPG</option>'
    + '<option value="Other">Other</option>'
    + '</select></div></div>'
    + '</div>'

    // Rows.
    + '<div id="batch-rows"></div>'
    + '<button class="btn sm" onclick="addBatchRow()" style="margin-top:8px">+ Add another phone</button>'

    // Submit + progress.
    + '<div style="margin-top:20px">'
    + '<button class="btn primary full" id="batch-submit" onclick="submitBatch()">Enrol all</button>'
    + '<div id="batch-progress" style="margin-top:12px"></div>'
    + '<div id="batch-summary" style="margin-top:12px"></div>'
    + '</div>'

    + '</div></div></div>';
}

function addBatchRow() {
  var i = ++_batchRowCounter;
  var container = document.getElementById('batch-rows');
  if (!container) return;
  var row = document.createElement('div');
  row.className = 'batch-row';
  row.dataset.rowId = String(i);
  row.style.cssText = 'display:grid;grid-template-columns:1.3fr 1fr 1.3fr auto;gap:8px;align-items:end;margin-bottom:10px;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:8px';
  var barcodeSupported = ('BarcodeDetector' in window);
  row.innerHTML =
      '<div><label class="form-label" style="font-size:11px">IMEI <span style="color:var(--red)">*</span></label>'
    +   '<input type="tel" inputmode="numeric" maxlength="17" class="form-input bi-imei" placeholder="15-digit IMEI" style="font-size:16px">'
    +   (barcodeSupported ? '<button type="button" class="btn sm" style="margin-top:4px;padding:4px 8px;font-size:11px" onclick="scanBatchImei(' + i + ')">Scan</button>' : '')
    + '</div>'
    + '<div><label class="form-label" style="font-size:11px">Phone no.</label>'
    +   '<input type="tel" class="form-input bi-number" placeholder="04XX XXX XXX" style="font-size:16px"></div>'
    + '<div><label class="form-label" style="font-size:11px">Assigned to</label>'
    +   '<select class="form-select bi-assigned" style="font-size:14px">' + peopleOptionsHtml(null) + '</select></div>'
    + '<div><button type="button" class="btn sm" title="Remove row" onclick="removeBatchRow(' + i + ')" style="padding:8px 10px;color:var(--red)">&times;</button></div>';
  container.appendChild(row);
  updateBatchSubmitLabel();
}
window.addBatchRow = addBatchRow;

function removeBatchRow(rowId) {
  var row = document.querySelector('.batch-row[data-row-id="' + rowId + '"]');
  if (row) row.remove();
  updateBatchSubmitLabel();
}
window.removeBatchRow = removeBatchRow;

function updateBatchSubmitLabel() {
  var btn = document.getElementById('batch-submit');
  if (!btn) return;
  var count = document.querySelectorAll('#batch-rows .batch-row').length;
  btn.textContent = count ? 'Enrol all ' + count + ' phone' + (count === 1 ? '' : 's') : 'Enrol all';
}

// Barcode scan for a specific row. Reuses the module-level stream/timer
// plumbing so only one scan can run at a time.
async function scanBatchImei(rowId) {
  if (!('BarcodeDetector' in window)) {
    toast('Barcode scanning not supported in this browser', 'error');
    return;
  }
  var html = '<div style="text-align:center">'
    + '<video id="bc-video" playsinline muted autoplay style="width:100%;max-width:420px;border-radius:8px;background:#000;display:block;margin:0 auto"></video>'
    + '<p style="font-size:12px;color:var(--text3);margin:8px 0 12px">Aim the camera at the IMEI barcode</p>'
    + '<button class="btn" onclick="closeModal();stopBarcodeScan()">Cancel</button>'
    + '</div>';
  openModal('Scan IMEI', html);

  try {
    _phoneState.bcStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
    var video = document.getElementById('bc-video');
    if (!video) { stopBarcodeScan(); return; }
    video.srcObject = _phoneState.bcStream;
    await video.play();
    var detector = new window.BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13'] });
    _phoneState.bcInterval = setInterval(async function () {
      try {
        var barcodes = await detector.detect(video);
        for (var i = 0; i < barcodes.length; i++) {
          var raw = (barcodes[i].rawValue || '').replace(/\D/g, '');
          if (raw.length >= 15) {
            var imei = raw.slice(0, 15);
            var row = document.querySelector('.batch-row[data-row-id="' + rowId + '"]');
            if (row) row.querySelector('.bi-imei').value = imei;
            closeModal();
            stopBarcodeScan();
            toast('IMEI scanned', 'success');
            return;
          }
        }
      } catch (e) { /* retry */ }
    }, 400);
  } catch (e) {
    stopBarcodeScan();
    closeModal();
    toast('Camera denied or unavailable', 'error');
  }
}
window.scanBatchImei = scanBatchImei;

async function submitBatch() {
  var make = document.getElementById('batch-make').value;
  var model = document.getElementById('batch-model').value.trim();
  var os = document.getElementById('batch-os').value.trim();
  var carrier = document.getElementById('batch-carrier').value;

  var rowEls = Array.prototype.slice.call(document.querySelectorAll('#batch-rows .batch-row'));
  if (!rowEls.length) { toast('Add at least one phone', 'error'); return; }

  // Collect + validate every row up front so nothing gets submitted if
  // one IMEI is missing or malformed -- easier than partial rollbacks.
  var payloads = [];
  for (var r = 0; r < rowEls.length; r++) {
    var rowEl = rowEls[r];
    var imei = (rowEl.querySelector('.bi-imei').value || '').replace(/\D/g, '');
    if (imei.length < 14 || imei.length > 16) {
      toast('Row ' + (r + 1) + ': IMEI should be 15 digits', 'error');
      rowEl.querySelector('.bi-imei').focus();
      return;
    }
    imei = imei.slice(0, 15);

    var number = rowEl.querySelector('.bi-number').value.trim();
    var assignedTo = rowEl.querySelector('.bi-assigned').value || null;

    var nameBits = [];
    if (make) nameBits.push(make);
    if (model) nameBits.push(model);
    var name = nameBits.join(' ').trim() || 'Phone';

    payloads.push({
      rowEl: rowEl,
      body: {
        name: name,
        serial_number: imei,
        category_id: 'cat_phone',
        manufacturer: make || null,
        model: model || null,
        os: os || null,
        phone_number: number || null,
        carrier: carrier || null,
        status: assignedTo ? 'deployed' : 'available',
        assigned_to: assignedTo,
        notes: null
      }
    });
  }

  var btn = document.getElementById('batch-submit');
  var progress = document.getElementById('batch-progress');
  var summary = document.getElementById('batch-summary');
  if (btn) btn.disabled = true;
  summary.innerHTML = '';

  var succeeded = [];
  var failed = [];
  for (var i2 = 0; i2 < payloads.length; i2++) {
    if (progress) progress.innerHTML = '<div style="font-size:13px;color:var(--text2)">Enrolling ' + (i2 + 1) + ' of ' + payloads.length + '…</div>';
    try {
      var result = await API.createAsset(payloads[i2].body);
      succeeded.push({ tag: result.asset_tag, id: result.id, row: payloads[i2].rowEl });
      payloads[i2].rowEl.style.opacity = '0.5';
    } catch (e) {
      failed.push({ imei: payloads[i2].body.serial_number, error: e && e.message ? e.message : 'failed', row: payloads[i2].rowEl });
      payloads[i2].rowEl.style.borderColor = 'var(--red)';
    }
  }

  if (progress) progress.innerHTML = '';
  if (btn) btn.disabled = false;

  var summaryHtml = '<div style="padding:14px;background:var(--surface2);border-radius:8px">'
    + '<div style="font-weight:600;margin-bottom:6px">Enrolled ' + succeeded.length + ' of ' + payloads.length + '</div>';
  if (succeeded.length) {
    summaryHtml += '<div style="font-size:12px;color:var(--text3);margin:6px 0 2px">Tags:</div>'
      + '<div style="font-family:var(--mono);font-size:12px">'
      + succeeded.map(function(s) { return '<a href="#/assets/' + esc(s.id) + '">' + esc(s.tag) + '</a>'; }).join(' · ')
      + '</div>';
  }
  if (failed.length) {
    summaryHtml += '<div style="font-size:12px;color:var(--red);margin-top:8px">Failed:</div>'
      + '<ul style="font-size:12px;margin:4px 0 0;padding-left:18px;color:var(--red)">'
      + failed.map(function(f) { return '<li><span style="font-family:var(--mono)">' + esc(f.imei) + '</span> — ' + esc(f.error) + '</li>'; }).join('')
      + '</ul>';
  }
  summaryHtml += '</div>';
  summary.innerHTML = summaryHtml;

  if (succeeded.length) toast('Enrolled ' + succeeded.length + ' phone' + (succeeded.length === 1 ? '' : 's'), 'success');
}
window.submitBatch = submitBatch;

async function savePhone() {
  var imei = (document.getElementById('phone-imei').value || '').replace(/\D/g, '');
  if (imei.length < 14 || imei.length > 16) {
    toast('IMEI should be 15 digits', 'error');
    return;
  }

  var make = document.getElementById('phone-make').value;
  var model = document.getElementById('phone-model').value.trim();
  var os = document.getElementById('phone-os').value.trim();
  var number = document.getElementById('phone-number').value.trim();
  var carrier = document.getElementById('phone-carrier').value;
  var assignedTo = document.getElementById('phone-assigned').value || null;
  var notes = document.getElementById('phone-notes').value.trim();

  var nameBits = [];
  if (make) nameBits.push(make);
  if (model) nameBits.push(model);
  var name = nameBits.join(' ').trim() || 'Phone';

  var btn = document.getElementById('phone-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    var result = await API.createAsset({
      name: name,
      serial_number: imei,
      category_id: 'cat_phone',
      manufacturer: make || null,
      model: model || null,
      os: os || null,
      phone_number: number || null,
      carrier: carrier || null,
      status: assignedTo ? 'deployed' : 'available',
      assigned_to: assignedTo,
      notes: notes || null
    });
    toast('Enrolled ' + (result.asset_tag || 'phone'), 'success');
    navigate('#/assets/' + result.id);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Enrol phone'; }
    /* toasted */
  }
}
window.savePhone = savePhone;
