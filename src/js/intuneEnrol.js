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
  deviceType: null,        // 'iphone' | 'android'
  ownership: 'council',    // 'council' | 'personal'  (default to council; user can switch)
  serial: '',
  phoneNumber: '',
  carrier: '',
  assetName: '',
  // ABM detection state — only populated for iPhone + Council
  // null = unchecked yet; { mode, depTokenName } once preflight ran
  preflight: null,
  preflightLoading: false,
  preflightDebounce: null,
  provisionResult: null,
  pollTimer: null,
  pollAttempts: 0,
  searchDebounce: null
};

// Derive the backend `os` enum from deviceType + ownership. The wizard
// stores the human-readable choices; the API takes the legacy enum.
function intuneOsEnum() {
  var t = _intuneState.deviceType, o = _intuneState.ownership;
  if (t === 'iphone'  && o === 'council')  return 'ios';
  if (t === 'iphone'  && o === 'personal') return 'byod_ios';
  if (t === 'android' && o === 'council')  return 'android';
  if (t === 'android' && o === 'personal') return 'byod_android';
  return null;
}

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
  if (_intuneState.preflightDebounce) { clearTimeout(_intuneState.preflightDebounce); }
  _intuneState = {
    step: 'person', person: null,
    deviceType: null, ownership: 'council', serial: '',
    phoneNumber: '', carrier: '', assetName: '',
    preflight: null, preflightLoading: false, preflightDebounce: null,
    provisionResult: null,
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
  intuneRender();
}
window.intuneNext = intuneNext;

// ─── Step 2: Device ───
// Council buys consumer iPhones/Androids (no ABM). Every flow ends up
// being "install Company Portal, sign in, install management profile /
// set up Work Profile". So the picker is just iPhone vs Android, then a
// "council-owned vs personal" radio for asset-register tagging + the
// privacy framing on the staff handover page.
function intuneStepDeviceHtml() {
  var html = '<div class="card"><div class="card-header"><span class="card-title">What kind of device?</span></div><div class="card-body">';

  // Device type — 2 options
  var deviceOptions = [
    { value: 'iphone',  label: 'iPhone',  emoji: '📱' },
    { value: 'android', label: 'Android', emoji: '🤖' }
  ];
  html += '<fieldset style="border:0;padding:0;margin:0 0 16px;display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  html += '<legend class="form-label" style="margin-bottom:6px;grid-column:1/-1">Device type</legend>';
  for (var i = 0; i < deviceOptions.length; i++) {
    var d = deviceOptions[i];
    var selected = _intuneState.deviceType === d.value;
    var bordCol = selected ? '#2e5842' : 'var(--border)';
    var bg = selected ? '#2e584210' : 'var(--surface)';
    html += '<label style="display:block;padding:18px 16px;border:2px solid ' + bordCol + ';border-radius:8px;cursor:pointer;background:' + bg + ';text-align:center">'
      + '<input type="radio" name="intune-device-type" value="' + esc(d.value) + '"' + (selected ? ' checked' : '') + ' onchange="intunePickDeviceType(\'' + esc(d.value) + '\')" style="display:none">'
      + '<div style="font-size:32px;line-height:1;margin-bottom:6px">' + d.emoji + '</div>'
      + '<strong>' + esc(d.label) + '</strong>'
      + '</label>';
  }
  html += '</fieldset>';

  // Ownership — 2 options
  if (_intuneState.deviceType) {
    var ownershipOptions = [
      { value: 'council',  label: 'Council-owned',     help: 'Council bought it (JB Hi-Fi etc.). Staff member uses it for work.' },
      { value: 'personal', label: 'Staff-owned (BYOD)', help: 'Staff member\'s own device. Council manages just the work apps.' }
    ];
    html += '<fieldset style="border:0;padding:0;margin:0 0 16px;display:grid;gap:8px">';
    html += '<legend class="form-label" style="margin-bottom:6px">Ownership</legend>';
    for (var j = 0; j < ownershipOptions.length; j++) {
      var ow = ownershipOptions[j];
      var owSelected = _intuneState.ownership === ow.value;
      var owBord = owSelected ? '#2e5842' : 'var(--border)';
      var owBg = owSelected ? '#2e584210' : 'var(--surface)';
      html += '<label style="display:block;padding:14px 16px;border:2px solid ' + owBord + ';border-radius:8px;cursor:pointer;background:' + owBg + '">'
        + '<input type="radio" name="intune-ownership" value="' + esc(ow.value) + '"' + (owSelected ? ' checked' : '') + ' onchange="intunePickOwnership(\'' + esc(ow.value) + '\')" style="margin-right:10px">'
        + '<strong>' + esc(ow.label) + '</strong>'
        + '<div style="color:var(--text2);font-size:13px;margin-top:2px;margin-left:24px">' + esc(ow.help) + '</div>'
        + '</label>';
    }
    html += '</fieldset>';
  }

  // For iPhone + Council, serial is promoted to a top-level field with
  // live ABM detection. Knowing whether the device is already in ABM
  // changes the staff-side experience dramatically (zero-touch vs
  // Company Portal install), so we surface it before they hit Provision.
  var isCouncilIphone = (_intuneState.deviceType === 'iphone' && _intuneState.ownership === 'council');

  if (isCouncilIphone) {
    html += '<div class="form-group" style="margin-top:16px">'
      + '<label class="form-label">iPhone serial number</label>'
      + '<input id="intune-serial" type="text" autocomplete="off" class="form-input" placeholder="e.g. F2LZHQ7HRPL2 (Settings → General → About → Serial Number)" value="' + esc(_intuneState.serial) + '" oninput="intuneOnSerialInput(this.value)">'
      + intuneAbmStatusHtml()
      + '</div>';
  }

  // Optional details — for non-council-iPhone, serial is still here
  if (_intuneState.deviceType) {
    var showSerialInOptional = !isCouncilIphone;
    html += '<details style="margin:16px 0;padding:12px 16px;background:var(--surface-alt,#f9fafb);border-radius:6px"' + (_intuneState.phoneNumber || (showSerialInOptional && _intuneState.serial) ? ' open' : '') + '>'
      + '<summary style="cursor:pointer;font-weight:500;font-size:14px;color:var(--text2)">Optional details</summary>'
      + '<div style="margin-top:12px">';

    if (showSerialInOptional) {
      html += '<div class="form-group"><label class="form-label">Serial number / IMEI</label>'
        + '<input id="intune-serial" type="text" autocomplete="off" class="form-input" placeholder="' + (_intuneState.deviceType === 'iphone' ? 'e.g. F2LZHQ7HRPL2' : 'IMEI (15 digits) or serial') + '" value="' + esc(_intuneState.serial) + '" oninput="_intuneState.serial=this.value.trim()">'
        + '<div style="font-size:12px;color:var(--text3);margin-top:4px">Skip if you don\'t have it on hand. Will populate later when the device enrols.</div></div>';
    }

    html += '<div class="form-group"><label class="form-label">Phone number</label>'
      + '<input id="intune-phone-number" type="tel" class="form-input" value="' + esc(_intuneState.phoneNumber) + '" placeholder="04xx xxx xxx" oninput="_intuneState.phoneNumber=this.value"></div>'
      + '<div class="form-group"><label class="form-label">Carrier</label>'
      + '<input id="intune-carrier" type="text" class="form-input" value="' + esc(_intuneState.carrier) + '" placeholder="Telstra / Optus / Vodafone" oninput="_intuneState.carrier=this.value"></div>'
      + '<div class="form-group"><label class="form-label">Asset name (override)</label>'
      + '<input id="intune-asset-name" type="text" class="form-input" value="' + esc(_intuneState.assetName) + '" placeholder="Auto: ' + esc((_intuneState.person ? _intuneState.person.name : 'User') + ' — ' + (_intuneState.deviceType === 'iphone' ? 'iPhone' : 'Android')) + '" oninput="_intuneState.assetName=this.value"></div>'
      + '</div></details>';
  }

  html += '<div style="display:flex;justify-content:space-between;margin-top:18px">'
    + '<button class="btn" onclick="intuneNext(\'person\')">← Back</button>'
    + '<button class="btn primary"' + (intuneCanAdvanceFromDevice() ? '' : ' disabled') + ' onclick="intuneNext(\'confirm\')">Next →</button>'
    + '</div>';

  html += '</div></div>';
  return html;
}

function intuneCanAdvanceFromDevice() {
  return !!(_intuneState.deviceType && _intuneState.ownership);
}

function intuneBindStepDevice() { /* nothing — inline oninput handlers */ }

function intunePickDeviceType(t) {
  _intuneState.deviceType = t;
  // Reset ABM state when device type changes
  _intuneState.preflight = null;
  _intuneState.preflightLoading = false;
  if (_intuneState.preflightDebounce) { clearTimeout(_intuneState.preflightDebounce); }
  intuneRender();
}
window.intunePickDeviceType = intunePickDeviceType;

function intunePickOwnership(o) {
  _intuneState.ownership = o;
  // Re-check ABM when ownership flips (only iPhone+Council does ABM)
  _intuneState.preflight = null;
  if (_intuneState.serial) intuneTriggerPreflight();
  intuneRender();
}
window.intunePickOwnership = intunePickOwnership;

// Live ABM detection for iPhone + Council. Debounced so typing the
// serial doesn't fire a Graph call per keystroke.
function intuneOnSerialInput(value) {
  _intuneState.serial = (value || '').trim();
  _intuneState.preflight = null;
  if (_intuneState.preflightDebounce) { clearTimeout(_intuneState.preflightDebounce); }
  if (_intuneState.serial.length >= 6) {
    _intuneState.preflightDebounce = setTimeout(intuneTriggerPreflight, 500);
  }
  intuneRender();
}
window.intuneOnSerialInput = intuneOnSerialInput;

async function intuneTriggerPreflight() {
  var os = intuneOsEnum();
  if (os !== 'ios' || !_intuneState.serial) return;
  _intuneState.preflightLoading = true;
  intuneRender();
  try {
    var r = await API.intunePreflight(os, _intuneState.serial);
    _intuneState.preflight = r;
  } catch (err) {
    _intuneState.preflight = { ready: false, reason: err.message };
  } finally {
    _intuneState.preflightLoading = false;
    intuneRender();
    // Restore focus on the serial input after re-render
    var el = document.getElementById('intune-serial');
    if (el) {
      el.focus();
      var v = el.value; el.value = ''; el.value = v;
    }
  }
}
window.intuneAcRetry = intuneTriggerPreflight;

function intuneAbmStatusHtml() {
  if (_intuneState.preflightLoading) {
    return '<div style="margin-top:10px;padding:10px 14px;background:#3b82f615;border-left:3px solid #3b82f6;border-radius:4px;font-size:13px">Checking ABM…</div>';
  }
  var p = _intuneState.preflight;
  if (!p) {
    if (!_intuneState.serial) {
      return '<div style="margin-top:10px;padding:10px 14px;background:var(--surface-alt,#f9fafb);border-left:3px solid var(--border);border-radius:4px;font-size:13px;color:var(--text2)">'
        + 'Enter the serial to check if this iPhone is already in <strong>Apple Business Manager</strong> (zero-touch path). Don\'t have it? You can still click Next — Company Portal install will be used instead.'
        + '</div>';
    }
    return '';
  }
  if (p.mode === 'abm') {
    return '<div style="margin-top:10px;padding:12px 14px;background:#10b98115;border-left:3px solid #10b981;border-radius:4px;font-size:13px">'
      + '<strong style="color:#059669">✓ In ABM</strong> &middot; ' + esc(p.depTokenName || '') + '<br>'
      + '<span style="color:var(--text2)">When you click Provision, the user will be pre-bound. Staff just factory-resets the iPhone, powers on, signs in once — done. Zero-touch.</span>'
      + '</div>';
  }
  // Not in ABM — show the Apple Configurator path
  return intuneApacInstructionsHtml();
}

function intuneApacInstructionsHtml() {
  return '<div style="margin-top:10px;padding:14px 16px;background:#f59e0b15;border-left:3px solid #f59e0b;border-radius:4px;font-size:13px">'
    + '<strong>Not in ABM yet</strong>'
    + '<p style="margin:6px 0">Two options:</p>'
    + '<details open style="margin:8px 0;padding:10px 12px;background:#fff;border-radius:4px">'
    +   '<summary style="cursor:pointer;font-weight:600">Option A: add it to ABM via Apple Configurator on your phone (recommended — zero-touch for the user)</summary>'
    +   '<ol style="margin:8px 0;padding-left:20px;line-height:1.7">'
    +     '<li>Make sure the iPhone is <strong>factory-reset</strong> — sitting on the "Hello" / language picker / Setup Assistant welcome screen.</li>'
    +     '<li>Open <strong>Apple Configurator</strong> on your phone (the one signed in with <code>mdm@walgett.nsw.gov.au</code>).</li>'
    +     '<li>Tap <strong>+</strong> or <strong>Add to Apple Business Manager</strong> → choose MDM Server <strong>Walgett Shire Council – Intune</strong>.</li>'
    +     '<li>Point your phone\'s camera at the new iPhone\'s setup-screen swirl pattern. It\'ll capture in 1-2 seconds.</li>'
    +     '<li>Wait ~2 minutes for ABM → Intune sync, then click Check again below.</li>'
    +   '</ol>'
    +   '<button class="btn primary sm" type="button" onclick="intuneAcRetry()" style="margin-top:6px">Check again</button>'
    + '</details>'
    + '<details style="margin:8px 0;padding:10px 12px;background:#fff;border-radius:4px">'
    +   '<summary style="cursor:pointer;font-weight:600">Option B: skip ABM, use Company Portal install (~15 min staff time, manual)</summary>'
    +   '<p style="margin:6px 0">Staff will get a handover URL. They install Company Portal from the App Store, sign in, follow the prompts. Works fine but no supervision.</p>'
    +   '<p style="margin:6px 0;color:var(--text2)">Just click <strong>Next</strong> below — wizard auto-falls-back to Company Portal.</p>'
    + '</details>'
    + '</div>';
}

// ─── Step 3: Confirm ───
function intuneStepConfirmHtml() {
  var label = intuneOsLabel(intuneOsEnum());
  var html = '<div class="card"><div class="card-header"><span class="card-title">Review — ready to provision?</span></div><div class="card-body">';

  html += '<dl style="display:grid;grid-template-columns:max-content 1fr;gap:8px 16px;margin:0 0 20px">';
  html += '<dt style="font-weight:600;color:var(--text2);font-size:13px">User</dt>'
    + '<dd style="margin:0"><strong>' + esc(_intuneState.person.name) + '</strong> <small style="color:var(--text2)">' + esc(_intuneState.person.email) + '</small></dd>';
  html += '<dt style="font-weight:600;color:var(--text2);font-size:13px">Device</dt>'
    + '<dd style="margin:0">' + esc(label) + '</dd>';
  if (_intuneState.serial) {
    html += '<dt style="font-weight:600;color:var(--text2);font-size:13px">Serial / IMEI</dt>'
      + '<dd style="margin:0"><code>' + esc(_intuneState.serial) + '</code></dd>';
  }
  if (_intuneState.phoneNumber) {
    html += '<dt style="font-weight:600;color:var(--text2);font-size:13px">Phone</dt>'
      + '<dd style="margin:0">' + esc(_intuneState.phoneNumber) + (_intuneState.carrier ? ' (' + esc(_intuneState.carrier) + ')' : '') + '</dd>';
  }
  html += '</dl>';

  // ABM-mode banner if the preflight detected the iPhone is in ABM
  var willBeAbm = (_intuneState.preflight && _intuneState.preflight.mode === 'abm');
  html += '<div style="margin:16px 0;padding:14px;background:' + (willBeAbm ? '#10b98115' : '#3b82f610') + ';border-left:3px solid ' + (willBeAbm ? '#10b981' : '#3b82f6') + ';border-radius:4px">';
  html += '<strong style="font-size:14px">What will happen</strong>';
  if (willBeAbm) {
    html += ' <span style="background:#10b981;color:#fff;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;margin-left:6px">ABM zero-touch</span>';
    html += '<ul style="margin:6px 0 0;padding-left:20px;font-size:14px;line-height:1.7">';
    html += '<li>Pre-bind ' + esc(_intuneState.person.name) + ' to this iPhone in ABM (Setup Assistant pre-fills their username).</li>';
    html += '<li>Create / update the asset register entry.</li>';
    html += '<li>Mint a handover URL — staff just factory-resets the iPhone, powers on, signs in. Done.</li>';
    html += '</ul>';
  } else {
    html += '<ul style="margin:6px 0 0;padding-left:20px;font-size:14px;line-height:1.7">';
    html += '<li>Create / update the asset register entry for this device.</li>';
    html += '<li>Mint a 14-day handover URL with Company Portal install steps for the staff member.</li>';
    html += '<li>Email or text them the URL — they install Company Portal, sign in, follow prompts.</li>';
    html += '</ul>';
  }
  html += '</div>';

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
    ios: 'iPhone (council-owned)',
    android: 'Android (council-owned)',
    aosp: 'Android (AOSP / Teams)',
    byod_ios: 'iPhone (staff-owned)',
    byod_android: 'Android (staff-owned)'
  })[os] || os || 'device';
}
window.intuneOsLabel = intuneOsLabel;

async function intuneRunProvision(dryRun) {
  var payload = {
    person_id: _intuneState.person.id,
    os: intuneOsEnum(),
    serial_number: _intuneState.serial || undefined,
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
  var isIphone = _intuneState.deviceType === 'iphone';
  var isAbm = (r.mode === 'abm');

  var html = '<div class="card"><div class="card-body">';

  // Success banner — flag the mode so the IT officer knows what flow ran
  html += '<div style="background:#ecfdf5;border-left:4px solid #10b981;padding:16px;border-radius:6px;margin-bottom:18px">'
    + '<h2 style="margin:0 0 4px;color:#059669">✓ Provisioned'
    + (isAbm ? ' <span style="background:#10b981;color:#fff;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;margin-left:6px;vertical-align:middle">ABM zero-touch</span>' : '')
    + '</h2>'
    + '<p style="margin:0;font-size:14px">Asset <strong>' + esc(r.asset_tag || '') + '</strong> created/updated.</p>'
    + (r.abm_prebind_failed ? '<p style="margin:6px 0 0;font-size:13px;color:#b45309">⚠ ABM pre-bind failed — falling back to Company Portal flow. Check the worker logs.</p>' : '')
    + '</div>';

  // Handover card
  html += '<div style="background:var(--surface-alt,#f9fafb);padding:18px;border-radius:8px;margin-bottom:16px">';
  html += '<h3 style="margin:0 0 8px;font-size:16px">Hand-over instructions for ' + esc(_intuneState.person.name) + '</h3>';
  html += '<p style="margin:0 0 12px;font-size:14px">Send them this URL — opens a step-by-step walkthrough on their device:</p>';
  html += '<div style="display:flex;gap:6px;align-items:stretch;margin-bottom:6px;flex-wrap:wrap">'
    + '<input id="intune-handover-url" type="text" readonly value="' + esc(handoverUrl) + '" class="form-input" style="font-family:ui-monospace,SF Mono,Menlo,Monaco,monospace;font-size:13px;min-width:200px;flex:1">'
    + '<button class="btn" onclick="intuneCopyHandoverUrl()">Copy</button>'
    + '<button class="btn primary" onclick="intuneEmailHandover()">Email it</button>'
    + '</div>';
  html += '<p style="margin:8px 0 0;color:var(--text2);font-size:13px">Expires in 14 days.</p>';

  html += '<div style="margin:14px 0 0;padding:14px;background:#fff;border-radius:6px;border:1px solid var(--border)">';
  if (isAbm) {
    html += '<p style="margin:0 0 6px;font-size:14px"><strong>What ' + esc(_intuneState.person.name.split(' ')[0]) + ' does (much shorter — device is ABM-bound):</strong></p>'
      + '<ol style="margin:0;padding-left:22px;font-size:14px;line-height:1.7">'
      + '<li>Make sure the iPhone is factory-reset (sitting on Setup Assistant welcome).</li>'
      + '<li>Power on, choose language, connect to Wi-Fi.</li>'
      + '<li>"Remote Management" screen appears → tap Continue.</li>'
      + '<li>Username pre-fills as <code>' + esc(_intuneState.person.email) + '</code> — type their council password + MFA.</li>'
      + '<li>Wait ~10 min for apps to install. Done.</li>'
      + '</ol>';
  } else {
    html += '<p style="margin:0 0 6px;font-size:14px"><strong>What ' + esc(_intuneState.person.name.split(' ')[0]) + ' does:</strong></p>'
      + '<ol style="margin:0;padding-left:22px;font-size:14px;line-height:1.7">'
      + '<li>Open the link on the ' + (isIphone ? 'iPhone' : 'Android') + '.</li>'
      + '<li>Tap through to install <strong>Intune Company Portal</strong> from the ' + (isIphone ? 'App Store' : 'Play Store') + '.</li>'
      + '<li>Sign in with <code>' + esc(_intuneState.person.email) + '</code> + MFA.</li>'
      + '<li>Follow the prompts — Company Portal handles ' + (isIphone ? 'the management profile install' : 'the Work Profile setup') + '.</li>'
      + '<li>Wait ~10 minutes for Outlook / Teams / Authenticator to install.</li>'
      + '</ol>';
  }
  html += '</div>';

  html += '</div>';

  // Status watch — poll by serial if we have one, otherwise show a hint
  html += '<div style="margin:0 0 16px;padding:14px;background:var(--surface-alt,#f9fafb);border-radius:8px">';
  html += '<h3 style="margin:0 0 10px;font-size:15px">Live enrolment status</h3>';
  html += '<div id="intune-status-pane" style="font-size:14px">';
  if (_intuneState.serial) html += '<p style="color:var(--text2);margin:0">Polling Intune every 30s for serial <code>' + esc(_intuneState.serial) + '</code>…</p>';
  else html += '<p style="color:var(--text2);margin:0">No serial provided up front — check Intune directly to confirm enrolment, or come back to update the asset record once the device shows up.</p>';
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
  var label = intuneOsLabel(intuneOsEnum());
  var subject = encodeURIComponent('Setting up your ' + label + ' — WSC IT');
  var body = encodeURIComponent(
    'Hi ' + _intuneState.person.name + ',\n\n'
    + 'Your device is ready to set up. Open this link on the device for step-by-step instructions:\n\n'
    + (r.handover_url || '')
    + '\n\nThe link walks you through installing Intune Company Portal and signing in. Takes about 10-15 minutes including app installs.\n\n'
    + 'Link expires in 14 days. Let me know if you hit any snags.\n\n'
    + 'Walgett Shire Council IT'
  );
  window.location.href = 'mailto:' + (_intuneState.person.email || '') + '?subject=' + subject + '&body=' + body;
}
window.intuneEmailHandover = intuneEmailHandover;

function intuneEnrolAnother() {
  var keepPerson = _intuneState.person;
  if (_intuneState.pollTimer) { clearTimeout(_intuneState.pollTimer); }
  _intuneState = {
    step: 'device', person: keepPerson,
    deviceType: null, ownership: 'council', serial: '',
    phoneNumber: '', carrier: '', assetName: '',
    provisionResult: null,
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
