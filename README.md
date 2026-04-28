# WSC Assets

Internal IT operations app for Walgett Shire Council. Tracks every
piece of council IT — laptops, phones, monitors, the consumables
shelf — plus the people who use them, the receipts they sign, and
the day-to-day runbook for keeping the lot in working order.

What's inside, end-to-end:

- **Asset register** — laptops, desktops, phones, peripherals; full
  lifecycle from provisioning to disposal, with QR labels, signed
  handover receipts, audits, and loaner pool.
- **Consumables / inventory** — quantity-tracked stock for commodity
  items (keyboards, mice, chargers, cables, toner, cases) with
  movement history and issue-to-staff workflow.
- **People directory** — Entra-synced staff list with per-person
  asset count, used during onboarding and leaver handovers.
- **Self-service** — staff see their own gear and can flag faults
  directly from the asset detail page; receipts get signed via a
  public token-gated page.
- **Operational tooling** — health checks + error alerts, weekly
  lifecycle digest (warranty / retirement), scheduled cleanups,
  in-app IT Runbook for the trainee, full incident playbook.

Live at **[assets.it-wsc.com](https://assets.it-wsc.com)** (access
restricted to council staff via Cloudflare Access SSO).

---

## Documentation

**New to the project? Start with [docs/ONBOARDING.md](docs/ONBOARDING.md).**
It walks through concepts, day-one setup, and a first-change tutorial.

The rest of the docs:

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — what the system is,
  how it's put together, and why these choices were made.
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — day-to-day runbook.
  Deployment, backups, restore, user management, incident response,
  migrations, secret rotation.
- **[docs/GOVERNANCE.md](docs/GOVERNANCE.md)** — one-page executive
  summary. Data location, ownership, BCP, cost, risk, and security
  controls.
- **[docs/INTUNE-RUNBOOK.md](docs/INTUNE-RUNBOOK.md)** — practical
  enrolment recipes (iPhone via ABM, Android Fully Managed, BYOD
  Work Profile, etc). Intune lives outside this app; this is the
  cheat sheet for using it.
- **[docs/INCIDENT-PLAYBOOK.md](docs/INCIDENT-PLAYBOOK.md)** —
  symptom-driven incident response. Site down, deploy red, sign-ins
  failing, restore needed, secrets leaked. Each with first-thing-
  to-check + escalation path.

Those six cover the full picture. The rest of this README is a
quick-reference.

## What's inside

- **Frontend** — static site, vanilla JS + Vite, hosted on Cloudflare
  Pages. UI built around Inter (body) and JetBrains Mono (tags and IDs).
- **API** — single Cloudflare Worker, `worker/worker.js`.
- **Database** — Cloudflare D1 (SQLite). Fresh-install schema in
  `worker/schema.sql`; incremental changes tracked in
  `worker/migrations/` and applied automatically on deploy.
- **Storage** — Cloudflare R2 for asset photos.
- **Auth** — Cloudflare Access in front for Microsoft Entra SSO, plus a
  local `users` table for in-app authorisation (default-deny). See
  ARCHITECTURE.md for the full flow.

## Features

- **Asset lifecycle** — register, assign, service, audit, dispose, purge.
  Auto-generated asset tags (`WSC-L-0042` style) with QR codes.
- **Mobile-first asset list** — under 768px the list swaps from a table to
  thumb-reachable cards, tap targets are bumped to Apple's minimum, and
  inputs are pinned to 16px to stop iOS zoom on focus.
- **Check out / check in** — keyboard-navigable person picker with live
  search and acknowledgement.
- **Signed receipts** — on check-out, email the recipient a token-gated
  signing link (no SSO needed on their end); they draw a signature on a
  public page and the signed receipt is stored with the asset. Admins
  can resend, cancel, or view past signatures from a dedicated Receipts
  screen.
- **QR label printing** — single-asset or batch. Multi-select rows on
  the asset list, click "Print selected", get an A4 sheet laid out for
  Avery L7160 (21 labels) with cut guides for plain paper. Scanning a
  printed sticker opens the asset detail page via a short `#/a/<tag>`
  route.
- **Activity log** — every mutation recorded with the acting user,
  timestamp, and source IP.
- **Dashboard** — KPIs (Total / Deployed / Available / Needs Attention),
  status breakdown, recent activity, top categories.
- **Reports** — breakdowns by status, category, department, assignee,
  OS, manufacturer.
- **Floor-walk audits** — scan assets at a site, track found / missing /
  unexpected, produce a summary.
- **CSV import / export** for bulk operations.
- **Phone enrolment** at `#/phone-enrol` (Settings → Enrol a phone) —
  iPhone and Android, no app install. IMEI is the canonical identifier
  (dial `*#06#` on the target phone to see it). Browser barcode scan
  when available; paste/type fallback everywhere. Auto-detects OS and
  make from the user agent where it can. **Batch mode** at
  `#/phone-enrol-batch` for registering a box of new devices in one
  go: set make / model / OS / carrier once, then one row per device.
- **PowerShell enrolment** for hardware specs. Two entry points:
  - **Password-gated web launcher** at `https://api.it-wsc.com/enrol` —
    visit the URL on the new PC, type the shared `ENROL_PASSWORD`, and
    the page shows a copy-to-clipboard PowerShell command pre-filled
    with the API key. Rate-limited against brute-force. Best for
    day-to-day use; no signing in to the main site on each machine.
  - **Direct one-liner** for GPO / automation:
    `[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $env:WSC_API_KEY='<key>'; irm https://api.it-wsc.com/enrol-script | iex`
    (the TLS preamble is only needed on Windows PowerShell 5.1 but is safe
    on PS 7+).
  Both paths call the same script. Idempotent by BIOS serial — re-running
  just refreshes the specs, so it's safe as a GPO logon script for
  fleet-wide auto-enrolment.
- **Microsoft Entra ID user sync** (domain-filtered) from the Settings
  page.
- **Email notifications** for asset and security events via Microsoft
  Graph.
- **Account page** — each signed-in user can view their identity, role,
  last sign-in, and sign out, reached from the sidebar user card.
- **Per-role UI** — four-tier role model (`viewer` / `user` / `manager` /
  `admin`). Sidebar items, route handlers, and API endpoints all gate on
  role. Non-admins see only the assets assigned to their own person
  record.
- **JIT user provisioning** — anyone with an `@walgett.nsw.gov.au` SSO
  identity who hits the site is auto-created as a `user`-role account on
  first sign-in. No manual add required for view-only access. Admin
  access is still granted explicitly. Override the allowed domain with
  the `AUTO_PROVISION_DOMAIN` env var if needed.
- **Self-service flags** — non-admin staff can flag a problem on their
  own gear (damaged / slow / lost / other) from the asset detail page.
  The flag lands in an admin-only Flags inbox and fires an email
  notification so IT sees it immediately.
- **Loaner pool** — mark an asset as "in loaner pool" and it switches to
  a short-term lending flow with a due date. Overdue loans show in red
  on the Loaners page and the sidebar count badge.
- **Consumables / Inventory** — quantity-tracked stock for commodity
  items (keyboards, mice, chargers, cables, toner, cases, etc.).
  Distinct from assets: no per-unit identity, just on-hand counts.
  Movements logged per change (added / issued / returned / adjusted /
  written off), optional staff and asset linkage. Low-stock badge in
  the sidebar + filter on the list. Toner-specific fields when the
  category is set to toner.
- **People asset-count filter** — sort the People list by who's
  holding the most gear, or filter to "people with at least N
  assets". Useful for chasing handovers when someone leaves.
- **Command palette** — `Ctrl/Cmd+K` opens a keyboard-driven palette
  with quick actions (new asset, jump to any view, sync Entra, sign out)
  and live asset search. Arrow keys + Enter to navigate.
- **In-app IT runbook** — admin-only sidebar entry under Tools that
  renders `docs/INTUNE-RUNBOOK.md` directly inside the app. Doc edits
  ship via normal commits, no duplicate copy.
- **Health endpoint + uncaught error alerts** — `GET /api/health`
  pinged every 5 min by GitHub Actions; if it fails, the workflow run
  goes red and admins get a notification email. Top-level dispatch
  wrapper emails admins on uncaught exceptions (deduped per isolate).
- **Scheduled jobs** — daily activity-log retention prune (18-month
  window) + weekly Monday-morning lifecycle digest (assets with
  warranty expiring or retirement_date approaching in the next 30
  days).
- **Break-glass login** — rate-limited master-key path with IP-scoped
  audit logging, for SSO outages.

## Development

```bash
npm install
npm run dev                    # frontend dev server (Vite)
cd worker && npm run dev       # local worker (requires Wrangler login)
```

Frontend build: `npm run build`.

Manual worker deploy (normally handled by CI on push to `main`):

```bash
cd worker && npx wrangler deploy
```

## Deployment

Push direct to `main` (no PR ritual; solo dev project). Every push
triggers `.github/workflows/deploy.yml`:

1. Builds the frontend and pushes it to Cloudflare Pages.
2. Applies any pending D1 migrations with
   `wrangler d1 migrations apply`.
3. Deploys the worker.
4. Runs `scripts/smoke-test.sh` against the live API. If any endpoint
   returns 5xx or the worker becomes unreachable, the build fails.

Other workflows:

- `health-check.yml` — pings `/api/health` every 5 min; failures
  surface as red runs in the Actions tab.
- `backup.yml` — weekly D1 export uploaded as a 90-day workflow
  artifact. Download and restore instructions live in
  [docs/OPERATIONS.md](docs/OPERATIONS.md).

Worker scheduled crons (defined in `worker/wrangler.toml [triggers]`):

- Daily 17:00 UTC — prune `activity_log` rows > 18 months old.
- Sunday 17:00 UTC — weekly lifecycle digest email to admins.

## Repository layout

```
index.html              Single-page app shell
src/                    Frontend source (vanilla JS + CSS)
worker/                 Cloudflare Worker API, schema, migrations
scripts/                Ops scripts: smoke-test, restore-db, audit-bugs
.github/workflows/      CI — deploy, health-check, backup
docs/                   Architecture, onboarding, operations, runbook,
                        playbook, governance
```

Full tree with per-file purpose: [docs/ARCHITECTURE.md § Where the code
lives](docs/ARCHITECTURE.md#where-the-code-lives).

## License

Internal use only. All rights reserved.

---

<sub>System owner (role): IT Officer, Walgett Shire Council.
Current maintainer: Matthew Hutchins-Copping.
Source and issues: [github.com/mhutchins-copping/wsc-assets](https://github.com/mhutchins-copping/wsc-assets).</sub>
