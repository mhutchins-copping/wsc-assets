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
  Deployment, backups, user management, incident response, migrations.
- **[docs/GOVERNANCE.md](docs/GOVERNANCE.md)** — one-page executive
  summary. Data location, ownership, BCP, cost, and risk.

Those three cover the full picture. The rest of this README is a
quick-reference.

## What's inside

- **Frontend** — static site, vanilla JS + Vite, hosted on Cloudflare Pages.
- **API** — single Cloudflare Worker, `worker/worker.js`.
- **Database** — Cloudflare D1 (SQLite). Schema in `worker/schema.sql`,
  incremental changes in `worker/migrations/`.
- **Storage** — Cloudflare R2 for asset photos.
- **Auth** — Cloudflare Access in front for Microsoft Entra SSO, plus a
  local `users` table for in-app authorisation. See ARCHITECTURE.md for
  the full flow.

## Features

- Asset lifecycle: register, assign, service, audit, dispose.
- Auto-generated asset tags (`WSC-L-0042` style) with QR codes.
- Activity log on every change, with acting user and timestamp.
- CSV import / export.
- AI-assisted label scanning (optional) — photograph a device label and
  let it prefill the form.
- PowerShell enrolment script for hardware specs, designed to work in
  environments where endpoints can't reach the public internet directly.
- Floor-walk audit workflow with found / missing / unexpected tracking.
- Dashboard and reports across status, category, people, and OS.
- Microsoft Entra ID user sync (domain-filtered).
- Email notifications for asset and security events via Microsoft Graph.

## Development

```bash
npm install
npm run dev           # frontend dev server
cd worker && npm run dev    # local worker (requires Wrangler login)
```

Frontend build: `npm run build`.

Worker deploy (usually automatic via GitHub Actions on push to `main`):

```bash
cd worker && npx wrangler deploy
```

## Deployment

Every push to `main` triggers `.github/workflows/deploy.yml`:

1. Frontend built and pushed to Cloudflare Pages.
2. New D1 migrations applied via Wrangler.
3. Worker deployed.
4. Smoke test run against the live API.

Weekly database backups run from `.github/workflows/backup.yml` — see
OPERATIONS.md for download and restore procedures.

## License

Internal use only. All rights reserved.

---

<sub>System owner (role): IT Officer, Walgett Shire Council.
Current maintainer: Matthew Hutchins-Copping.
Source and issues: [github.com/mhutchins-copping/wsc-assets](https://github.com/mhutchins-copping/wsc-assets).</sub>
