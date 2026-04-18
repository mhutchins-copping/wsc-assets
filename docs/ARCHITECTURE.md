# Architecture

This document covers what WSC Assets is, how it's built, and why I made the
choices I did. It's aimed at someone who knows IT but isn't necessarily a
full-time web developer — the same audience who might inherit this system
one day.

## What it is

WSC Assets is an internal IT asset register for Walgett Shire Council. It
replaces a spreadsheet. Core functions:

- Track hardware (laptops, desktops, phones, peripherals) with tags, serials,
  hardware specs, and assignment status.
- Log who checked what in and out of the loan pool.
- Record maintenance history per device.
- Run floor-walk audits against the register.
- Pull the staff directory out of Microsoft Entra ID so the "Assigned To"
  field stays current.
- Produce reports for budget and planning.

It's a web app. Anyone with a council email who's been granted access can
open it in a browser. There's no client to install.

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

Four components I own, three I depend on:

| Owned                                   | Depend on                   |
| --------------------------------------- | --------------------------- |
| Frontend (Pages)                        | Cloudflare Access (edge)    |
| API (Worker)                            | Microsoft Entra ID          |
| Database schema (D1)                    | Microsoft Graph API         |
| Image storage layout (R2)               |                             |

## Why this stack

This section exists because it's the first thing anyone from a traditional
IT background will ask about, and I'd rather set out the reasoning than
have it guessed at.

### Why Cloudflare (instead of Azure, AWS, or on-prem)

- **Cost.** The whole system fits inside Cloudflare's free tier at our usage
  level. Council runs on ~150 devices and a handful of daily users — a long
  way off any paid threshold.
- **No servers.** D1, Workers, Pages and R2 are all serverless. There is no
  VM to patch, no IIS pool to restart, no certificate to renew.
- **Auth at the edge.** Cloudflare Access means I get Entra SSO in front of
  the whole application without writing any auth code. If someone isn't on
  the allow-list, they can't even reach the code that would reject them.
- **Deployment.** `git push` deploys. That's the whole story. No maintenance
  windows, no staged rollouts, no "please SSH into prod".

### Why not Snipe-IT / Lansweeper / ServiceNow

I evaluated these. They're mature products. The trade-off is:

- **Snipe-IT** is open source and genuinely good, but it's a PHP app that
  needs a server, a database, and ongoing patching. Hosting it reliably is
  more work than building a tool shaped exactly for how we operate.
- **Lansweeper** is excellent at network scanning but the license cost is
  disproportionate to a 150-device council, and its UI isn't what I want to
  hand to non-IT staff.
- **ServiceNow / Asset Panda** are enterprise products with enterprise
  pricing. Not serious options at this scale.

Building a small, focused tool on a serverless stack turned out to be
cheaper, lower-maintenance, and a better fit than any of those. The
trade-off is that this stack is uncommon in a council environment and
warrants the extra documentation you're reading.

### Why vanilla JavaScript on the frontend

The app is a few thousand lines of plain JS. No React, no Vue, no TypeScript
compiler. Reasons:

- Scope doesn't justify a framework. There are a dozen or so views. A
  framework would add more code than the app itself.
- No dependency churn. Vanilla JS written today still runs in five years.
  A React app written today will need three major upgrades by then.
- Anyone who can read JavaScript can maintain this. That's not true of a
  Vite + React + TypeScript + Redux app.

Vite is used for the dev server and production bundling because it makes
hot-reload painless. It's a build tool, not a framework — the output is
still plain JS.

## How auth works

Two layers. This matters and is worth understanding.

### Layer 1 — Cloudflare Access (who are you?)

- Sits in front of both `assets.it-wsc.com` and `api.it-wsc.com`.
- Redirects to Microsoft Entra ID for SSO.
- Policy: allow only identities ending in `@walgett.nsw.gov.au`. Everyone
  else is blocked at the edge.
- On success, CF Access attaches a signed header
  (`Cf-Access-Authenticated-User-Email`) to every request it forwards.
  The header is cryptographically signed by Cloudflare and cannot be
  spoofed by a caller.

### Layer 2 — Internal user mapping (what can you do?)

- Passing the SSO check gets you *to* the app. It does not get you *into*
  it.
- The worker reads the Access header, then looks up the email in the
  local `users` table.
- If the email is present and `active = 1`, the request proceeds with that
  user's role (`admin` / `user` / `viewer`).
- If the email is not present, the request is rejected with an explanatory
  "no access" page — even though SSO succeeded.

This means: **being a council staff member is not enough. You have to have
been explicitly added to the app.** That's a deliberate choice. An SSO-only
model would let every staff member into the asset register on day one.

### Break-glass: master key

If Cloudflare Access has an outage, or the admin account is locked out of
SSO for any reason, a master-key login path exists. It's rate-limited,
logged (with source IP) to a separate `security_log` context, and only
usable by someone who knows the out-of-band secret. See
`docs/OPERATIONS.md` for handling.

## Data model (high-level)

| Table           | What it holds                                                   |
| --------------- | --------------------------------------------------------------- |
| `assets`        | Every device. Tag, serial, status, hardware specs, assignment.  |
| `people`        | Staff directory. Synced from Entra; manually edited when needed.|
| `categories`    | Asset categories and tag prefix (e.g. `L` → WSC-L-0042).        |
| `users`         | Who can sign in to the app and what role they have.             |
| `activity_log`  | Every mutation — creates, updates, check-outs, disposes.        |
| `maintenance_log` | Service/repair history per asset.                             |
| `audits`        | Floor-walk audit runs with found / missing / unexpected counts. |
| `audit_items`   | Per-asset state within each audit.                              |

All tables use opaque IDs (16 hex chars) as primary keys, not incrementing
integers. That means IDs don't leak how many rows we have, and they can be
embedded in URLs without risk of someone walking through them.

## Request flow (example: loading the dashboard)

1. User opens `https://assets.it-wsc.com/`.
2. CF Access: no cookie → redirect to Microsoft SSO.
3. User signs in → CF Access issues a signed cookie, redirects back.
4. Browser loads the static site from Pages.
5. Frontend JS calls `GET https://api.it-wsc.com/api/stats`.
6. CF Access checks the cookie, forwards to worker with
   `Cf-Access-Authenticated-User-Email: matt@...`.
7. Worker reads the header, queries `users WHERE email = ? AND active = 1`.
8. User exists → worker runs the aggregation query against D1, returns JSON.
9. Frontend renders the KPI cards and charts.

If at any point the user's email isn't in the `users` table (step 7), they
get a "no access — contact IT" screen from the worker.

## Where the code lives

```
wsc-assets/
├── index.html                 # Single-page shell
├── src/
│   ├── css/app.css            # All styles
│   └── js/
│       ├── auth.js            # Identity load + denied screen
│       ├── db.js              # API client wrapper
│       ├── router.js          # Hash-based router
│       ├── components.js      # Shared UI helpers
│       ├── dashboard.js
│       ├── assets.js          # List, detail, create/edit
│       ├── people.js
│       ├── categories.js
│       ├── audits.js
│       ├── reports.js
│       └── settings.js
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
│   └── smoke-test.sh          # Post-deploy health check
├── .github/workflows/
│   ├── deploy.yml             # On push to main: build, migrate, deploy
│   └── backup.yml             # Weekly D1 export
└── docs/
    ├── ARCHITECTURE.md        # You are here
    ├── OPERATIONS.md          # Runbook
    └── GOVERNANCE.md          # One-pager for exec review
```

The worker is one file on purpose. It's long (~1,800 lines) but it's
straightforward to read top-to-bottom, and there's no build step hiding
what actually ships to Cloudflare. A future maintainer opens one file and
sees the whole API.

## Trade-offs I know about

Every architecture has them. These are the ones I've accepted:

- **Single point of presence.** If Cloudflare is down, so is this.
  Mitigated by: their SLA being better than any other single provider
  we'd realistically pick, and D1 backups living off-Cloudflare (see
  `docs/OPERATIONS.md`).
- **Proprietary serverless primitives.** D1 and R2 aren't drop-in
  replaceable. If we ever leave Cloudflare, some rewrite is required.
  Mitigated by: the schema being plain SQL and the storage layer being
  plain files.
- **Monolithic worker file.** Works now, won't scale past maybe 3,000–4,000
  lines without hurting readability. When that bites, it'll be broken up
  into modules per resource (assets, people, etc.).
- **Frontend is not typed.** No TypeScript. Class of bugs (e.g. typos in
  field names) that a typed codebase would catch, this one doesn't.
  Mitigated by: small surface area and the smoke test suite.
- **Bus factor is 1.** Only I know this system end-to-end. This document
  is part of the mitigation.
