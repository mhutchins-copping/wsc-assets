// ─── Microsoft Intune Wrappers ──────────────────────
// Thin functional wrappers over Microsoft Graph for the council MDM
// enrolment workflow. Every call goes through fetchGraph() so 401/429
// handling and token caching live in one place (lib/graph.js).
//
// Endpoint conventions:
//   - Intune-specific endpoints live under /beta. Microsoft has signalled
//     that v1.0 equivalents are coming, but until then beta is the only
//     surface for ABM/DEP and Android Enterprise enrolment profiles.
//   - When v1.0 lands, swap GRAPH_BETA → GRAPH_V1 in the constant table
//     below; one constant per endpoint keeps the migration trivial.

import { fetchGraph } from './graph.js';

const GRAPH_V1 = 'https://graph.microsoft.com/v1.0';
const GRAPH_BETA = 'https://graph.microsoft.com/beta';

// Apple Push Notification certificate health
export async function getApnsHealth(env) {
  return fetchGraph(env, 'GET', `${GRAPH_V1}/deviceManagement/applePushNotificationCertificate`);
}

// VPP / ABM Apps & Books tokens
export async function getVppTokens(env) {
  const r = await fetchGraph(env, 'GET', `${GRAPH_V1}/deviceAppManagement/vppTokens`);
  return r?.value || [];
}

// DEP onboarding (ABM) tokens — there can be more than one (Walgett
// has two; the second one needs MSP investigation).
export async function getDepTokens(env) {
  const r = await fetchGraph(env, 'GET', `${GRAPH_BETA}/deviceManagement/depOnboardingSettings`);
  return r?.value || [];
}

// Apple enrolment profiles under a specific DEP token.
export async function getAppleEnrolmentProfiles(env, depTokenId) {
  const r = await fetchGraph(env, 'GET', `${GRAPH_BETA}/deviceManagement/depOnboardingSettings/${depTokenId}/enrollmentProfiles`);
  return r?.value || [];
}

// Android Enterprise corporate-owned enrolment profiles (Fully Managed,
// Personal Work Profile defaults, AOSP user-associated, etc.).
export async function getAndroidEnrolmentProfiles(env) {
  const r = await fetchGraph(env, 'GET', `${GRAPH_BETA}/deviceManagement/androidDeviceOwnerEnrollmentProfiles`);
  return r?.value || [];
}

// Combined profile listing for the wizard's profile pickers.
export async function getProfiles(env) {
  const [depTokens, android] = await Promise.all([
    getDepTokens(env).catch(e => { console.warn('intune: getDepTokens failed:', e.message); return []; }),
    getAndroidEnrolmentProfiles(env).catch(e => { console.warn('intune: getAndroidEnrolmentProfiles failed:', e.message); return []; }),
  ]);

  const apple = [];
  for (const t of depTokens) {
    const profs = await getAppleEnrolmentProfiles(env, t.id).catch(e => {
      console.warn(`intune: getAppleEnrolmentProfiles(${t.id}) failed:`, e.message);
      return [];
    });
    for (const p of profs) {
      apple.push({
        id: p.id,
        displayName: p.displayName,
        description: p.description,
        isDefault: !!p.isDefault,
        depTokenId: t.id,
        depTokenName: t.tokenName,
      });
    }
  }

  return {
    apple,
    android: android.map(p => ({
      id: p.id,
      displayName: p.displayName,
      description: p.description,
      enrollmentMode: p.enrollmentMode,
      tokenExpirationDateTime: p.tokenExpirationDateTime,
    })),
  };
}

// Look up an imported Apple device identity (i.e. a serial registered in
// ABM under one of our DEP tokens). Returns { token, identity } if found,
// or null if the serial isn't in ABM at all.
export async function findAppleDeviceInAbm(env, serial) {
  const tokens = await getDepTokens(env);
  for (const t of tokens) {
    const filter = encodeURIComponent(`serialNumber eq '${serial}'`);
    const r = await fetchGraph(
      env,
      'GET',
      `${GRAPH_BETA}/deviceManagement/depOnboardingSettings/${t.id}/importedAppleDeviceIdentities?$filter=${filter}`
    ).catch(e => {
      console.warn(`intune: importedAppleDeviceIdentities query failed for token ${t.id}:`, e.message);
      return null;
    });
    if (r?.value?.length) {
      return { token: t, identity: r.value[0] };
    }
  }
  return null;
}

// Pre-bind a user to a DEP-assigned device so Setup Assistant pre-fills
// the Apple ID prompt with the council username. Reduces the "user
// gets to the welcome screen and types the wrong account" failure mode.
export async function assignUserToDepDevice(env, { depTokenId, profileId, serial, upn, addressableUserName }) {
  return fetchGraph(env, 'POST', `${GRAPH_BETA}/deviceManagement/depOnboardingSettings/${depTokenId}/enrollmentProfiles/${profileId}/assignUserToDevice`, {
    userPrincipalName: upn,
    deviceId: serial,
    addressableUserName: addressableUserName || '',
  });
}

// Force ABM ↔ Intune sync. Useful to call when a freshly-bought serial
// hasn't shown up in Intune yet (Apple typically syncs every ~12h on
// its own; this kicks it manually).
export async function syncDep(env, depTokenId) {
  return fetchGraph(env, 'POST', `${GRAPH_BETA}/deviceManagement/depOnboardingSettings/${depTokenId}/syncWithAppleDeviceEnrollmentProgram`);
}

// Mint a fresh enrolment token + QR for an Android Device Owner profile.
// Returns the full profile incl. qrCodeContent (base64 JSON blob to
// render as QR) and tokenValue.
export async function createAndroidEnrolmentToken(env, { profileId, validitySeconds = 7776000 }) {
  return fetchGraph(env, 'POST', `${GRAPH_BETA}/deviceManagement/androidDeviceOwnerEnrollmentProfiles/${profileId}/createToken`, {
    tokenValidityInSeconds: validitySeconds,
  });
}

// Get the *current* token/QR fields off the profile without minting a
// new one. Tokens that haven't expired can be reused; this is cheaper
// than mint-on-every-request and gives stable QR codes.
export async function getAndroidEnrolmentProfile(env, profileId) {
  return fetchGraph(env, 'GET', `${GRAPH_BETA}/deviceManagement/androidDeviceOwnerEnrollmentProfiles/${profileId}`);
}

// Find an Intune managedDevice by serial number. Returns null if not
// found (e.g. enrolment hasn't completed yet).
export async function getManagedDeviceBySerial(env, serial) {
  const filter = encodeURIComponent(`serialNumber eq '${serial}'`);
  const r = await fetchGraph(env, 'GET', `${GRAPH_BETA}/deviceManagement/managedDevices?$filter=${filter}`);
  return r?.value?.[0] || null;
}

// Set the primary user of a managed device after enrolment. Used when
// the device autonomously enrolled (BYOD/AOSP) without our pre-binding.
export async function setPrimaryUser(env, { managedDeviceId, userId }) {
  return fetchGraph(env, 'POST', `${GRAPH_BETA}/deviceManagement/managedDevices/${managedDeviceId}/users/$ref`, {
    '@odata.id': `${GRAPH_V1}/users/${userId}`,
  });
}

// Static-group fallback: add a device to an Entra group by serial. Only
// needed until Phase 0's dynamic-group conversion is verified. Resolve
// serial → managedDevice → azureADDeviceId → Entra device object → add.
// Slow, multi-hop. Intentionally fragile so we feel motivated to delete
// it once the dynamic groups are confirmed working.
export async function addDeviceToGroup(env, { serial, groupId }) {
  const md = await getManagedDeviceBySerial(env, serial);
  if (!md?.azureADDeviceId) throw new Error(`Managed device for serial ${serial} not found, or has no azureADDeviceId`);
  const devFilter = encodeURIComponent(`deviceId eq '${md.azureADDeviceId}'`);
  const devLookup = await fetchGraph(env, 'GET', `${GRAPH_V1}/devices?$filter=${devFilter}`);
  const device = devLookup?.value?.[0];
  if (!device) throw new Error(`Entra device object for azureADDeviceId ${md.azureADDeviceId} not found`);
  return fetchGraph(env, 'POST', `${GRAPH_V1}/groups/${groupId}/members/$ref`, {
    '@odata.id': `${GRAPH_V1}/directoryObjects/${device.id}`,
  });
}

// Resolve an Entra user object by UPN/email — used to get the user `id`
// (Entra GUID) needed for setPrimaryUser.
export async function getUserByUpn(env, upn) {
  return fetchGraph(env, 'GET', `${GRAPH_V1}/users/${encodeURIComponent(upn)}`);
}

// One-shot health summary for the dashboard widget.
// Returns expiry dates + days-remaining for ABM, VPP, APNs.
export async function getEnrolmentHealth(env) {
  const [apns, vpp, dep] = await Promise.all([
    getApnsHealth(env).catch(() => null),
    getVppTokens(env).catch(() => []),
    getDepTokens(env).catch(() => []),
  ]);

  const daysUntil = (iso) => {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  };

  return {
    apns: apns ? {
      appleIdentifier: apns.appleIdentifier,
      expirationDateTime: apns.expirationDateTime,
      daysRemaining: daysUntil(apns.expirationDateTime),
    } : null,
    vpp: vpp.map(v => ({
      appleId: v.appleId,
      expirationDateTime: v.expirationDateTime,
      state: v.state,
      daysRemaining: daysUntil(v.expirationDateTime),
    })),
    dep: dep.map(d => ({
      id: d.id,
      tokenName: d.tokenName,
      appleIdentifier: d.appleIdentifier,
      tokenExpirationDateTime: d.tokenExpirationDateTime,
      daysRemaining: daysUntil(d.tokenExpirationDateTime),
    })),
  };
}

// Read-only preflight — checks whether a given serial+OS is actually
// enrol-able right now. Returns:
//   { ready: true, ...context } when the wizard can proceed
//   { ready: false, reason: string } with a human-readable explanation
//
// For iOS this means: serial is registered in ABM under one of our DEP
// tokens, and the token is not expired.
// For Android Corporate this means: a valid enrolment profile exists
// and the Android Enterprise binding is healthy. (Serial isn't checked
// for Android — devices are enrolled by QR scan, not pre-binding.)
// For BYOD: always ready (no Graph writes happen, just instructions).
export async function preflight(env, { serial, os }) {
  if (os === 'byod_android' || os === 'byod_ios') {
    return { ready: true, mode: 'instructions_only' };
  }

  if (os === 'ios') {
    if (!serial) return { ready: false, reason: 'serial is required for iOS enrolment' };
    const found = await findAppleDeviceInAbm(env, serial);
    if (!found) {
      return {
        ready: false,
        reason: `Serial ${serial} not found in any ABM token. Either it wasn't bought through an ABM-enrolled reseller, or ABM/Intune sync hasn't run yet. Try the "Sync ABM" button or use Apple Configurator to add it manually.`,
      };
    }
    const tokenExpiresInDays = (() => {
      if (!found.token.tokenExpirationDateTime) return null;
      return Math.floor((new Date(found.token.tokenExpirationDateTime).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    })();
    if (tokenExpiresInDays !== null && tokenExpiresInDays < 0) {
      return { ready: false, reason: `ABM token "${found.token.tokenName}" expired ${-tokenExpiresInDays} days ago. Renew it in Intune before enrolling.` };
    }
    return {
      ready: true,
      depTokenId: found.token.id,
      depTokenName: found.token.tokenName,
      identity: found.identity,
    };
  }

  if (os === 'android' || os === 'aosp') {
    const profiles = await getAndroidEnrolmentProfiles(env);
    const usable = profiles.filter(p => {
      if (!p.tokenExpirationDateTime) return true;
      return new Date(p.tokenExpirationDateTime).getTime() > Date.now();
    });
    if (!usable.length) {
      return { ready: false, reason: 'No usable Android enrolment profile found. Check Intune → Devices → Android → Enrollment.' };
    }
    return { ready: true, profiles: usable };
  }

  return { ready: false, reason: `Unknown OS: ${os}` };
}
