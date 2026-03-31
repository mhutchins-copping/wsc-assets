// ─── Step 6: Check Out / Check In ──────────────

async function openCheckout(assetId) {
  // Load people + locations for dropdowns
  var people = [], locations = [];
  try {
    var pRes = await API.getPeople();
    people = pRes.data || [];
    var lRes = await API.getLocations();
    locations = lRes.data || [];
  } catch(e) { /* proceed empty */ }

  var html = '<div class="form-group"><label class="form-label">Assign To</label>'
    + '<select id="co-person" class="form-select"><option value="">Select person...</option>';
  people.forEach(function(p) {
    html += '<option value="' + esc(p.id) + '">' + esc(p.name) + (p.department ? ' (' + esc(p.department) + ')' : '') + '</option>';
  });
  html += '</select></div>';

  html += '<div class="form-group"><label class="form-label">Location</label>'
    + '<select id="co-location" class="form-select"><option value="">Keep current location</option>';
  locations.forEach(function(l) {
    html += '<option value="' + esc(l.id) + '">' + esc(l.name) + '</option>';
  });
  html += '</select></div>';

  html += '<div class="form-group"><label class="form-label">Notes</label>'
    + '<textarea id="co-notes" class="form-textarea" placeholder="Optional notes"></textarea></div>';

  html += '<div class="form-group" style="margin-bottom:20px">'
    + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">'
    + '<input type="checkbox" id="co-ack" style="width:16px;height:16px">'
    + ' User acknowledges receipt of this asset</label></div>';

  html += '<button class="btn primary full" onclick="doCheckout(\'' + esc(assetId) + '\')">Check Out</button>';

  openModal('Check Out Asset', html);
}
window.openCheckout = openCheckout;

async function doCheckout(assetId) {
  var personId = document.getElementById('co-person').value;
  if (!personId) { toast('Select a person', 'error'); return; }

  try {
    await API.checkoutAsset(assetId, {
      person_id: personId,
      location_id: document.getElementById('co-location').value || undefined,
      notes: document.getElementById('co-notes').value.trim() || undefined
    });
    closeModal();
    toast('Asset checked out', 'success');
    renderAssetDetail(assetId);
  } catch(e) { /* toasted */ }
}
window.doCheckout = doCheckout;

async function openCheckin(assetId) {
  var html = '<div class="form-group"><label class="form-label">Condition</label>'
    + '<select id="ci-condition" class="form-select">'
    + '<option value="good">Good</option>'
    + '<option value="damaged">Damaged — needs repair</option>'
    + '<option value="needs_repair">Needs Repair</option>'
    + '</select>'
    + '<div class="form-hint">If damaged, asset will be set to Maintenance status</div></div>';

  html += '<div class="form-group"><label class="form-label">Notes</label>'
    + '<textarea id="ci-notes" class="form-textarea" placeholder="Optional notes about condition"></textarea></div>';

  html += '<button class="btn primary full" onclick="doCheckin(\'' + esc(assetId) + '\')">Check In</button>';

  openModal('Check In Asset', html);
}
window.openCheckin = openCheckin;

async function doCheckin(assetId) {
  try {
    var result = await API.checkinAsset(assetId, {
      condition: document.getElementById('ci-condition').value,
      notes: document.getElementById('ci-notes').value.trim() || undefined
    });
    closeModal();
    toast('Asset checked in' + (result.status === 'maintenance' ? ' — set to maintenance' : ''), 'success');
    renderAssetDetail(assetId);
  } catch(e) { /* toasted */ }
}
window.doCheckin = doCheckin;
