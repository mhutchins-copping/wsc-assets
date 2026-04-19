# Architecture

> **Document:** System Architecture
> **Version:** 1.2
> **Last updated:** 2026-04-19
> **Owner (role):** IT Officer, Walgett Shire Council
> **Review cycle:** Annual — next review due 2027-04-19

This document covers what WSC Assets is, how it's built, and the
reasoning behind the technical choices. Intended audience: someone who
knows IT but isn't necessarily a full-time web developer — the same
audience who might inherit this system.

## What it is

WSC Assets is an internal IT asset register for Walgett Shire Council.
It replaces a spreadsheet. Core functions:

- Track hardware (laptops, desktops, phones, peripherals) with tags,
  serials, hardware specs, and assignment status.
- Log who checked what in and out of the loan pool.
- Record maintenance history per device.
- Run floor-walk audits against the register.
- Pull the staff directory out of Microsoft Entra ID so the
  "Assigned To" field stays current.
- Produce reports for budget and planning.

It's a web app. Anyone with a council email who's been granted access
can open it in a browser. There's no client to install.

## High-level layout

```
                         ┌──────────────────────────────┐
                         │  Microsoft Entra ID (SSO)    │
                         │  @walgett.nsw.gov.au         │
                         └────────────┬─────────────────┘
                                      │
                                      ▼
┌────────────┐    HTTPS    ┌────────────────────────────┐
│  Browser   ├────────────▶│  Cloudflare Access (edge)  │
└────────────┘             │  - identity check          │
                           │  - allow-list policy       │
                           └──────────┬─────────────────┘
                                      │ adds Cf-Access-
                                      │ Authenticated-User-Email
                                      ▼
                    ┌─────────────────────────────────────┐
                    │  assets.it-wsc.com                  │
                    │  (Cloudflare Pages — static site)   │
                    │  Vanilla JS + Vite build            │
                    └──────────┬──────────────────────────┘
                               │ fetch
                               ▼
                    ┌─────────────────────────────────────┐
                    │  api.it-wsc.com                     │
                    │  (Cloudflare Worker — API)          │
                    │  - reads user from Access header    │
                    │  - looks up role in users table     │
                    │  - serves JSON                      │
                    └───┬──────────────┬──────────────┬───┘
                        │              │              │
                        ▼              ▼              ▼
                    ┌───────┐      ┌──────┐      ┌─────────┐
                    │  D1   │      │  R2  │      │  Graph  │
                    │ (SQL) │      │(blob)│      │   API   │
                    └───────┘      └──────┘      └─────────┘
                    database       photos        Entra users
```

Four components owned by the council, three external dependencies:

| Council-owned                           | External dependencies        |
| --------------------------------------- | ---------------------------- |
| Frontend (Pages)                        | Cloudflare Access (edge)     |
| API (Worker)                            | Microsoft Entra ID           |
| Database schema (D1)                    | Microsoft Graph API          |
| Image storage layout (R2)               |                              |

See `docs/GOVERNANCE.md` for the full dependency inventory with
criticality ratings.

## Why this stack

This section exists because it's the first thing anyone from a
traditional IT background will ask about. The reasoning is set out
here explicitly rather than left to be guessed at.

### Why Cloudflare (instead of Azure, AWS, or on-prem)

- **Cost.** The whole system fits inside Cloudflare's free tier at
  council usage levels (~150 devices, small team). A long way off any
  paid threshold.
- **No servers.** D1, Workers, Pages and R2 are all serverless. There
  is no VM to patch, no IIS pool to restart, no certificate to renew.
- **Auth at the edge.** Cloudflare Access provides Entra SSO in front
  of the whole application without any custom auth code. If a user
  isn't on the allow-list, they cannot reach the code that would
  reject them.
- **Deployment.** `git push` deploys. No maintenance windows, no
  staged rollouts, no manual server access.

### Why not Snipe-IT / Lansweeper / ServiceNow

These were evaluated. They are mature products. The trade-offs:

- **Snipe-IT** is open source and genuinely good, but it's a PHP app
  that needs a server, a database, and ongoing patching. Hosting it
  reliably is more effort than building a tool shaped for how this IT
  function operates.
- **Lansweeper** is excellent at network scanning but the licence cost
  is disproportionate to a 150-device council, and the UI isn't
  suitable for non-IT staff to use.
- **ServiceNow / Asset Panda** are enterprise products with enterprise
  pricing. Not serious options at this scale.

Building a small, focused tool on a serverless stack turned out to be
cheaper, lower-maintenance, and a better fit than any of those. The
trade-off accepted is that this stack is uncommon in a council
environment and warrants the extra documentation you're reading.

### Why vanilla JavaScript on the frontend

The app is a few thousand lines of plain JS. No React, no Vue, no
TypeScript compiler. Reasons:

- Scope doesn't justify a framework. There are a dozen or so views. A
  framework would add more code than the app itself.
- No dependency churn. Vanilla JS written today still runs in five
  years. A React app written today will need three major upgrades by
  then.
- Anyone who can read JavaScript can maintain this. That's not true of
  a Vite + React + TypeScript + Redux app.

Vite is used for the dev server and production bundling because it
makes hot-reload painless. It's a build tool, not a framework — the
output is still plain JS.

## How auth works

Two layers. Both matter.

### Layer 1 — Cloudflare Access (who are you?)

- Sits in front of both `assets.it-wsc.com` and `api.it-wsc.com`.
- Redirects to Microsoft Entra ID for SSO.
- Policy: allow only identities ending in `@walgett.nsw.gov.au`.
  Everyone else is blocked at the edge.
- On success, CF Access attaches a signed header
  (`Cf-Access-Authenticated-User-Email`) to every request it forwards.
  The header is cryptographically signed by Cloudflare and cannot be
  spoofed by a caller.

### Layer 2 — Internal user mapping (what can you do?)

- Passing the SSO check gets a user *to* the app. It does not get them
  *into* it.
- The worker reads the Access header, then looks up the email in the
  local `users` table.
- If the email is present and `active = 1`, the request proceeds with
  that user's role (`admin` / `user` / `viewer`).
- If the email is not present, the request is rejected with an
  explanatory "no access" page — even though SSO succeeded.

This is a deliberate default-deny model. Being a council staff member
is not enough to use the asset register; a staff member must be
explicitly added by an admin.

### Break-glass: master key

If Cloudflare Access has an outage, or the admin account is locked out
of SSO for any reason, a master-key login path exists. It's
rate-limited, logged (with source IP) to a security event channel, and
only usable by someone who knows the out-of-band secret. See
`docs/OPERATIONS.md` for handling.

## Data model (high-level)

| Table             | What it holds                                                  |
| ----------------- | -------------------------------------------------------------- |
| `assets`          | Every device. Tag, serial, status, hardware specs, assignment. |
| `people`          | Staff directory. Synced from Entra; manually edited when needed.|
| `categories`      | Asset categories and tag prefix (e.g. `L` → WSC-L-0042).       |
| `users`           | Who can sign in to the app and what role they have.            |
| `activity_log`    | Every mutation — creates, updates, check-outs, disposes.       |
| `maintenance_log` | Service/repair history per asset.                              |
| `audits`          | Floor-walk audit runs with found / missing / unexpected counts.|
| `audit_items`     | Per-asset state within each audit.                             |

All tables use opaque IDs (16 hex chars) as primary keys, not
incrementing integers. That means IDs don't leak how many rows exist,
and they can be embedded in URLs without risk of someone walking
through them.

## Request flow (example: loading the dashboard)

1. User opens `https://assets.it-wsc.com/`.
2. CF Access: no cookie → redirect to Microsoft SSO.
3. User signs in → CF Access issues a signed cookie, redirects back.
4. Browser loads the static site from Pages.
5. Frontend JS calls `GET https://api.it-wsc.com/api/stats`.
6. CF Access checks the cookie, forwards to worker with
   `Cf-Access-Authenticated-User-Email: <email>`.
7. Worker reads the header, queries
   `users WHERE email = ? AND active = 1`.
8. User exists → worker runs the aggregation query against D1, returns
   JSON.
9. Frontend renders the KPI cards and charts.

If at step 7 the user's email isn't in the `users` table, they get a
"no access — contact IT" screen from the worker.

## Where the code lives

```
wsc-assets/
├── index.html                 # Single-page shell
├── src/
│   ├── main.js                # Module entry — imports every js file
│   ├── css/app.css            # All styles (tokens, layout, components)
│   └── js/
│       ├── auth.js            # SSO identity load + denied / master-key flows
│       ├── db.js              # API client wrapper
│       ├── router.js          # Hash-based router
│       ├── components.js      # Shared UI helpers (renderTable etc.)
│       ├── utils.js           # esc, toast, modals, keyboard shortcuts
│       ├── qr.js              # QR code rendering for asset tags
│       ├── dashboard.js       # KPIs, status breakdown, recent activity
│       ├── assets.js          # List, detail, create / edit forms
│       ├── checkout.js        # Check-out / check-in modals + picker
│       ├── people.js
│       ├── categories.js
│       ├── audits.js
│       ├── reports.js
│       ├── settings.js
│       └── account.js         # 'Your account' page (signed-in user)
├── worker/
│   ├── worker.js              # The whole API, one file
│   ├── wrangler.toml          # Worker config (bindings, vars)
│   ├── schema.sql             # Fresh-install baseline
│   ├── seed.sql               # Default categories
│   └── migrations/            # Incremental schema changes
│       ├── 0001_add_hardware_specs.sql
│       ├── 0002_add_users.sql
│       └── ...
├── scripts/
│   ├── smoke-test.sh          # Post-deploy health check (run by CI)
│   ├── restore-db.sh          # Automated D1 restore with safety export
│   └── audit-bugs.cjs         # Ad-hoc scan for common bug classes
├── .github/workflows/
│   ├── deploy.yml             # On push to main: build, migrate, deploy, smoke
│   └── backup.yml             # Weekly D1 export to GHA artifact
└── docs/
    ├── ARCHITECTURE.md        # This document
    ├── OPERATIONS.md          # Runbook
    └── GOVERNANCE.md          # One-pager for exec review
```

The worker is one file on purpose. It's long (~1,800 lines) but
straightforward to read top-to-bottom, and there's no build step
hiding what actually ships to Cloudflare. A future maintainer opens
one file and sees the whole API.

## Trade-offs accepted

Every architecture has them. These are the known ones:

- **Single point of presence.** If Cloudflare is down, so is this.
  Mitigated by: their SLA being better than any other single provider
  the council would realistically pick, and D1 backups living
  off-Cloudflare (see `docs/OPERATIONS.md`).
- **Proprietary serverless primitives.** D1 and R2 aren't drop-in
  replaceable. Leaving Cloudflare would require a rewrite of the
  storage layer. Mitigated by: the schema being plain SQL and the
  stored images being plain files.
- **Monolithic worker file.** Works now, won't scale past
  3,000–4,000 lines without hurting readability. When that bites, it
  will be broken up into modules per resource.
- **Frontend is not typed.** No TypeScript. Class of bugs (e.g. typos
  in field names) that a typed codebase would catch, this one doesn't.
  Mitigated by: small surface area and the smoke test suite.
- **Single maintainer.** Documentation in `docs/` is the primary
  mitigation. A successor inherits the three documents plus the code.
