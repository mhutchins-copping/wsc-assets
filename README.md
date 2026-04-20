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
- **AI-assisted label scanning** (optional) — photograph a device label
  and the app prefills the form.
- **PowerShell enrolment script** for hardware specs. Served at
  `GET https://api.it-wsc.com/enrol-script`, so each PC can be enrolled
  without signing in to the site first — run
  `$env:WSC_API_KEY='<key>'; irm https://api.it-wsc.com/enrol-script | iex`
  in PowerShell. Idempotent by BIOS serial; re-running just refreshes
  the specs. Suitable for a GPO logon script if you want fleet-wide
  auto-enrolment.
- **Microsoft Entra ID user sync** (domain-filtered) from the Settings
  page.
- **Email notifications** for asset and security events via Microsoft
  Graph.
- **Account page** — each signed-in user can view their identity, role,
  last sign-in, and sign out, reached from the sidebar user card.
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
