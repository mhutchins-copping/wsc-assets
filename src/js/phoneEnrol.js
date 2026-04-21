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

async function renderPhoneEnrol() {
  var el = document.getElementById('view-phone-enrol');
  el.innerHTML = phoneEnrolFormHtml();

  autoDetectPhoneFields();

  // Load people for the assignee picker.
  try {
    var res = await API.getPeople();
    _phoneState.people = (res.data || []).filter(function(p) { return p.active !== 0; });
    var sel = document.getElementById('phone-assigned');
    if (sel) {
      _phoneState.people.forEach(function(p) {
        var opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name + (p.department ? ' — ' + p.department : '');
        sel.appendChild(opt);
      });
    }
  } catch (e) { /* continue without picker */ }
}

function phoneEnrolFormHtml() {
  var barcodeSupported = ('BarcodeDetector' in window);
  return '<div style="max-width:560px;margin:0 auto">'
    + '<div style="margin-bottom:18px"><button class="btn sm" onclick="history.back()">&larr; Back</button></div>'
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
  var notesExtra = document.getElementById('phone-notes').value.trim();

  // Build the notes field so phone-specific metadata (number, carrier)
  // is still visible on the asset detail page -- avoids a schema
  // migration for what's now a handful of fields.
  var notesParts = [];
  if (number) notesParts.push('Phone: ' + number);
  if (carrier) notesParts.push('Carrier: ' + carrier);
  if (notesExtra) notesParts.push(notesExtra);
  var notes = notesParts.join(' · ');

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
