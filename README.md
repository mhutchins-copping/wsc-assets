<p align="center">
  <strong>WSC Assets</strong><br>
  <em>IT Asset Management System for Walgett Shire Council</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/Database-D1-F38020?logo=cloudflare&logoColor=white" alt="D1">
  <img src="https://img.shields.io/badge/Auth-Entra_ID-0078D4?logo=microsoftazure&logoColor=white" alt="Entra ID">
  <img src="https://img.shields.io/badge/Frontend-Vanilla_JS-F7DF1E?logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/AI-Anthropic-FF6B6B?logo=anthropic&logoColor=white" alt="Anthropic">
</p>

---

A lightweight, self-hosted IT asset management system built entirely on Cloudflare's stack. Designed for small IT teams that need to track hardware across multiple sites without the overhead of enterprise ITAM platforms.

## Features

### Core Asset Management
- **Asset Lifecycle** — Register, assign, maintain, audit, and retire assets with auto-generated tags (`WSC-L-0001`)
- **QR Codes** — Auto-generated for every asset, printable labels
- **CSV Import/Export** — Bulk operations for migrations and reporting
- **Audit System** — Physical inventory audits with scan tracking
- **Activity Log** — Full history of every change, checkout, and check-in

### Smart Enrollment
- **Hardware Auto-Enrollment** — PowerShell script collects device specs and registers them via clipboard paste (no network from the endpoint required)
- **AI Label Scanning** — Take a photo of a device's label sticker and AI extracts serial number, manufacturer, model, and other fields to pre-fill the form
- **Entra ID Sync** — One-click user import from Microsoft Entra ID, filtered by email domain

### Security & Access
- **Dual-Layer Auth** — Cloudflare Access SSO + internal user/role mapping. Only explicitly authorised users get in
- **Break-Glass Access** — Rate-limited master key fallback for when SSO is unavailable
- **Email Notifications** — Automated alerts for key events (asset created, checked out, disposed, etc.) sent via Microsoft Graph

## Architecture

```
Browser (Mobile or Desktop)
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
  ├──▶ R2 (Storage) ──── Asset images
  └──▶ Microsoft Graph ──── Email notifications
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS, CSS, Vite |
| API | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Object Storage | Cloudflare R2 |
| Authentication | Cloudflare Access + Microsoft Entra ID |
| Notifications | Microsoft Graph (Mail.Send) |
| AI | Anthropic Claude (Haiku) |
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
# Core secrets
npx wrangler secret put API_KEY              # External script access
npx wrangler secret put MASTER_KEY          # Break-glass admin login

# Entra ID (for user sync and email notifications)
npx wrangler secret put ENTRA_TENANT_ID     # Azure AD Tenant ID
npx wrangler secret put ENTRA_CLIENT_ID     # App Registration Client ID
npx wrangler secret put ENTRA_CLIENT_SECRET # App Registration Client Secret

# Email notifications
npx wrangler secret put NOTIFICATION_SENDER  # Email address to send from (e.g. it@walgett.nsw.gov.au)

# AI label scanning (optional)
npx wrangler secret put ANTHROPIC_API_KEY   # Anthropic API key
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

## AI Label Scanning

Take a photo of a device's label/sticker and AI automatically extracts:

- Serial number
- Manufacturer
- Model
- MAC address (if visible)
- Category hint

Human always confirms before saving — we never auto-create.

### Setup

1. Get an Anthropic API key from [console.anthropic.com](https://console.anthropic.com)
2. Set the secret: `npx wrangler secret put ANTHROPIC_API_KEY --name wsc-assets-api`

### Rate Limits

- 30 extractions per user per hour
- Images up to 5MB (resized client-side to 1600px)

## Email Notifications

Automated email alerts for key events sent via Microsoft Graph to active admins.

### Events Notified

| Event | Trigger |
|-------|---------|
| Asset Created | New asset registered |
| Asset Checked Out | Asset assigned to person |
| Asset Checked In | Asset returned |
| Asset Disposed | Asset soft-deleted |
| Asset Purged | Asset permanently deleted |
| Master Key Login | Break-glass access used |
| User Created | New user added to system |

### Configuration

1. Grant **Mail.Send** permission in Entra (Application permission, admin consent required)
2. Set `NOTIFICATION_SENDER` to a valid Exchange mailbox
3. Set `NOTIFICATIONS_ENABLED` to control behavior:
   - `"true"` — Send emails
   - `"false"` — Disable notifications
   - `"log"` — Log what would be sent without emailing (dev mode)

### Per-User Opt-Out

Admins can disable notifications for themselves via D1:

```sql
UPDATE users SET notifications_enabled = 0 WHERE email = 'user@example.com';
```

## API

All endpoints require authentication via `Cf-Access-Authenticated-User-Email`, `X-Api-Key`, or master key.

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stats` | Dashboard statistics |
| `GET` `POST` | `/api/assets` | List / create assets |
| `GET` `PUT` `DELETE` | `/api/assets/:id` | Get / update / delete asset |
| `POST` | `/api/assets/:id/checkout` | Check out to a person |
| `POST` | `/api/assets/:id/checkin` | Check in |
| `POST` | `/api/assets/:id/maintenance` | Log maintenance |
| `POST` | `/api/assets/extract-from-image` | AI label scanning |
| `GET` `POST` | `/api/people` | List / create people |
| `POST` | `/api/people/sync-entra` | Sync users from Entra ID |
| `GET` `POST` | `/api/categories` | List / create categories |
| `GET` `POST` | `/api/audits` | List / start audits |
| `GET` | `/api/export/csv` | Export assets as CSV |
| `POST` | `/api/import/csv` | Import from CSV |
| `GET` | `/api/activity` | Activity log |
| `POST` | `/api/auth/identify` | SSO identity lookup |
| `POST` | `/api/auth/master-key` | Break-glass login |

## Security

### Authentication Layers

1. **Cloudflare Access (outer gate)** — Enforces Microsoft Entra ID SSO. Only authenticated users from the configured domain can reach the app.
2. **Internal user mapping (inner gate)** — The signed-in user's email is checked against an internal `users` table. No match = no access, even with valid SSO.

### Roles

| Role | Access |
|------|--------|
| `admin` | Full access including user management, system settings, notifications |
| `user` | Asset management, check-out/in, audits, AI scanning |

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

## About

**WSC Assets** is the IT asset management system for [Walgett Shire Council](https://www.walgett.nsw.gov.au).

Built with:
- Vanilla JS + Vite for the frontend
- Cloudflare Workers, D1, R2, and Pages for the backend
- Microsoft Entra ID for SSO
- Anthropic Claude for AI label scanning

---

**Version:** 1.0.0  
**License:** Internal use only.
