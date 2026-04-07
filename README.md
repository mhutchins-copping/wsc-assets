<p align="center">
  <strong>WSC Assets</strong><br>
  <em>IT Asset Management System</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/Database-D1-F38020?logo=cloudflare&logoColor=white" alt="D1">
  <img src="https://img.shields.io/badge/Auth-Entra_ID-0078D4?logo=microsoftazure&logoColor=white" alt="Entra ID">
  <img src="https://img.shields.io/badge/Frontend-Vanilla_JS-F7DF1E?logo=javascript&logoColor=black" alt="JavaScript">
</p>

---

A lightweight, self-hosted IT asset management system built entirely on Cloudflare's stack. Designed for small IT teams that need to track hardware across multiple sites without the overhead of enterprise ITAM platforms.

## Features

- **Asset Lifecycle** — Register, assign, maintain, audit, and retire assets with auto-generated tags (`WSC-L-0001`)
- **Hardware Auto-Enrollment** — PowerShell script collects device specs and registers them via clipboard paste (no network from the endpoint required)
- **Entra ID Sync** — One-click user import from Microsoft Entra ID, filtered by email domain
- **Dual-Layer Auth** — Cloudflare Access SSO + internal user/role mapping. Only explicitly authorised users get in
- **Break-Glass Access** — Rate-limited master key fallback for when SSO is unavailable
- **QR Codes** — Auto-generated for every asset, printable labels
- **CSV Import/Export** — Bulk operations for migrations and reporting
- **Audit System** — Physical inventory audits with scan tracking
- **Activity Log** — Full history of every change, checkout, and check-in

## Architecture

```
Browser
  │
  ▼
Cloudflare Access ──── Microsoft Entra ID (SSO)
  │
  ▼
Cloudflare Pages ──── Static frontend (Vite + vanilla JS)
  │
  ▼
Cloudflare Worker ──── REST API
  │
  ├──▶ D1 (SQLite) ──── Assets, people, activity, audits
  └──▶ R2 (Storage) ──── Asset images
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS, CSS, Vite |
| API | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Object Storage | Cloudflare R2 |
| Authentication | Cloudflare Access + Microsoft Entra ID |
| Hosting | Cloudflare Pages |
| CI/CD | GitHub Actions |

## Getting Started

### Prerequisites

- Cloudflare account (Workers, D1, R2, Pages)
- Microsoft Entra ID tenant (for SSO)
- Node.js 18+

### 1. Clone & Install

```bash
git clone https://github.com/mhutchins-copping/wsc-assets.git
cd wsc-assets
npm install
```

### 2. Database Setup

```bash
cd worker
npx wrangler d1 execute wsc-assets-db --file=schema.sql
npx wrangler d1 execute wsc-assets-db --file=seed.sql
```

### 3. Configure Secrets

```bash
npx wrangler secret put API_KEY        # External script access
npx wrangler secret put MASTER_KEY     # Break-glass admin login
```

### 4. Deploy

Push to `main` and GitHub Actions deploys everything automatically.

Or deploy manually:

```bash
npm run build && npx wrangler pages deploy dist    # Frontend
cd worker && npx wrangler deploy                    # API
```

### 5. SSO Setup

1. Register an app in Microsoft Entra ID
2. Add Entra ID as an identity provider in Cloudflare Zero Trust
3. Create a Cloudflare Access application for your frontend domain
4. Set an access policy for your email domain

### 6. User Access

SSO authentication alone doesn't grant access. An admin must add each user to the internal `users` table via Settings > User Management. This gives you explicit control over who can use the system and what role they have.

## Device Enrollment

For environments where endpoint scripts can't make outbound API calls (e.g. ThreatLocker, restricted firewalls):

1. Copy the collection script from Settings
2. Paste into PowerShell on the target device — it collects hardware info and copies JSON to clipboard
3. Paste the JSON back into the web UI to register the device

No outbound network access required from the endpoint.

## API

All endpoints require authentication via `Cf-Access-Authenticated-User-Email`, `X-Api-Key`, or master key.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stats` | Dashboard statistics |
| `GET` `POST` | `/api/assets` | List / create assets |
| `GET` `PUT` `DELETE` | `/api/assets/:id` | Get / update / delete asset |
| `POST` | `/api/assets/:id/checkout` | Check out to a person |
| `POST` | `/api/assets/:id/checkin` | Check in |
| `POST` | `/api/assets/:id/maintenance` | Log maintenance |
| `GET` `POST` | `/api/people` | List / create people |
| `POST` | `/api/people/sync-entra` | Sync users from Entra ID |
| `GET` `POST` | `/api/categories` | List / create categories |
| `GET` `POST` | `/api/audits` | List / start audits |
| `GET` | `/api/export/csv` | Export assets as CSV |
| `POST` | `/api/import/csv` | Import from CSV |
| `POST` | `/api/auth/identify` | SSO identity lookup |
| `POST` | `/api/auth/master-key` | Break-glass login |

## Security

### Authentication Layers

1. **Cloudflare Access (outer gate)** — Enforces Microsoft Entra ID SSO. Only authenticated users from the configured domain can reach the app.
2. **Internal user mapping (inner gate)** — The signed-in user's email is checked against an internal `users` table. No match = no access, even with valid SSO.

### Roles

| Role | Access |
|------|--------|
| `admin` | Full access including user management and system settings |
| `user` | Asset management, check-out/in, audits |
| `viewer` | Read-only (future) |

### API Auth Order

Requests are authenticated in this order:

1. `Cf-Access-Authenticated-User-Email` — set by Cloudflare Access, cannot be spoofed
2. `X-Api-Key` — for scripts and automation
3. `MASTER_KEY` — break-glass admin access

### Break-Glass (Master Key)

Emergency admin access when SSO is down. Protected by:

- Rate limiting (5 failed attempts per IP = 15-minute lockout)
- Full audit logging with source IP on every attempt
- Encrypted secret storage (Wrangler secrets, never in code)
- Resolves to the first active admin user account

## License

Internal use only.
