// ─── Check Out / Check In ───────────────────────────

var _checkoutPeople = [];
var _checkoutAssetId = null;
var _checkoutSelected = null;

async function openCheckout(assetId) {
  _checkoutAssetId = assetId;
  _checkoutSelected = null;

  try {
    var pRes = await API.getPeople();
    _checkoutPeople = (pRes.data || []).filter(function(p) { return p.active !== 0; });
  } catch(e) {
    _checkoutPeople = [];
  }

  var html = '<div class="co-wrap">'
    + '<div class="co-search-wrap">'
    + '<svg class="co-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>'
    + '<input type="text" id="co-search" class="co-search-input" placeholder="Search by name, department, or position…" autocomplete="off" oninput="renderCheckoutList()" onkeydown="handleCheckoutKey(event)">'
    + '</div>'
    + '<div class="co-list" id="co-list" role="listbox" tabindex="-1"></div>'
    + '<div class="co-selected-wrap" id="co-selected-wrap" style="display:none">'
    + '<span class="co-selected-label">Assigning to:</span>'
    + '<span class="co-selected-name" id="co-selected-name"></span>'
    + '<button type="button" class="co-selected-clear" onclick="clearCheckoutSelection()">Change</button>'
    + '</div>'
    + '<div class="form-group" style="margin-top:16px"><label class="form-label">Notes</label>'
    + '<textarea id="co-notes" class="form-textarea" placeholder="Optional — handover context, expected return date, etc."></textarea></div>'
    + '<div class="form-group co-ack">'
    + '<label class="co-ack-label">'
    + '<input type="checkbox" id="co-issue" class="co-ack-box" checked>'
    + '<span>Email a signing link to the recipient for receipt acknowledgement</span></label>'
    + '<div id="co-issue-hint" style="font-size:12px;color:var(--text3);margin-top:4px;padding-left:24px">Sent once a person is selected; the recipient signs on a secure page (link expires in 30 days).</div></div>'
    + '<button class="btn primary full co-submit" id="co-submit" onclick="doCheckout()" disabled>Check Out</button>'
    + '</div>';

  openModal('Check Out Asset', html);
  renderCheckoutList();

  setTimeout(function() {
    var s = document.getElementById('co-search');
    if (s) s.focus();
  }, 80);
}
window.openCheckout = openCheckout;

function renderCheckoutList() {
  var el = document.getElementById('co-list');
  if (!el) return;
  var query = (document.getElementById('co-search').value || '').trim().toLowerCase();
  var filtered = !query ? _checkoutPeople : _checkoutPeople.filter(function(p) {
    return (p.name || '').toLowerCase().indexOf(query) !== -1
      || (p.email || '').toLowerCase().indexOf(query) !== -1
      || (p.department || '').toLowerCase().indexOf(query) !== -1
      || (p.position || '').toLowerCase().indexOf(query) !== -1;
  });

  if (!filtered.length) {
    el.innerHTML = '<div class="co-empty">'
      + (_checkoutPeople.length ? 'No people match "' + esc(query) + '"' : 'No active people yet. Add people first.')
      + '</div>';
    return;
  }

  el.innerHTML = filtered.slice(0, 50).map(function(p) {
    var selected = _checkoutSelected === p.id;
    var initials = initialsOf(p.name);
    return '<div class="co-row' + (selected ? ' is-selected' : '') + '" role="option" aria-selected="' + selected + '" data-id="' + esc(p.id) + '" onclick="selectCheckoutPerson(\'' + esc(p.id) + '\')">'
      + '<div class="co-avatar">' + esc(initials) + '</div>'
      + '<div class="co-person">'
      + '<div class="co-name">' + esc(p.name) + '</div>'
      + '<div class="co-meta">'
      + (p.department ? esc(p.department) : '')
      + (p.department && p.position ? ' · ' : '')
      + (p.position ? esc(p.position) : '')
      + (!p.department && !p.position ? (p.email ? esc(p.email) : '—') : '')
      + '</div>'
      + '</div>'
      + (selected ? '<svg class="co-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '')
      + '</div>';
  }).join('');

  if (filtered.length > 50) {
    el.innerHTML += '<div class="co-more">+ ' + (filtered.length - 50) + ' more — refine your search</div>';
  }
}
window.renderCheckoutList = renderCheckoutList;

function initialsOf(name) {
  if (!name) return '?';
  var parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function selectCheckoutPerson(id) {
  _checkoutSelected = id;
  var p = _checkoutPeople.find(function(x) { return x.id === id; });
  var wrap = document.getElementById('co-selected-wrap');
  var nameEl = document.getElementById('co-selected-name');
  var submit = document.getElementById('co-submit');
  if (p && wrap && nameEl) {
    nameEl.textContent = p.name + (p.department ? ' · ' + p.department : '');
    wrap.style.display = 'flex';
  }
  if (submit) submit.disabled = false;
  renderCheckoutList();
}
window.selectCheckoutPerson = selectCheckoutPerson;

function clearCheckoutSelection() {
  _checkoutSelected = null;
  var wrap = document.getElementById('co-selected-wrap');
  var submit = document.getElementById('co-submit');
  if (wrap) wrap.style.display = 'none';
  if (submit) submit.disabled = true;
  renderCheckoutList();
  var s = document.getElementById('co-search');
  if (s) { s.value = ''; s.focus(); }
}
window.clearCheckoutSelection = clearCheckoutSelection;

function handleCheckoutKey(e) {
  var rows = document.querySelectorAll('#co-list .co-row');
  if (!rows.length) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    if (rows.length === 1) selectCheckoutPerson(rows[0].dataset.id);
    else if (_checkoutSelected) { /* submit allowed */ }
    return;
  }
  // Arrow nav — highlight without selecting. Enter confirms.
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    var current = document.querySelector('#co-list .co-row.is-hover');
    var idx = current ? Array.prototype.indexOf.call(rows, current) : -1;
    idx = e.key === 'ArrowDown' ? (idx + 1) % rows.length : (idx - 1 + rows.length) % rows.length;
    rows.forEach(function(r) { r.classList.remove('is-hover'); });
    rows[idx].classList.add('is-hover');
    rows[idx].scrollIntoView({ block: 'nearest' });
  }
}
window.handleCheckoutKey = handleCheckoutKey;

async function doCheckout() {
  if (!_checkoutSelected) { toast('Select a person first', 'error'); return; }
  var submit = document.getElementById('co-submit');
  if (submit) { submit.disabled = true; submit.textContent = 'Checking out…'; }

  var wantsIssue = !!(document.getElementById('co-issue') || {}).checked;
  var person = _checkoutPeople.find(function(p) { return p.id === _checkoutSelected; });
  var canIssue = wantsIssue && person && person.email;

  try {
    var result = await API.checkoutAsset(_checkoutAssetId, {
      person_id: _checkoutSelected,
      notes: (document.getElementById('co-notes').value || '').trim() || undefined
    });
    closeModal();
    toast('Asset checked out', 'success');

    // Best-effort: send the signing link after a successful checkout.
    // Failure here shouldn't roll the checkout back — the checkout is the
    // record of record, the email is convenience on top. Admin can hit
    // "Resend" from the asset detail page.
    if (canIssue) {
      try {
        await API.issueAsset(_checkoutAssetId, { person_id: _checkoutSelected });
        toast('Signing link emailed to ' + person.name, 'success');
      } catch (e) { /* db.js already toasted the error */ }
    } else if (wantsIssue && person && !person.email) {
      toast('Checkout done; no signing link sent — ' + person.name + ' has no email on file', 'error');
    }

    // Prefer the fresh asset returned by the worker (no race). If an older
    // worker is still running and didn't return it, fall back to a re-fetch
    // after a short pause so D1 replicas have time to see the write.
    if (result && result.asset) {
      renderAssetDetail(_checkoutAssetId, result.asset);
    } else {
      await new Promise(function(r){ setTimeout(r, 600); });
      renderAssetDetail(_checkoutAssetId);
    }
  } catch(e) {
    if (submit) { submit.disabled = false; submit.textContent = 'Check Out'; }
  }
}
window.doCheckout = doCheckout;

async function openCheckin(assetId) {
  var html = '<div class="ci-wrap">'
    + '<div class="form-group"><label class="form-label">Condition</label>'
    + '<div class="ci-condition-group">'
    + '<label class="ci-radio"><input type="radio" name="ci-cond" value="good" checked>'
    + '<div class="ci-radio-body"><div class="ci-radio-title">Good</div>'
    + '<div class="ci-radio-sub">Ready for reassignment</div></div></label>'
    + '<label class="ci-radio"><input type="radio" name="ci-cond" value="damaged">'
    + '<div class="ci-radio-body"><div class="ci-radio-title">Damaged</div>'
    + '<div class="ci-radio-sub">Will be set to Maintenance</div></div></label>'
    + '</div></div>'
    + '<div class="form-group"><label class="form-label">Notes</label>'
    + '<textarea id="ci-notes" class="form-textarea" placeholder="Condition notes, return context, etc."></textarea></div>'
    + '<button class="btn primary full" id="ci-submit" onclick="doCheckin(\'' + esc(assetId) + '\')">Check In</button>'
    + '</div>';

  openModal('Check In Asset', html);
}
window.openCheckin = openCheckin;

async function doCheckin(assetId) {
  var submit = document.getElementById('ci-submit');
  if (submit) { submit.disabled = true; submit.textContent = 'Checking in…'; }

  try {
    var cond = document.querySelector('input[name="ci-cond"]:checked');
    var result = await API.checkinAsset(assetId, {
      condition: cond ? cond.value : 'good',
      notes: (document.getElementById('ci-notes').value || '').trim() || undefined
    });
    closeModal();
    toast('Asset checked in' + (result.status === 'maintenance' ? ' — set to maintenance' : ''), 'success');

    if (result && result.asset) {
      renderAssetDetail(assetId, result.asset);
    } else {
      await new Promise(function(r){ setTimeout(r, 600); });
      renderAssetDetail(assetId);
    }
  } catch(e) {
    if (submit) { submit.disabled = false; submit.textContent = 'Check In'; }
  }
}
window.doCheckin = doCheckin;
