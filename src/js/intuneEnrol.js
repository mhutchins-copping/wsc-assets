// ─── Intune Enrolment Wizard ───────────────────────────
// Single-page flow: pick a user, pick a device, click Provision. The
// backend pre-binds via ABM (iOS) or just creates the asset + handover
// URL (everything else). Admin-only — gated server-side as well.
//
// Why one page (was four screens with a Next click between each):
//   * 80%-case is "iPhone, council-owned, no serial in hand" — that
//     should be 3 clicks (search, pick, Provision), not 12.
//   * Live ABM detection only shows when relevant, doesn't gate
//     advancing if you skip the serial.
//   * Optional details (phone number, carrier, custom asset name)
//     stay collapsed unless the operator actually needs them.

var _intuneState = {
  view: 'form',              // 'form' | 'provisioning' | 'done'
  person: null,              // { id, name, email, department }
  deviceType: null,          // 'iphone' | 'android'
  ownership: 'council',      // 'council' | 'personal'
  serial: '',
  phoneNumber: '',
  carrier: '',
  assetName: '',
  preflight: null,           // { mode: 'abm'|'company_portal', depTokenName? } or { ready:false, reason }
  preflightLoading: false,
  preflightDebounce: null,
  showOptional: false,
  provisionResult: null,
  pollTimer: null,
  pollAttempts: 0,
  searchDebounce: null
};

function intuneOsEnum() {
  var t = _intuneState.deviceType, o = _intuneState.ownership;
  if (t === 'iphone'  && o === 'council')  return 'ios';
  if (t === 'iphone'  && o === 'personal') return 'byod_ios';
  if (t === 'android' && o === 'council')  return 'android';
  if (t === 'android' && o === 'personal') return 'byod_android';
  return null;
}

function intuneOsLabel(os) {
  return ({
    ios: 'iPhone (council-owned)',
    android: 'Android (council-owned)',
    byod_ios: 'iPhone (staff-owned)',
    byod_android: 'Android (staff-owned)'
  })[os] || os || 'device';
}
window.intuneOsLabel = intuneOsLabel;

Router.register('/intune-enrol', renderIntuneEnrol);

async function renderIntuneEnrol() {
  var el = document.getElementById('view-intune-enrol');
  if (!el) return;

  if (!Auth.user || Auth.user.role !== 'admin') {
    el.innerHTML = intuneAdminOnlyHtml();
    return;
  }

  if (_intuneState.pollTimer) clearTimeout(_intuneState.pollTimer);
  if (_intuneState.preflightDebounce) clearTimeout(_intuneState.preflightDebounce);

  _intuneState = {
    view: 'form', person: null,
    deviceType: null, ownership: 'council', serial: '',
    phoneNumber: '', carrier: '', assetName: '',
    preflight: null, preflightLoading: false, preflightDebounce: null,
    showOptional: false,
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

  var body;
  if (_intuneState.view === 'provisioning') body = intuneProvisioningHtml();
  else if (_intuneState.view === 'done') body = intuneDoneHtml();
  else body = intuneFormHtml();

  el.innerHTML = '<div style="max-width:720px;margin:0 auto">'
    + '<div style="margin-bottom:18px;display:flex;justify-content:space-between;align-items:center">'
    + '<button class="btn sm" onclick="history.back()">&larr; Back</button>'
    + '<a class="btn sm" href="#/phone-enrol" title="Just register the asset, skip Intune">Asset register only</a>'
    + '</div>'
    + body
    + '</div>';

  intuneBindForm();
}

// ─── Form (the one screen) ───────────────────────────
function intuneFormHtml() {
  var hasPerson = !!_intuneState.person;
  var hasDevice = !!_intuneState.deviceType;
  var canSubmit = hasPerson && hasDevice;

  var html = '<div class="card"><div class="card-body">';
  html += '<h2 style="margin:0 0 4px;font-size:17px">Enrol a device into Intune</h2>'
    + '<p style="margin:0 0 18px;color:var(--text2);font-size:13px">'
    + 'One screen, one button. Optional fields stay tucked away.'
    + '</p>';

  // ── Person ──────────────────────────────────────
  html += intuneSectionLabel('Who is this device for?', hasPerson);
  if (hasPerson) {
    html += '<div style="margin:0 0 18px;padding:12px 14px;background:var(--accent-l);border-left:3px solid #2e5842;border-radius:4px;display:flex;align-items:center;justify-content:space-between;gap:12px">'
      + '<div>'
      + '<strong>' + esc(_intuneState.person.name) + '</strong>'
      + '<div style="font-size:12px;color:var(--text2)">' + esc(_intuneState.person.email)
      + (_intuneState.person.department ? ' &middot; ' + esc(_intuneState.person.department) : '')
      + '</div></div>'
      + '<button class="btn sm" onclick="intuneClearPerson()" title="Pick a different person">Change</button>'
      + '</div>';
  } else {
    html += '<div class="form-group" style="margin-bottom:6px">'
      + '<input id="intune-person-search" type="search" autocomplete="off" placeholder="Search staff (name or email)" class="form-input" autofocus>'
      + '</div>'
      + '<ul id="intune-person-results" style="list-style:none;padding:0;margin:0 0 18px;border:1px solid var(--border);border-radius:6px;max-height:240px;overflow-y:auto;display:none"></ul>';
  }

  // ── Device ──────────────────────────────────────
  html += intuneSectionLabel('What kind of device?', hasDevice);
  var typeOptions = [
    { v: 'iphone',  label: 'iPhone',  emoji: '&#128241;' },
    { v: 'android', label: 'Android', emoji: '&#129302;' }
  ];
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">';
  for (var i = 0; i < typeOptions.length; i++) {
    var t = typeOptions[i];
    var sel = _intuneState.deviceType === t.v;
    html += '<button type="button" onclick="intunePickDeviceType(\'' + t.v + '\')" '
      + 'style="padding:14px 16px;border:2px solid ' + (sel ? '#2e5842' : 'var(--border)')
      + ';border-radius:8px;cursor:pointer;background:' + (sel ? '#2e584210' : 'var(--surface)')
      + ';text-align:center;font-family:inherit">'
      + '<div style="font-size:24px;line-height:1;margin-bottom:4px">' + t.emoji + '</div>'
      + '<strong>' + t.label + '</strong>'
      + '</button>';
  }
  html += '</div>';

  if (hasDevice) {
    // Ownership inline as a single row of two pills, council preselected.
    var ownershipOptions = [
      { v: 'council',  label: 'Council-owned' },
      { v: 'personal', label: 'Staff-owned (BYOD)' }
    ];
    html += '<div style="display:flex;gap:6px;margin-bottom:14px">';
    for (var j = 0; j < ownershipOptions.length; j++) {
      var ow = ownershipOptions[j];
      var owSel = _intuneState.ownership === ow.v;
      html += '<button type="button" onclick="intunePickOwnership(\'' + ow.v + '\')" '
        + 'style="padding:8px 14px;border:1px solid ' + (owSel ? '#2e5842' : 'var(--border)')
        + ';border-radius:999px;background:' + (owSel ? '#2e5842' : 'var(--surface)')
        + ';color:' + (owSel ? '#fff' : 'var(--text)') + ';cursor:pointer;font-size:13px;font-family:inherit">'
        + esc(ow.label) + '</button>';
    }
    html += '</div>';

    var isCouncilIphone = (_intuneState.deviceType === 'iphone' && _intuneState.ownership === 'council');

    // Inline serial input + live ABM status, only for iPhone + Council
    if (isCouncilIphone) {
      html += '<div style="margin-bottom:6px">'
        + '<label class="form-label" style="display:block;margin-bottom:4px">iPhone serial <span style="color:var(--text3);font-weight:400">(optional)</span></label>'
        + '<input id="intune-serial" type="text" autocomplete="off" class="form-input" placeholder="e.g. F2LZHQ7HRPL2" value="' + esc(_intuneState.serial) + '" oninput="intuneOnSerialInput(this.value)">'
        + intuneAbmStatusInlineHtml()
        + '</div>';
    }
  }

  // ── Optional details ────────────────────────────
  if (hasDevice) {
    html += '<div style="margin:18px 0 4px">'
      + '<button type="button" onclick="intuneToggleOptional()" '
      + 'style="background:none;border:none;cursor:pointer;color:var(--text2);font-size:12px;padding:4px 0;font-family:inherit">'
      + (_intuneState.showOptional ? '&minus;' : '+') + ' Optional: phone number, carrier, asset name'
      + '</button></div>';
    if (_intuneState.showOptional) {
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">';
      if (!_intuneState.deviceType === 'iphone' || _intuneState.ownership !== 'council') {
        // For non-council-iPhone, show serial here instead of inline
        html += '<div style="grid-column:1/-1"><label class="form-label">Serial / IMEI</label>'
          + '<input id="intune-serial" type="text" autocomplete="off" class="form-input" placeholder="' + (_intuneState.deviceType === 'iphone' ? 'e.g. F2LZHQ7HRPL2' : 'IMEI (15 digits) or serial') + '" value="' + esc(_intuneState.serial) + '" oninput="_intuneState.serial=this.value.trim()">'
          + '</div>';
      }
      html += '<div><label class="form-label">Phone number</label>'
        + '<input id="intune-phone-number" type="tel" class="form-input" value="' + esc(_intuneState.phoneNumber) + '" placeholder="04xx xxx xxx" oninput="_intuneState.phoneNumber=this.value"></div>'
        + '<div><label class="form-label">Carrier</label>'
        + '<input id="intune-carrier" type="text" class="form-input" value="' + esc(_intuneState.carrier) + '" placeholder="Telstra / Optus" oninput="_intuneState.carrier=this.value"></div>'
        + '<div style="grid-column:1/-1"><label class="form-label">Asset name (override)</label>'
        + '<input id="intune-asset-name" type="text" class="form-input" value="' + esc(_intuneState.assetName) + '" placeholder="Auto: ' + esc(intuneDefaultAssetName()) + '" oninput="_intuneState.assetName=this.value"></div>'
        + '</div>';
    }
  }

  // ── What will happen (mini summary) ─────────────
  if (canSubmit) {
    var willBeAbm = !!(_intuneState.preflight && _intuneState.preflight.mode === 'abm');
    html += '<div style="margin:16px 0;padding:12px 14px;background:'
      + (willBeAbm ? '#10b98112' : '#3b82f610')
      + ';border-left:3px solid ' + (willBeAbm ? '#10b981' : '#3b82f6')
      + ';border-radius:4px;font-size:13px;line-height:1.55">'
      + '<strong>' + (willBeAbm ? 'Zero-touch (ABM)' : 'Company Portal install') + '</strong>'
      + ' &middot; '
      + intuneOsLabel(intuneOsEnum())
      + (willBeAbm
          ? ' &middot; user pre-bound, factory reset on the iPhone, sign in once, done'
          : ' &middot; staff installs Company Portal from app store, signs in')
      + '</div>';
  }

  // ── Actions row ────────────────────────────────
  html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:14px">'
    + '<button class="btn sm" type="button" ' + (canSubmit ? '' : 'disabled ')
    + 'onclick="intuneRunProvision(true)" title="Preview without writing anything">Dry run</button>'
    + '<button class="btn primary" type="button" ' + (canSubmit ? '' : 'disabled ')
    + 'onclick="intuneRunProvision(false)">'
    + (canSubmit ? 'Provision &rarr;' : 'Pick a person + device') + '</button>'
    + '</div>'
    + '<div id="intune-dry-run-result" style="margin-top:14px"></div>';

  html += '</div></div>';
  return html;
}

function intuneSectionLabel(text, done) {
  var dot = done
    ? '<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:#10b981;color:#fff;font-size:11px;line-height:18px;text-align:center;margin-right:8px;vertical-align:middle">&#10003;</span>'
    : '<span style="display:inline-block;width:18px;height:18px;border-radius:50%;border:1px solid var(--border);margin-right:8px;vertical-align:middle"></span>';
  return '<div style="font-size:13px;font-weight:600;color:var(--text);margin:6px 0 10px;display:flex;align-items:center">'
    + dot + esc(text) + '</div>';
}

function intuneDefaultAssetName() {
  if (!_intuneState.person || !_intuneState.deviceType) return 'User — Device';
  return _intuneState.person.name + ' — ' + (_intuneState.deviceType === 'iphone' ? 'iPhone' : 'Android');
}

function intuneAbmStatusInlineHtml() {
  if (_intuneState.preflightLoading) {
    return '<div style="margin-top:8px;font-size:12px;color:var(--text2)">Checking ABM&hellip;</div>';
  }
  var p = _intuneState.preflight;
  if (!p) {
    return _intuneState.serial
      ? ''
      : '<div style="margin-top:6px;font-size:12px;color:var(--text3)">Skip if you don\u2019t have it &mdash; Company Portal install will be used.</div>';
  }
  if (p.mode === 'abm') {
    return '<div style="margin-top:8px;padding:8px 12px;background:#10b98115;border-left:3px solid #10b981;border-radius:4px;font-size:12px">'
      + '<strong style="color:#059669">In ABM</strong>'
      + (p.depTokenName ? ' &middot; ' + esc(p.depTokenName) : '')
      + ' &middot; will pre-bind for zero-touch'
      + '</div>';
  }
  // Not in ABM — show the lighter inline guidance
  return '<details style="margin-top:8px;padding:10px 12px;background:#f59e0b12;border-left:3px solid #f59e0b;border-radius:4px;font-size:12px">'
    + '<summary style="cursor:pointer;font-weight:600">Not in ABM yet (click for ways to fix)</summary>'
    + '<p style="margin:8px 0 4px"><strong>Best:</strong> add to ABM via Apple Configurator on your phone (iPhone is on Setup Assistant welcome screen). Tap +, scan the swirl. Wait ~2 min for sync, then click Recheck.</p>'
    + '<p style="margin:4px 0">Or just continue &mdash; Company Portal install will be used (works fine, no supervision).</p>'
    + '<button class="btn sm" type="button" onclick="intuneTriggerPreflight()" style="margin-top:6px">Recheck</button>'
    + '</details>';
}

// ─── Form interaction ───────────────────────────
function intuneBindForm() {
  if (_intuneState.view !== 'form') return;
  var search = document.getElementById('intune-person-search');
  if (search) {
    search.addEventListener('input', function(e) {
      if (_intuneState.searchDebounce) clearTimeout(_intuneState.searchDebounce);
      var q = e.target.value.trim();
      var results = document.getElementById('intune-person-results');
      if (q.length < 2) { results.style.display = 'none'; results.innerHTML = ''; return; }
      _intuneState.searchDebounce = setTimeout(async function() {
        try {
          var r = await API.intunePeopleSearch(q);
          var rows = (r.results || []);
          if (!rows.length) {
            results.innerHTML = '<li style="padding:10px 12px;color:var(--text3)">No matches</li>';
            results.style.display = 'block';
            return;
          }
          results.innerHTML = rows.map(function(p) {
            return '<li style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border)" '
              + 'onclick="intunePickPerson(\'' + esc(p.id) + '\', \'' + esc((p.name || '').replace(/\u0027/g, '&#39;')) + '\', \'' + esc((p.email || '').replace(/\u0027/g, '&#39;')) + '\', \'' + esc((p.department || '').replace(/\u0027/g, '&#39;')) + '\')">'
              + '<strong>' + esc(p.name) + '</strong> '
              + '<small style="color:var(--text2)">' + esc(p.email || '') + '</small>'
              + (p.department ? ' <small style="color:var(--text3)">&middot; ' + esc(p.department) + '</small>' : '')
              + '</li>';
          }).join('');
          results.style.display = 'block';
        } catch (err) {
          results.innerHTML = '<li style="padding:10px 12px;color:var(--red)">' + esc(err.message) + '</li>';
          results.style.display = 'block';
        }
      }, 200);
    });
  }
}

function intunePickPerson(id, name, email, department) {
  _intuneState.person = { id: id, name: name, email: email, department: department };
  intuneRender();
}
window.intunePickPerson = intunePickPerson;

function intuneClearPerson() {
  _intuneState.person = null;
  intuneRender();
}
window.intuneClearPerson = intuneClearPerson;

function intunePickDeviceType(t) {
  _intuneState.deviceType = t;
  _intuneState.preflight = null;
  intuneRender();
  // Re-trigger ABM check if there's already a serial
  if (_intuneState.serial && intuneOsEnum() === 'ios') intuneTriggerPreflight();
}
window.intunePickDeviceType = intunePickDeviceType;

function intunePickOwnership(o) {
  _intuneState.ownership = o;
  _intuneState.preflight = null;
  intuneRender();
  if (_intuneState.serial && intuneOsEnum() === 'ios') intuneTriggerPreflight();
}
window.intunePickOwnership = intunePickOwnership;

function intuneToggleOptional() {
  _intuneState.showOptional = !_intuneState.showOptional;
  intuneRender();
}
window.intuneToggleOptional = intuneToggleOptional;

function intuneOnSerialInput(value) {
  _intuneState.serial = (value || '').trim();
  _intuneState.preflight = null;
  if (_intuneState.preflightDebounce) clearTimeout(_intuneState.preflightDebounce);
  if (_intuneState.serial.length >= 6 && intuneOsEnum() === 'ios') {
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
    _intuneState.preflight = await API.intunePreflight(os, _intuneState.serial);
  } catch (err) {
    _intuneState.preflight = { ready: false, reason: err.message };
  } finally {
    _intuneState.preflightLoading = false;
    intuneRender();
    var el = document.getElementById('intune-serial');
    if (el) {
      el.focus();
      var v = el.value; el.value = ''; el.value = v;
    }
  }
}
window.intuneTriggerPreflight = intuneTriggerPreflight;

// ─── Provision + states ─────────────────────────
async function intuneRunProvision(dryRun) {
  if (!_intuneState.person || !_intuneState.deviceType) return;
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
  _intuneState.view = 'provisioning';
  intuneRender();
  try {
    var result = await API.intuneProvision(payload, false);
    _intuneState.provisionResult = result;
    _intuneState.view = 'done';
    intuneRender();
    if (_intuneState.serial) intuneBeginStatusPoll();
  } catch (err) {
    _intuneState.view = 'form';
    intuneRender();
    toast('Provision failed: ' + err.message, 'error');
  }
}
window.intuneRunProvision = intuneRunProvision;

function intuneProvisioningHtml() {
  return '<div style="text-align:center;padding:60px 16px">'
    + '<div style="display:inline-block;width:40px;height:40px;border:4px solid var(--border);border-top-color:#2e5842;border-radius:50%;animation:spin 0.9s linear infinite;margin-bottom:16px"></div>'
    + '<style>@keyframes spin { to { transform: rotate(360deg); } }</style>'
    + '<p style="margin:0;font-size:14px">Provisioning&hellip;</p>'
    + '<p style="margin:4px 0 0;color:var(--text2);font-size:13px">5&ndash;15 sec for Graph + ABM round-trips.</p>'
    + '</div>';
}

function intuneDoneHtml() {
  var r = _intuneState.provisionResult || {};
  var isAbm = (r.mode === 'abm');
  var isIphone = _intuneState.deviceType === 'iphone';

  var html = '<div class="card"><div class="card-body">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'
    + '<div>'
    + '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#059669;font-weight:700">Provisioned</div>'
    + '<div style="font-size:18px;font-weight:700">' + esc(r.asset_tag || '') + '</div>'
    + (isAbm
        ? '<span style="display:inline-block;background:#10b981;color:#fff;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:600;margin-top:4px">ABM zero-touch</span>'
        : '<span style="display:inline-block;background:#3b82f6;color:#fff;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:600;margin-top:4px">Company Portal install</span>')
    + '</div>'
    + '<button class="btn" onclick="intuneEnrolAnother()">Enrol another</button>'
    + '</div>';

  if (r.abm_prebind_failed) {
    html += '<div style="margin-bottom:14px;padding:10px 12px;background:#fef3c7;border-left:3px solid #b45309;border-radius:4px;font-size:13px;color:#7c2d12">'
      + 'ABM pre-bind failed; falling back to Company Portal flow. Worker logs have detail.'
      + '</div>';
  }

  // Handover URL — the operator's primary action
  html += '<div style="background:var(--surface2);padding:14px;border-radius:8px;margin-bottom:14px">'
    + '<div style="font-size:13px;font-weight:600;margin-bottom:6px">Send this to ' + esc(_intuneState.person.name.split(' ')[0]) + '</div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
    + '<input id="intune-handover-url" type="text" readonly value="' + esc(r.handover_url || '') + '" class="form-input" style="font-family:ui-monospace,SF Mono,Menlo,Monaco,monospace;font-size:12px;min-width:240px;flex:1">'
    + '<button class="btn" onclick="intuneCopyHandoverUrl()">Copy</button>'
    + '<button class="btn primary" onclick="intuneEmailHandover()">Email it</button>'
    + '</div>'
    + '<div style="font-size:11px;color:var(--text3);margin-top:6px">Expires in 14 days. Page walks ' + esc(_intuneState.person.name.split(' ')[0]) + ' through setup on the device itself.</div>'
    + '</div>';

  // Status pane (live polling for serials)
  html += '<div style="background:var(--surface2);padding:14px;border-radius:8px">'
    + '<div style="font-size:13px;font-weight:600;margin-bottom:6px">Live status</div>'
    + '<div id="intune-status-pane" style="font-size:13px;color:var(--text2)">';
  if (_intuneState.serial) {
    html += 'Polling Intune every 30 seconds for <code>' + esc(_intuneState.serial) + '</code>&hellip;';
  } else {
    html += 'No serial provided up front. Check Intune directly to confirm enrolment, or come back to update the asset record once the device shows up.';
  }
  html += '</div></div>';

  html += '</div></div>';
  return html;
}

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
  if (_intuneState.pollTimer) clearTimeout(_intuneState.pollTimer);
  _intuneState = {
    view: 'form', person: keepPerson,
    deviceType: null, ownership: 'council', serial: '',
    phoneNumber: '', carrier: '', assetName: '',
    preflight: null, preflightLoading: false, preflightDebounce: null,
    showOptional: false,
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
    if (!pane) return;
    try {
      var r = await API.intuneDeviceStatus(_intuneState.serial);
      if (r.enrolled) {
        pane.innerHTML = '<div style="color:#059669;font-weight:600;margin-bottom:6px">&#10003; Device enrolled</div>'
          + '<dl style="display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0">'
          + '<dt style="font-weight:600">Device name</dt><dd style="margin:0">' + esc(r.deviceName || '') + '</dd>'
          + '<dt style="font-weight:600">OS</dt><dd style="margin:0">' + esc((r.operatingSystem || '') + ' ' + (r.osVersion || '')) + '</dd>'
          + '<dt style="font-weight:600">Compliance</dt><dd style="margin:0">' + esc(r.complianceState || '') + '</dd>'
          + '<dt style="font-weight:600">Last sync</dt><dd style="margin:0">' + esc(r.lastSyncDateTime || '') + '</dd>'
          + '<dt style="font-weight:600">Primary user</dt><dd style="margin:0">' + esc(r.userPrincipalName || '(none)') + '</dd>'
          + '</dl>';
        return;
      }
      pane.innerHTML = 'Not enrolled yet (poll #' + _intuneState.pollAttempts + '). Will check again in 30s.';
    } catch (err) {
      pane.innerHTML = '<span style="color:var(--red)">Status check failed: ' + esc(err.message) + '</span>';
    }
    if (_intuneState.pollAttempts < 20) {
      _intuneState.pollTimer = setTimeout(tick, 30000);
    } else {
      pane.innerHTML += '<div style="margin-top:6px;font-size:12px">Stopped polling after 10 min. Refresh manually if needed.</div>';
    }
  };
  _intuneState.pollTimer = setTimeout(tick, 5000);
}
