# WSC Assets

IT Asset Management System for Walgett Shire Council. Built on Cloudflare Workers, D1, R2, and Pages.

## Features

- **Asset Tracking** — Register, assign, maintain, audit, and retire IT assets with auto-generated tags (e.g. `WSC-L-0001`)
- **Hardware Auto-Enrollment** — PowerShell script collects device specs (serial, CPU, RAM, disk, OS, MAC, IP) and registers them via clipboard paste
- **People Directory** — Syncs users from Microsoft Entra ID (Azure AD) with one click
- **SSO Authentication** — Cloudflare Access + Microsoft Entra ID, with internal user/role mapping for authorisation
- **Master Key Fallback** — Access the system without SSO when working remotely
- **QR Codes** — Generated for every asset tag, printable labels
- **CSV Import/Export** — Bulk import assets or export for reporting
- **Audit System** — Location-based physical audits with scan tracking
- **Activity Log** — Full history of asset changes, checkouts, and maintenance

## Architecture

```
Frontend (Cloudflare Pages)
    |
    v
Cloudflare Access (SSO via Entra ID)
    |
    v
Worker API (Cloudflare Workers)
    |
    +---> D1 Database (SQLite)
    +---> R2 Storage (asset images)
```

## Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Vanilla JS, CSS, Vite |
| API | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Storage | Cloudflare R2 |
| Auth | Cloudflare Access + Microsoft Entra ID |
| Hosting | Cloudflare Pages |
| CI/CD | GitHub Actions (auto-deploys on push to master) |

## Setup

### Prerequisites

- Cloudflare account with Workers, D1, R2, and Pages enabled
- Microsoft Entra ID (Azure AD) tenant for SSO
- Node.js 18+

### 1. Database

Create a D1 database named `wsc-assets-db` and run the schema:

```bash
cd worker
npx wrangler d1 execute wsc-assets-db --file=schema.sql
npx wrangler d1 execute wsc-assets-db --file=seed.sql
```

### 2. Secrets

Set the following secrets on the worker:

```bash
npx wrangler secret put API_KEY        # For script/external API access
npx wrangler secret put MASTER_KEY     # For non-SSO admin login
```

### 3. Deploy

Push to `main` — GitHub Actions handles the rest (deploys both Pages frontend and Worker API).

Or manually:

```bash
# Frontend
npm install && npm run build
npx wrangler pages deploy dist

# Worker
cd worker && npx wrangler deploy
```

### 4. Custom Domains

- `assets.it-wsc.com` — Frontend (Cloudflare Pages)
- `api.it-wsc.com` — Worker API (Cloudflare Workers custom domain)

### 5. SSO (Cloudflare Access + Entra ID)

1. Register an app in Entra ID with redirect URI: `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`
2. Add Microsoft Entra ID as an identity provider in Cloudflare Zero Trust
3. Create an Access Application for the frontend domain
4. Add a policy to allow `@walgett.nsw.gov.au` emails

### 6. Internal Users

Only SSO-authenticated users with a matching record in the `users` table can access the app. Manage users in Settings > User Management.

## Device Enrollment

1. In WSC Assets Settings, click **Copy Collection Script**
2. On the target Windows PC, open PowerShell and paste the script
3. It collects hardware info and copies JSON to clipboard
4. Back in WSC Assets, paste into the enrollment field and click **Enroll Device**

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats` | Dashboard statistics |
| GET/POST | `/api/assets` | List/create assets |
| GET/PUT/DELETE | `/api/assets/:id` | Get/update/delete asset |
| POST | `/api/assets/:id/checkout` | Check out to person |
| POST | `/api/assets/:id/checkin` | Check in |
| POST | `/api/assets/:id/maintenance` | Log maintenance |
| GET/POST | `/api/people` | List/create people |
| POST | `/api/people/sync-entra` | Sync from Entra ID |
| GET/POST | `/api/categories` | List/create categories |
| GET/POST | `/api/audits` | List/start audits |
| GET | `/api/export/csv` | Export assets as CSV |
| POST | `/api/import/csv` | Import assets from CSV |
| POST | `/api/auth/identify` | SSO identity lookup |
| POST | `/api/auth/master-key` | Master key login |

All `/api/*` endpoints require authentication via `X-Api-Key` header or Cloudflare Access SSO identity.

## Security Model

### Authentication Layers

This application uses **two independent authentication layers**:

1. **Cloudflare Access (outer gate)** — All traffic to the frontend must pass through Cloudflare Access, which enforces Microsoft Entra ID SSO. Only authenticated users from the configured email domain can reach the application at all.

2. **Internal user mapping (inner gate)** — After SSO authentication, the app checks the signed-in user's email against an internal `users` table. If no matching active record exists, access is denied. This means SSO alone is not sufficient — an admin must explicitly grant access to each user.

### Role-Based Access

| Role | Permissions |
|------|-------------|
| `admin` | Full access: manage assets, people, categories, audits, user accounts, and system settings |
| `user` | Standard access: manage assets, people, checkout/checkin, run audits |
| `viewer` | Read-only: view assets, people, and reports (future) |

### API Authentication

API requests are authenticated via one of (checked in order):

1. `Cf-Access-Authenticated-User-Email` header — set automatically by Cloudflare Access (cannot be spoofed). The email is looked up in the internal users table.
2. `X-Api-Key` header — for external scripts (e.g. device enrollment). Validated against the `API_KEY` Wrangler secret.
3. `MASTER_KEY` — break-glass admin access (see below).

### Master Key (Break-Glass Access)

The `/api/auth/master-key` endpoint provides emergency admin access when SSO is unavailable (e.g. working from home without VPN, Entra outage). This is the highest-risk auth path and has the following protections:

- **Rate limited** — 5 failed attempts per IP triggers a 15-minute lockout
- **Audit logged** — Every attempt (successful or failed) is logged to the activity log with the source IP address
- **Stored as Wrangler secret** — The key value is encrypted at rest and never exposed in the dashboard or codebase
- **Admin-only** — A successful master key login resolves to the first active admin user, not a separate superuser account

### Secrets

| Secret | Purpose |
|--------|---------|
| `API_KEY` | Authenticates external script access (device enrollment, automation) |
| `MASTER_KEY` | Break-glass admin login when SSO is unavailable |

Both are set via `wrangler secret put` and stored encrypted in Cloudflare. They are never committed to the repository.

## License

Internal use — Walgett Shire Council.
