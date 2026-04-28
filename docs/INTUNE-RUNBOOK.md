# Intune device enrolment — runbook

> **Document:** Intune device enrolment runbook
> **Owner (role):** IT Officer, Walgett Shire Council
> **Last updated:** 2026-04-28

The asset register doesn't enrol devices into Intune. This document is
the cheat sheet for doing it directly in the Intune portal +
Apple Business Manager + Managed Google Play, depending on the device.

After every successful enrolment: add an asset row in WSC Assets so
the device shows up in the register too. (Settings → Assets → New, or
let the staff member's PowerShell enrolment script populate it on
first sign-in if it's a Windows PC.)

## Contents

- [Prerequisites](#prerequisites)
- [iPhone, council-owned, in ABM](#iphone-council-owned-in-abm)
- [iPhone, council-owned, NOT in ABM yet](#iphone-council-owned-not-in-abm-yet)
- [iPhone, staff-owned (BYOD)](#iphone-staff-owned-byod)
- [Android, council-owned (Fully Managed)](#android-council-owned-fully-managed)
- [Android, staff-owned (Work Profile / BYOD)](#android-staff-owned-work-profile--byod)
- [Windows endpoint](#windows-endpoint)
- [After enrolment — verify](#after-enrolment--verify)

---

## Prerequisites

These are one-off setup items. Should already be in place; included
here so a successor knows what to look for if anything's missing.

- **Cloudflare Access SSO** lets staff sign into M365 with their
  council Entra ID account. This is the ID we hand out and bind
  devices to.
- **Apple Business Manager** is enrolled and synced to Intune. ABM
  identifier: `mdm@walgett.nsw.gov.au`. The MDM server in ABM is
  *Walgett Shire Council – Intune*. **Apple Configurator** (free iOS
  app) on Matthew's iPhone is signed in with the same `mdm@`
  identity — that's how we add consumer-bought iPhones to ABM.
- **Managed Google Play** is connected to the tenant. Apps are
  approved at *Intune portal → Apps → Managed Google Play* and synced
  to the Intune app catalog. Microsoft 365 apps + Google Photos +
  OneDrive are already approved.
- **Dynamic device groups** for pilot rollout exist:
  - `MDM – Android Pilot Devices` — rule:
    `(device.enrollmentProfileName -startsWith "Android") and (device.deviceOwnership -eq "Company")`
    Note: the rule used to filter on `device.deviceOSType -eq "Android"`,
    which silently broke for Android Enterprise Fully Managed devices
    (their `deviceOSType` is empty). Don't change this rule back.
  - `MDM – Pilot Devices` (iOS) — rule:
    `(device.deviceOSType -eq "iOS") and (device.deviceOwnership -eq "Company")`
- **App Protection (MAM) policies** for iOS + Android are deployed
  and target *All Staff*. They cover Outlook / Teams / OneDrive /
  Word / Excel / PowerPoint / OneNote / Authenticator / SharePoint /
  Edge. App PIN, no backup, no print, restricted copy-paste to
  managed apps.
- **Compliance policies** exist for iOS (auto-lock 5 min, OS 17+),
  Android Fully Managed (encryption, OS 13+, auto-lock), and Windows
  (BitLocker, Defender, Secure Boot, OS 22H2+).
- **Conditional Access** — *WSC – Require compliant device or
  approved app for M365* exists in **report-only**. Enforce it once
  you're confident it doesn't lock anyone out (review sign-in logs
  for "Report-only: Failure").

---

## iPhone, council-owned, in ABM

**When this applies:** new council-bought iPhone that already shows
up in Apple Business Manager (e.g. bought through an ABM-enrolled
reseller, or added via Apple Configurator before).

**What the staff member experiences:** zero-touch. They power on a
factory-reset device, choose language and Wi-Fi, sign in once with
their council credentials. Apps install in the background. ~5 min.

### Steps

1. Confirm the iPhone serial is in ABM:
   - *ABM → Devices → search by serial*. Should show *Assigned to
     Walgett Shire Council – Intune*.
   - If not found, follow [the next section](#iphone-council-owned-not-in-abm-yet)
     instead.
2. Hand the iPhone to the staff member with these instructions:
   - "Take it out of the box, charge it, factory-reset isn't needed
     since it's new."
   - "Power on, follow Setup Assistant, sign in with your council
     email and password when prompted."
3. Watch *Intune portal → Devices → All devices* for the device to
   show up. Usually 5–10 min after the staff member signs in.
4. Add an asset row in WSC Assets:
   - Settings → Assets → New
   - Name: `Firstname Lastname — iPhone`
   - Category: Phone
   - Serial: from the iPhone box / *About → Serial Number*
   - Assigned to: the staff member
5. Send them the standard receipt-signing email from the asset
   detail page.

---

## iPhone, council-owned, NOT in ABM yet

**When this applies:** iPhone bought from JB Hi-Fi or similar, not
through an ABM-enrolled reseller. Most council iPhones land here.

**Two options:**

### Option A — add to ABM via Apple Configurator (recommended)

Result: iPhone becomes ABM-bound and uses the zero-touch flow above.
Adds one step to your side; saves the staff member ~10 min.

1. Factory reset the iPhone. Leave it on the *Hello* /
   language-picker screen. (It must be sitting on Setup Assistant —
   not signed in to anything, not joined to Wi-Fi yet.)
2. Open **Apple Configurator** on your iPhone (the one signed in as
   `mdm@walgett.nsw.gov.au`).
3. Tap **+** → **Add to Apple Business Manager**.
4. Choose MDM Server **Walgett Shire Council – Intune**.
5. Point your camera at the swirl pattern on the new iPhone's
   Setup Assistant screen. Capture in 1–2 seconds.
6. Wait ~2 minutes for ABM ↔ Intune sync. *Intune portal → Devices
   → Apple → Enrolment program tokens → (your token) → Sync* if
   you want to force it.
7. Continue with [the in-ABM flow above](#iphone-council-owned-in-abm).

### Option B — skip ABM, use Company Portal install

Result: iPhone is enrolled but **not supervised** (fewer management
options). Staff member installs Company Portal manually. ~15 min on
their side.

1. Hand them the iPhone.
2. Tell them to install **Intune Company Portal** from the App
   Store, sign in with their council credentials, and follow the
   prompts.
3. Wait for the device to appear in *Intune portal → Devices*.
4. Add the asset row in WSC Assets (as above).

---

## iPhone, staff-owned (BYOD)

**When this applies:** staff member uses their personal iPhone for
work email + Teams. Council does NOT enrol the device. Council does
protect council data inside the work apps via App Protection (MAM)
policies, which are already deployed.

**What the staff member experiences:** they install Outlook, Teams,
Authenticator, etc. from the App Store like any normal user. On
first sign-in to a council account, the app prompts for an app PIN
and applies the MAM policy. They can use council apps and personal
apps freely; council can't see their personal data.

### Steps

1. Tell them to install from the App Store: Outlook, Teams,
   Authenticator, OneDrive, Word/Excel/PowerPoint/OneNote, SharePoint,
   Edge — whichever they need.
2. Sign in to each with their council credentials.
3. App PIN setup runs automatically on first launch.
4. **No asset row needed** in WSC Assets — it's their device, not
   council property.

If they leave the council, you can selectively wipe the council data
from those apps via *Intune portal → Apps → App selective wipe*.

---

## Android, council-owned (Fully Managed)

**When this applies:** new council-bought Android (Samsung etc.). The
device becomes a corporate-managed phone. Staff member has no
personal side — only apps IT publishes via Managed Google Play
appear. Most secure mode; least flexible for staff.

**Trade-off note:** if the staff member needs personal apps, Spotify,
WhatsApp etc., this mode isn't right for them — use a personal Work
Profile setup or push them to BYOD. Fully Managed = locked-down
council device.

### Steps

1. **Boot the device, do NOT add a Google account** during Setup.
   Stop at the welcome screen.
2. Tap the welcome screen 6 times. The QR scanner opens.
3. Connect to Wi-Fi.
4. Scan the QR code from *Intune portal → Devices → Android →
   Android enrolment → Corporate-owned, fully managed user devices*
   (or similar — Microsoft moves these around).
5. Device downloads Android Device Policy + provisions. Takes
   2–5 min. Then Setup Assistant resumes; staff member signs in
   with their council credentials when prompted.
6. Confirm the device is in the right group: it should match
   `MDM – Android Pilot Devices` and pick up the assigned apps
   (Outlook, Teams, OneDrive, Authenticator, SharePoint, Photos,
   Managed Home Screen). If apps don't show up after ~30 min, see
   [troubleshooting](#troubleshooting).
7. Add asset row in WSC Assets.

---

## Android, staff-owned (Work Profile / BYOD)

**When this applies:** staff member uses their personal Android.
Same idea as iPhone BYOD — council manages a Work Profile container
on their phone, not the whole device.

### Steps

1. Tell them to install **Intune Company Portal** from Google Play.
2. Sign in with their council credentials.
3. Company Portal prompts to set up a Work Profile. Walk through.
4. Work apps (Outlook, Teams, etc.) install into the Work Profile
   automatically — they appear with a small briefcase badge.
5. Personal side untouched.

No asset row needed — it's their device.

---

## Windows endpoint

**Two paths**, depending on device origin:

### Autopilot (preferred — for new devices)

If the device shipped via an OEM that's registered with Autopilot
(or you've added the hash to Autopilot), the device auto-enrols on
first boot. Staff member powers on, signs in with council
credentials, device joins Entra + enrolls in Intune. No IT touch.

### Manual / co-managed (existing fleet)

For domain-joined Windows PCs already in the council, MDM enrolment
typically happens via group policy + auto-enrol. Verify in *Settings
→ Accounts → Access work or school* on the endpoint.

For one-off enrolment:
1. *Settings → Accounts → Access work or school → Connect*
2. Sign in with council credentials
3. Device joins Entra + enrolls in Intune in one shot
4. Compliance policy applies (BitLocker, Defender, etc.)

### Asset register

The PowerShell enrolment script (run via the password-gated launcher
at <https://api.it-wsc.com/enrol>) populates the asset register
automatically. No manual asset row needed — but you can run it on
existing PCs to refresh specs at any time.

---

## After enrolment — verify

For every device, check these before declaring it done:

- [ ] **Intune portal → Devices**: device appears, marked *Compliant*
  (allow up to 30 min for compliance evaluation).
- [ ] **Microsoft Authenticator**: staff member can complete an MFA
  prompt on the device.
- [ ] **Outlook**: opens, prompts for app PIN (if MAM applies), shows
  council inbox.
- [ ] **Teams**: opens, signs in, can send a test message.
- [ ] **Asset register row** (council-owned only): exists with
  serial, assignment, and category. Receipt sent + signed if
  process requires.

---

## Troubleshooting

**Apps don't show up on a new Android Fully Managed device after
30 min.** The dynamic group `MDM – Android Pilot Devices` decides
which apps the device gets. Verify:
- *Entra portal → Groups → MDM – Android Pilot Devices → Members*
  → the device should be listed.
- If not, confirm the device's `enrollmentProfileName` (in *Entra →
  Devices → search by name → Properties*) matches the group's
  membership rule. Rule expects names starting with "Android".
- Force re-evaluation: *Group → Dynamic membership rules →
  Validate rules*.

**Device shows in Intune but as "Not registered" in Entra.** The
Entra device object hasn't synced yet. Usually 5–10 min after Intune
enrolment. If it persists past 30 min, retire + re-enrol.

**Compliance flips to Non-compliant after a policy change.** Expected.
There's a 24-hour grace period before the device is actually blocked
(if Conditional Access is enforcing). Have the user reboot the device
and open Company Portal → Settings → Sync to expedite.

**Staff member can't sign in to Outlook on BYOD iPhone.** Likely
Conditional Access is enforcing and the device isn't compliant +
not using a managed app. Confirm the App Protection policy is
deployed to their account; have them sign in to Outlook (the
official MS Outlook app, not Apple Mail).

**The iPhone "looks empty" — only Camera is there, no Gallery, no
Outlook.** Android Fully Managed mode (note: iPhone analog rare).
For Android: device is in Fully Managed mode and only IT-published
apps appear. Push Google Photos / OneDrive via Managed Google Play
to give them gallery functionality. If they need Spotify etc., the
device is in the wrong management mode — see [Android
Fully Managed](#android-council-owned-fully-managed) trade-off note.

---

## Where to read more

- *docs/OPERATIONS.md* — backups, secret rotation, restore
- *docs/ARCHITECTURE.md* — how WSC Assets fits in
- Microsoft Learn → *Intune device enrolment* — the canonical docs
- ABM portal at <https://business.apple.com> — when ABM things
  break
