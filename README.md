# WSC Assets

Internal IT asset register for Walgett Shire Council. Tracks council
hardware — laptops, desktops, phones, peripherals — with assignment,
maintenance, audit, and reporting features.

Live at **[assets.it-wsc.com](https://assets.it-wsc.com)** (access
restricted to council staff).

---

## Documentation

If you're trying to understand what this is or how it's built, start here:

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — what the system is,
  how it's put together, and why these choices were made.
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — day-to-day runbook.
  Deployment, backups, restore, user management, incident response,
  migrations, secret rotation.
- **[docs/GOVERNANCE.md](docs/GOVERNANCE.md)** — one-page executive
  summary. Data location, ownership, BCP, cost, risk, and security
  controls.

Those three cover the full picture. The rest of this README is a
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
- **Per-role UI** — admins see the full app (dashboard, audits, receipts,
  people, categories, reports, settings); non-admins see only the assets
  assigned to their own person record, with the sidebar and API both
  scoped to match.
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

Every push to `main` triggers `.github/workflows/deploy.yml`, which:

1. Builds the frontend and pushes it to Cloudflare Pages.
2. Applies any pending D1 migrations with
   `wrangler d1 migrations apply`.
3. Deploys the worker.
4. Runs `scripts/smoke-test.sh` against the live API. If any endpoint
   returns 5xx or the worker becomes unreachable, the build fails.

Weekly database backups run from `.github/workflows/backup.yml` — full
D1 export uploaded as a 90-day workflow artifact. Download and restore
instructions live in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Repository layout

```
index.html              Single-page app shell
src/                    Frontend source (vanilla JS + CSS)
worker/                 Cloudflare Worker API, schema, migrations
scripts/                Ops scripts: smoke-test, restore-db, audit-bugs
.github/workflows/      CI — deploy, backup
docs/                   Architecture, operations, governance
```

Full tree with per-file purpose: [docs/ARCHITECTURE.md § Where the code
lives](docs/ARCHITECTURE.md#where-the-code-lives).

## License

Internal use only. All rights reserved.

---

<sub>System owner (role): IT Officer, Walgett Shire Council.
Current maintainer: Matthew Hutchins-Copping.
Source and issues: [github.com/mhutchins-copping/wsc-assets](https://github.com/mhutchins-copping/wsc-assets).</sub>
