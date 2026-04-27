// ─── Intune Enrolment Wizard ───────────────────────────
// Pick a user → pick a device type → enter serial → click Provision.
// Backend pre-binds the user to the device in ABM (iOS) or generates an
// Android enrolment QR, creates the asset register entry, and mints a
// 14-day handover URL the staff member uses for setup.
//
// Admin-only — backend gates all /api/intune/* routes with isAdmin().
// All matching routes implemented in worker.js (search "Intune Enrolment").

var _intuneState = {
  step: 'person',          // 'person' | 'device' | 'confirm' | 'provisioning' | 'done'
  person: null,            // { id, name, email, department }
  os: null,                // 'ios' | 'android' | 'aosp' | 'byod_android' | 'byod_ios'
  serial: '',
  profile: null,           // chosen enrolment profile
  profiles: null,          // cache of /api/intune/profiles
  phoneNumber: '',
  carrier: '',
  assetName: '',
  preflight: null,         // result of /api/intune/preflight
  provisionResult: null,
  pollTimer: null,
  pollAttempts: 0,
  searchDebounce: null
};

Router.register('/intune-enrol', renderIntuneEnrol);

async function renderIntuneEnrol() {
  var el = document.getElementById('view-intune-enrol');
  if (!el) return;

  if (!Auth.user || Auth.user.role !== 'admin') {
    el.innerHTML = intuneAdminOnlyHtml();
    return;
  }

  // Reset state on entry
  if (_intuneState.pollTimer) { clearTimeout(_intuneState.pollTimer); }
  _intuneState = {
    step: 'person', person: null, os: null, serial: '',
    profile: null, profiles: null,
    phoneNumber: '', carrier: '', assetName: '',
    preflight: null, provisionResult: null,
    pollTimer: null, pollAttempts: 0, searchDebounce: null
  };

  intuneRender();
}

function intuneAdminOnlyHtml() {
  return '<div style="max-width:520px;margin:40px auto;padding:24px;background:var(--surface);border:1px solid var(--border);border-radius:12px;text-align:center">'
    + '<div style="font-size:40px;margin-bottom:12px">&#128274;</div>'
    + '<h2 style="margin:0 0 8px;font-size:17px">Admin access required</h2>'
    + '<p style="margin:0 0 16px;font-size:13px;color:var(--text2)">Only IT admins can enrol devices into Intune.</p>'
    + '<button class="btn" onclick="history.back()">Back</button>'
    + '</div>';
}

function intuneRender() {
  var el = document.getElementById('view-intune-enrol');
  if (!el) return;

  var stepHtml;
  if (_intuneState.step === 'person') stepHtml = intuneStepPersonHtml();
  else if (_intuneState.step === 'device') stepHtml = intuneStepDeviceHtml();
  else if (_intuneState.step === 'confirm') stepHtml = intuneStepConfirmHtml();
  else if (_intuneState.step === 'provisioning') stepHtml = intuneStepProvisioningHtml();
  else if (_intuneState.step === 'done') stepHtml = intuneStepDoneHtml();
  else stepHtml = '<p>Unknown step.</p>';

  el.innerHTML = '<div style="max-width:680px;margin:0 auto">'
    + '<div style="margin-bottom:18px;display:flex;justify-content:space-between;align-items:center">'
    + '<button class="btn sm" onclick="history.back()">&larr; Back</button>'
    + '<a class="btn sm" href="#/phone-enrol">Asset register only →</a>'
    + '</div>'
    + intuneProgressHtml()
    + stepHtml
    + '</div>';

  intuneBindStep();
}

function intuneProgressHtml() {
  var steps = [
    { key: 'person', label: '1. User' },
    { key: 'device', label: '2. Device' },
    { key: 'confirm', label: '3. Review' },
    { key: 'done',   label: '4. Hand over' }
  ];
  var current = _intuneState.step === 'provisioning' ? 'confirm' : _intuneState.step;
  var idx = -1;
  for (var i = 0; i < steps.length; i++) { if (steps[i].key === current) { idx = i; break; } }

  var html = '<ol style="display:flex;gap:8px;list-style:none;padding:0;margin:0 0 18px;justify-content:center;flex-wrap:wrap">';
  for (var j = 0; j < steps.length; j++) {
    var cls = 'background:var(--surface);color:var(--text2);border:1px solid var(--border);';
    if (j < idx) cls = 'background:#2e584220;color:#2e5842;border:1px solid #2e5842;';
    if (j === idx) cls = 'background:#2e5842;color:#fff;border:1px solid #2e5842;';
    html += '<li style="padding:6px 14px;font-size:13px;border-radius:999px;' + cls + '">' + esc(steps[j].label) + '</li>';
  }
  html += '</ol>';
  return html;
}

// ─── Step 1: Person ───
function intuneStepPersonHtml() {
  var html = '<div class="card"><div class="card-header"><span class="card-title">Who is this device for?</span></div><div class="card-body">';

  html += '<div class="form-group">'
    + '<label class="form-label">Search staff (name or email)</label>'
    + '<input id="intune-person-search" type="search" autocomplete="off" placeholder="Start typing…" class="form-input" autofocus>'
    + '</div>';

  html += '<ul id="intune-person-results" style="list-style:none;padding:0;margin:0;border:1px solid var(--border);border-radius:6px;max-height:280px;overflow-y:auto;display:none"></ul>';

  if (_intuneState.person) {
    html += '<div style="margin:14px 0;padding:12px;background:#2e584210;border-left:3px solid #2e5842;border-radius:4px">'
      + '<strong>' + esc(_intuneState.person.name) + '</strong>'
      + '<div style="font-size:13px;color:var(--text2)">' + esc(_intuneState.person.email) + '</div>'
      + (_intuneState.person.department ? '<div style="font-size:12px;color:var(--text3)">' + esc(_intuneState.person.department) + '</div>' : '')
      + '</div>';
    html += '<button class="btn primary" onclick="intuneNext(\'device\')">Next →</button>';
  }

  html += '</div></div>';
  return html;
}

function intuneBindStep() {
  if (_intuneState.step === 'person') intuneBindStepPerson();
  else if (_intuneState.step === 'device') intuneBindStepDevice();
  else if (_intuneState.step === 'confirm') intuneBindStepConfirm();
  else if (_intuneState.step === 'done') intuneBindStepDone();
}

function intuneBindStepPerson() {
  var search = document.getElementById('intune-person-search');
  if (!search) return;

  search.addEventListener('input', function(e) {
    if (_intuneState.searchDebounce) clearTimeout(_intuneState.searchDebounce);
    var q = e.target.value.trim();
    var results = document.getElementById('intune-person-results');
    if (q.length < 2) { results.style.display = 'none'; results.innerHTML = ''; return; }

    _intuneState.searchDebounce = setTimeout(async function() {
      try {
        var r = await API.intunePeopleSearch(q);
        var rows = (r.results || []);
        if (rows.length === 0) {
          results.innerHTML = '<li style="padding:10px 12px;color:var(--text3)">No matches</li>';
          results.style.display = 'block';
          return;
        }
        var html = '';
        for (var i = 0; i < rows.length; i++) {
          var p = rows[i];
          html += '<li style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border)" '
            + 'onclick="intunePickPerson(\'' + esc(p.id) + '\', \'' + esc((p.name||'').replace(/'/g, "&#39;")) + '\', \'' + esc((p.email||'').replace(/'/g, "&#39;")) + '\', \'' + esc((p.department||'').replace(/'/g, "&#39;")) + '\')">'
            + '<strong>' + esc(p.name) + '</strong> '
            + '<small style="color:var(--text2)">' + esc(p.email || '') + '</small>'
            + (p.department ? ' <small style="color:var(--text3)">· ' + esc(p.department) + '</small>' : '')
            + '</li>';
        }
        results.innerHTML = html;
        results.style.display = 'block';
      } catch (err) {
        results.innerHTML = '<li style="padding:10px 12px;color:var(--red)">' + esc(err.message) + '</li>';
        results.style.display = 'block';
      }
    }, 200);
  });
}

function intunePickPerson(id, name, email, department) {
  _intuneState.person = { id: id, name: name, email: email, department: department };
  intuneRender();
}
window.intunePickPerson = intunePickPerson;

function intuneNext(step) {
  _intuneState.step = step;
  if (step === 'device' && !_intuneState.profiles) {
    intuneLoadProfiles();
  }
  intuneRender();
}
window.intuneNext = intuneNext;

async function intuneLoadProfiles() {
  try {
    _intuneState.profiles = await API.intuneProfiles();
    if (_intuneState.step === 'device') intuneRender();
  } catch (e) {
    toast('Failed to load enrolment profiles: ' + e.message, 'error');
  }
}

// ─── Step 2: Device ───
function intuneStepDeviceHtml() {
  var osOptions = [
    { value: 'ios',          label: 'iPhone (Council)',           help: 'Corporate-owned, comes through ABM.' },
    { value: 'android',      label: 'Android (Council)',          help: 'Corporate-owned, fully managed.' },
    { value: 'aosp',         label: 'Android (AOSP / Teams)',     help: 'Teams Rooms / signage / shared device.' },
    { value: 'byod_ios',     label: 'Personal iPhone (BYOD)',     help: 'Staff member\'s own device, work apps only.' },
    { value: 'byod_android', label: 'Personal Android (BYOD)',    help: 'Staff member\'s own device, work profile.' }
  ];

  var isByod = _intuneState.os === 'byod_ios' || _intuneState.os === 'byod_android';
  var showSerial = _intuneState.os && !isByod;
  var showOptional = _intuneState.os && (_intuneState.os === 'ios' || _intuneState.os === 'android' || isByod);

  var profilesForOs = intuneProfilesForCurrentOs();

  var html = '<div class="card"><div class="card-header"><span class="card-title">What kind of device?</span></div><div class="card-body">';

  // OS picker (radio cards)
  html += '<fieldset style="border:0;padding:0;margin:0 0 16px;display:grid;gap:8px">';
  html += '<legend class="form-label" style="margin-bottom:6px">Device type</legend>';
  for (var i = 0; i < osOptions.length; i++) {
    var o = osOptions[i];
    var selected = _intuneState.os === o.value;
    var bordCol = selected ? '#2e5842' : 'var(--border)';
    var bg = selected ? '#2e584210' : 'var(--surface)';
    html += '<label style="display:block;padding:14px 16px;border:2px solid ' + bordCol + ';border-radius:8px;cursor:pointer;background:' + bg + '">'
      + '<input type="radio" name="intune-os" value="' + esc(o.value) + '"' + (selected ? ' checked' : '') + ' onchange="intunePickOs(\'' + esc(o.value) + '\')" style="margin-right:10px">'
      + '<strong>' + esc(o.label) + '</strong>'
      + '<div style="color:var(--text2);font-size:13px;margin-top:2px;margin-left:24px">' + esc(o.help) + '</div>'
      + '</label>';
  }
  html += '</fieldset>';

  // Serial input
  if (showSerial) {
    html += '<div class="form-group">'
      + '<label class="form-label">Serial number</label>'
      + '<input id="intune-serial" type="text" autocomplete="off" class="form-input" '
      + 'placeholder="' + (_intuneState.os === 'ios' ? 'e.g. F2LZ1234XYZ' : 'IMEI / serial') + '" '
      + 'value="' + esc(_intuneState.serial) + '">';
    if (_intuneState.preflight) {
      if (_intuneState.preflight.ready) {
        html += '<p style="color:#2e5842;margin:8px 0 0;font-size:13px">✓ '
          + esc(_intuneState.preflight.depTokenName || 'Ready to enrol')
          + '</p>';
      } else {
        html += '<p style="color:var(--red);margin:8px 0 0;font-size:13px">'
          + esc(_intuneState.preflight.reason || 'Not ready')
          + '</p>';
      }
    }
    html += '</div>';
  }

  // Profile picker (only when multiple options)
  if (_intuneState.os && profilesForOs && profilesForOs.length > 1) {
    html += '<div class="form-group">'
      + '<label class="form-label">Enrolment profile</label>'
      + '<select id="intune-profile" class="form-select" onchange="intunePickProfile(this.value)">';
    for (var k = 0; k < profilesForOs.length; k++) {
      var p = profilesForOs[k];
      var sel = (_intuneState.profile && _intuneState.profile.id === p.id) ? ' selected' : '';
      html += '<option value="' + esc(p.id) + '"' + sel + '>'
        + esc(p.displayName) + (p.isDefault ? ' (default)' : '')
        + '</option>';
    }
    html += '</select></div>';
  }

  // Optional fields (collapsed)
  if (showOptional) {
    html += '<details style="margin:16px 0;padding:12px 16px;background:var(--surface-alt,#f9fafb);border-radius:6px">'
      + '<summary style="cursor:pointer;font-weight:500;font-size:14px;color:var(--text2)">Optional details</summary>'
      + '<div style="margin-top:12px">'
      + '<div class="form-group"><label class="form-label">Phone number</label>'
      + '<input id="intune-phone-number" type="tel" class="form-input" value="' + esc(_intuneState.phoneNumber) + '" placeholder="04xx xxx xxx" oninput="_intuneState.phoneNumber=this.value"></div>'
      + '<div class="form-group"><label class="form-label">Carrier</label>'
      + '<input id="intune-carrier" type="text" class="form-input" value="' + esc(_intuneState.carrier) + '" placeholder="Telstra / Optus / Vodafone" oninput="_intuneState.carrier=this.value"></div>'
      + '<div class="form-group"><label class="form-label">Asset name (optional override)</label>'
      + '<input id="intune-asset-name" type="text" class="form-input" value="' + esc(_intuneState.assetName) + '" placeholder="Auto: ' + esc((_intuneState.person ? _intuneState.person.name : 'User') + ' — Device') + '" oninput="_intuneState.assetName=this.value"></div>'
      + '</div></details>';
  }

  html += '<div style="display:flex;justify-content:space-between;margin-top:18px">'
    + '<button class="btn" onclick="intuneNext(\'person\')">← Back</button>'
    + '<button class="btn primary"' + (intuneCanAdvanceFromDevice() ? '' : ' disabled') + ' onclick="intuneNext(\'confirm\')">Next →</button>'
    + '</div>';

  html += '</div></div>';
  return html;
}

function intuneProfilesForCurrentOs() {
  if (!_intuneState.profiles) return null;
  if (_intuneState.os === 'ios' || _intuneState.os === 'byod_ios') return _intuneState.profiles.apple;
  if (_intuneState.os === 'android' || _intuneState.os === 'aosp' || _intuneState.os === 'byod_android') return _intuneState.profiles.android;
  return [];
}

function intuneCanAdvanceFromDevice() {
  if (!_intuneState.os) return false;
  var isByod = _intuneState.os === 'byod_ios' || _intuneState.os === 'byod_android';
  if (isByod) return true;
  if (!_intuneState.serial) return false;
  if (!_intuneState.preflight || !_intuneState.preflight.ready) return false;
  return true;
}

function intuneBindStepDevice() {
  var serial = document.getElementById('intune-serial');
  if (serial) {
    var serialDebounce;
    serial.addEventListener('input', function(e) {
      _intuneState.serial = e.target.value.trim();
      if (serialDebounce) clearTimeout(serialDebounce);
      serialDebounce = setTimeout(intuneRunPreflight, 350);
    });
  }
}

function intunePickOs(os) {
  _intuneState.os = os;
  _intuneState.preflight = null;
  _intuneState.profile = null;
  intuneRunPreflight();
  intuneRender();
}
window.intunePickOs = intunePickOs;

function intunePickProfile(profileId) {
  var profs = intuneProfilesForCurrentOs() || [];
  for (var i = 0; i < profs.length; i++) {
    if (profs[i].id === profileId) { _intuneState.profile = profs[i]; break; }
  }
  intuneRender();
}
window.intunePickProfile = intunePickProfile;

async function intuneRunPreflight() {
  var os = _intuneState.os;
  if (!os) return;
  var isByod = os === 'byod_ios' || os === 'byod_android';
  if (!isByod && !_intuneState.serial) return;
  try {
    _intuneState.preflight = await API.intunePreflight(os, _intuneState.serial);
    intuneRender();
    // Restore focus + cursor on serial input after re-render
    var serial = document.getElementById('intune-serial');
    if (serial) {
      serial.focus();
      var v = serial.value; serial.value = ''; serial.value = v;
    }
  } catch (err) {
    _intuneState.preflight = { ready: false, reason: err.message };
    intuneRender();
  }
}

// ─── Step 3: Confirm ───
function intuneStepConfirmHtml() {
  var isByod = _intuneState.os === 'byod_ios' || _intuneState.os === 'byod_android';
  var html = '<div class="card"><div class="card-header"><span class="card-title">Review — ready to provision?</span></div><div class="card-body">';

  html += '<dl style="display:grid;grid-template-columns:max-content 1fr;gap:8px 16px;margin:0 0 20px">';
  html += '<dt style="font-weight:600;color:var(--text2);font-size:13px">User</dt>'
    + '<dd style="margin:0"><strong>' + esc(_intuneState.person.name) + '</strong> <small style="color:var(--text2)">' + esc(_intuneState.person.email) + '</small></dd>';
  html += '<dt style="font-weight:600;color:var(--text2);font-size:13px">Device type</dt>'
    + '<dd style="margin:0">' + esc(intuneOsLabel(_intuneState.os)) + '</dd>';
  if (!isByod) {
    html += '<dt style="font-weight:600;color:var(--text2);font-size:13px">Serial</dt>'
      + '<dd style="margin:0"><code>' + esc(_intuneState.serial) + '</code></dd>';
  }
  if (_intuneState.profile) {
    html += '<dt style="font-weight:600;color:var(--text2);font-size:13px">Profile</dt>'
      + '<dd style="margin:0">' + esc(_intuneState.profile.displayName) + '</dd>';
  }
  if (_intuneState.phoneNumber) {
    html += '<dt style="font-weight:600;color:var(--text2);font-size:13px">Phone</dt>'
      + '<dd style="margin:0">' + esc(_intuneState.phoneNumber) + (_intuneState.carrier ? ' (' + esc(_intuneState.carrier) + ')' : '') + '</dd>';
  }
  html += '</dl>';

  html += '<div style="margin:16px 0;padding:14px;background:#3b82f610;border-left:3px solid #3b82f6;border-radius:4px">';
  html += '<strong style="font-size:14px">What will happen</strong><ul style="margin:6px 0 0;padding-left:20px;font-size:14px;line-height:1.7">';
  if (_intuneState.os === 'ios') {
    html += '<li>Pre-bind the user to this serial in ABM (Setup Assistant pre-fills the council username).</li>';
  }
  if (_intuneState.os === 'android' || _intuneState.os === 'aosp') {
    html += '<li>Generate an Android enrolment QR code valid for 90 days.</li>';
  }
  if (isByod) {
    html += '<li>No Graph writes — generates instructions for the staff member to install Company Portal on their personal device.</li>';
  }
  html += '<li>Create / update the asset register entry' + (_intuneState.serial ? ' (serial <code>' + esc(_intuneState.serial) + '</code>)' : '') + '.</li>';
  html += '<li>Mint a 14-day handover URL for the staff member.</li>';
  html += '</ul></div>';

  html += '<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;margin-top:18px">'
    + '<button class="btn" onclick="intuneNext(\'device\')">← Back</button>'
    + '<div style="display:flex;gap:8px">'
    + '<button class="btn" onclick="intuneRunProvision(true)">Dry run (preview)</button>'
    + '<button class="btn primary" onclick="intuneRunProvision(false)">Provision now →</button>'
    + '</div>'
    + '</div>';

  html += '<div id="intune-dry-run-result" style="margin-top:14px"></div>';
  html += '</div></div>';
  return html;
}

function intuneBindStepConfirm() { /* nothing — all bindings inline via onclick */ }

function intuneOsLabel(os) {
  return ({
    ios: 'iPhone (Council)',
    android: 'Android (Council)',
    aosp: 'Android (AOSP / Teams)',
    byod_ios: 'Personal iPhone (BYOD)',
    byod_android: 'Personal Android (BYOD)'
  })[os] || os;
}
window.intuneOsLabel = intuneOsLabel;

async function intuneRunProvision(dryRun) {
  var payload = {
    person_id: _intuneState.person.id,
    os: _intuneState.os,
    serial_number: _intuneState.serial || undefined,
    profile_id: _intuneState.profile ? _intuneState.profile.id : undefined,
    phone_number: _intuneState.phoneNumber || undefined,
    carrier: _intuneState.carrier || undefined,
    name: _intuneState.assetName || undefined
  };

  if (dryRun) {
    try {
      var r = await API.intuneProvision(payload, true);
      var target = document.getElementById('intune-dry-run-result');
      if (target) {
        target.innerHTML = '<pre style="background:#1f2937;color:#f9fafb;padding:14px;border-radius:6px;font-size:12px;max-height:400px;overflow:auto;white-space:pre-wrap;word-break:break-word">'
          + esc(JSON.stringify(r, null, 2)) + '</pre>';
      }
    } catch (err) {
      toast('Dry run failed: ' + err.message, 'error');
    }
    return;
  }

  _intuneState.step = 'provisioning';
  intuneRender();

  try {
    var result = await API.intuneProvision(payload, false);
    _intuneState.provisionResult = result;
    _intuneState.step = 'done';
    intuneRender();
    if (_intuneState.serial) intuneBeginStatusPoll();
  } catch (err) {
    _intuneState.step = 'confirm';
    intuneRender();
    toast('Provision failed: ' + err.message, 'error');
  }
}
window.intuneRunProvision = intuneRunProvision;

// ─── Step 4: Provisioning (transient) ───
function intuneStepProvisioningHtml() {
  return '<div style="text-align:center;padding:48px 16px">'
    + '<div style="display:inline-block;width:40px;height:40px;border:4px solid var(--border);border-top-color:#2e5842;border-radius:50%;animation:spin 0.9s linear infinite;margin-bottom:16px"></div>'
    + '<style>@keyframes spin { to { transform: rotate(360deg); } }</style>'
    + '<p>Talking to Intune &amp; ABM…</p>'
    + '<p style="color:var(--text2);font-size:13px">Usually 5–15 seconds.</p>'
    + '</div>';
}

// ─── Step 5: Done ───
function intuneStepDoneHtml() {
  var r = _intuneState.provisionResult || {};
  var handoverUrl = r.handover_url || '';
  var isAndroid = _intuneState.os === 'android' || _intuneState.os === 'aosp';
  var isIos = _intuneState.os === 'ios';
  var isByod = _intuneState.os === 'byod_ios' || _intuneState.os === 'byod_android';

  var html = '<div class="card"><div class="card-body">';

  // Success banner
  html += '<div style="background:#ecfdf5;border-left:4px solid #10b981;padding:16px;border-radius:6px;margin-bottom:18px">'
    + '<h2 style="margin:0 0 4px;color:#059669">✓ Provisioned</h2>'
    + '<p style="margin:0;font-size:14px">Asset <strong>' + esc(r.asset_tag || '') + '</strong> created/updated.</p>'
    + '</div>';

  // Handover card
  html += '<div style="background:var(--surface-alt,#f9fafb);padding:18px;border-radius:8px;margin-bottom:16px">';
  html += '<h3 style="margin:0 0 8px;font-size:16px">Hand-over instructions for ' + esc(_intuneState.person.name) + '</h3>';
  html += '<p style="margin:0 0 12px;font-size:14px">Send them this URL — opens to a step-by-step walkthrough for their device:</p>';
  html += '<div style="display:flex;gap:6px;align-items:stretch;margin-bottom:6px">'
    + '<input id="intune-handover-url" type="text" readonly value="' + esc(handoverUrl) + '" class="form-input" style="font-family:ui-monospace,SF Mono,Menlo,Monaco,monospace;font-size:13px">'
    + '<button class="btn" onclick="intuneCopyHandoverUrl()">Copy</button>'
    + '<button class="btn primary" onclick="intuneEmailHandover()">Email it</button>'
    + '</div>';
  html += '<p style="margin:8px 0 0;color:var(--text2);font-size:13px">Expires in 14 days.</p>';

  if (isAndroid && r.qr_available) {
    html += '<div style="margin:14px 0 0;padding:12px;background:#fff;border-radius:6px;border:1px solid var(--border)">'
      + '<p style="margin:0;font-size:13px;color:var(--text2)">QR is rendered on the handover page itself — open the link above to view it.</p>'
      + '</div>';
  }

  if (isIos) {
    html += '<div style="margin:14px 0 0;padding:14px;background:#fff;border-radius:6px;border:1px solid var(--border)">'
      + '<p style="margin:0 0 6px;font-size:14px"><strong>iPhone next steps:</strong></p>'
      + '<ol style="margin:0;padding-left:22px;font-size:14px;line-height:1.7">'
      + '<li>Hand the device to ' + esc(_intuneState.person.name) + ' (factory reset state).</li>'
      + '<li>They power on, follow Setup Assistant — username will pre-fill.</li>'
      + '<li>They sign in with their council M365 password + MFA.</li>'
      + '<li>Apps install in the background (~10 min).</li>'
      + '</ol></div>';
  }

  html += '</div>';

  // Status watch
  html += '<div style="margin:0 0 16px;padding:14px;background:var(--surface-alt,#f9fafb);border-radius:8px">';
  html += '<h3 style="margin:0 0 10px;font-size:15px">Live enrolment status</h3>';
  html += '<div id="intune-status-pane" style="font-size:14px">';
  if (_intuneState.serial) html += '<p style="color:var(--text2);margin:0">Polling Intune every 30s…</p>';
  else html += '<p style="color:var(--text2);margin:0">No serial — nothing to poll.</p>';
  html += '</div></div>';

  html += '<div style="display:flex;justify-content:flex-end;margin-top:18px">'
    + '<button class="btn" onclick="intuneEnrolAnother()">Enrol another device</button>'
    + '</div>';
  html += '</div></div>';
  return html;
}

function intuneBindStepDone() { /* binding is inline */ }

function intuneCopyHandoverUrl() {
  var input = document.getElementById('intune-handover-url');
  if (!input) return;
  input.select();
  try {
    document.execCommand('copy');
    toast('Handover URL copied', 'success');
  } catch (e) {
    toast('Copy failed — select and Ctrl-C manually', 'error');
  }
}
window.intuneCopyHandoverUrl = intuneCopyHandoverUrl;

function intuneEmailHandover() {
  var r = _intuneState.provisionResult || {};
  var subject = encodeURIComponent('Your new ' + intuneOsLabel(_intuneState.os) + ' from WSC IT');
  var body = encodeURIComponent(
    'Hi ' + _intuneState.person.name + ',\n\n'
    + 'Your new device is ready. Open this link for setup steps:\n\n'
    + (r.handover_url || '')
    + '\n\nLink expires in 14 days. Let me know if you hit any snags.\n\n'
    + 'Walgett Shire Council IT'
  );
  window.location.href = 'mailto:' + (_intuneState.person.email || '') + '?subject=' + subject + '&body=' + body;
}
window.intuneEmailHandover = intuneEmailHandover;

function intuneEnrolAnother() {
  var keepPerson = _intuneState.person;
  if (_intuneState.pollTimer) { clearTimeout(_intuneState.pollTimer); }
  _intuneState = {
    step: 'device', person: keepPerson, os: null, serial: '',
    profile: null, profiles: _intuneState.profiles,
    phoneNumber: '', carrier: '', assetName: '',
    preflight: null, provisionResult: null,
    pollTimer: null, pollAttempts: 0, searchDebounce: null
  };
  intuneRender();
}
window.intuneEnrolAnother = intuneEnrolAnother;

function intuneBeginStatusPoll() {
  var tick = async function() {
    _intuneState.pollAttempts++;
    var pane = document.getElementById('intune-status-pane');
    if (!pane) return;  // user navigated away
    try {
      var r = await API.intuneDeviceStatus(_intuneState.serial);
      if (r.enrolled) {
        var info = '<p style="color:#059669;margin:0 0 8px"><strong>✓ Device enrolled</strong></p>'
          + '<dl style="display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0">'
          + '<dt style="font-weight:600">Device name</dt><dd style="margin:0">' + esc(r.deviceName || '') + '</dd>'
          + '<dt style="font-weight:600">OS</dt><dd style="margin:0">' + esc((r.operatingSystem || '') + ' ' + (r.osVersion || '')) + '</dd>'
          + '<dt style="font-weight:600">Compliance</dt><dd style="margin:0">' + esc(r.complianceState || '') + '</dd>'
          + '<dt style="font-weight:600">Last sync</dt><dd style="margin:0">' + esc(r.lastSyncDateTime || '') + '</dd>'
          + '<dt style="font-weight:600">Primary user</dt><dd style="margin:0">' + esc(r.userPrincipalName || '(none)') + '</dd>'
          + '</dl>';
        pane.innerHTML = info;
        return;  // stop polling
      }
      pane.innerHTML = '<p style="color:var(--text2);margin:0">Not enrolled yet (poll #' + _intuneState.pollAttempts + '). Will check again in 30s.</p>';
    } catch (err) {
      pane.innerHTML = '<p style="color:var(--red);margin:0">Status check failed: ' + esc(err.message) + '</p>';
    }
    if (_intuneState.pollAttempts < 20) {
      _intuneState.pollTimer = setTimeout(tick, 30000);
    } else {
      pane.innerHTML += '<p style="color:var(--text2);margin:8px 0 0;font-size:13px">Stopped polling after 10 min. Refresh manually if needed.</p>';
    }
  };
  _intuneState.pollTimer = setTimeout(tick, 5000);
}
