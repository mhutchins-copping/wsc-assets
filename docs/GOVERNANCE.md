# Governance — one-page summary

> **Document:** Governance Summary
> **Version:** 1.1
> **Last updated:** 2026-04-18
> **Owner (role):** IT Officer, Walgett Shire Council
> **Review cycle:** Annual — next review due 2027-04-18

A short, non-technical overview of WSC Assets for Executive Leadership,
RMT, and anyone else who needs to understand what this system is, who
owns it, and what happens if it breaks.

## What it is

**WSC Assets** is Walgett Shire Council's internal IT asset register.
It tracks council hardware (laptops, desktops, phones, peripherals),
assignment status, maintenance history, and periodic asset audits. It
replaces an informal spreadsheet that previously filled this role.

- **Live at:** <https://assets.it-wsc.com>
- **Users:** Council IT staff. Access is granted per person by the
  current system owner.
- **Data classification:** Internal use only. Contains device identifiers
  and staff assignment records. No PII beyond staff name, email, and
  department — all already held in the council's existing Entra ID tenant.

## Ownership

| Role                     | Current holder                                  |
| ------------------------ | ----------------------------------------------- |
| System owner (role)      | IT Officer                                      |
| System owner (current)   | Matthew Hutchins-Copping                        |
| Technical maintainer     | As above (single maintainer)                    |
| Successor                | Appointed by Council on handover                |
| Vendor / external support| Self-hosted; Cloudflare provides infrastructure |

This is a council-owned system, not a third-party SaaS product. The
source code is in a GitHub repository administered by the system owner.
Council holds full control of the data, deployments, and access policies.

## Where the data lives

- **Application:** Cloudflare (global edge network, serverless).
- **Database:** Cloudflare D1 (SQLite-compatible managed database).
- **Photos:** Cloudflare R2 (object storage).
- **Authentication:** Microsoft Entra ID (existing council tenant) via
  Cloudflare Access.

Cloudflare data residency: the active region is set to APAC and data is
stored in Asia-Pacific data centres. Verifiable in the Cloudflare
dashboard.

## Dependency inventory

External services the system relies on, with the blast radius of each
being unavailable:

| Service              | Purpose                                    | Criticality |
| -------------------- | ------------------------------------------ | ----------- |
| Cloudflare Access    | SSO enforcement at the edge                | High        |
| Cloudflare Workers   | API runtime                                | High        |
| Cloudflare D1        | Primary database                           | High        |
| Cloudflare Pages     | Static frontend hosting                    | High        |
| Cloudflare R2        | Asset photo storage                        | Medium      |
| Microsoft Entra ID   | Identity provider (SSO + directory sync)   | High        |
| Microsoft Graph API  | Staff directory sync, email notifications  | Medium      |
| GitHub               | Source code, CI/CD, backup artifact host   | High        |

"High" = system is unusable if this is unavailable. "Medium" = system
functional but a feature is degraded. "Low" = optional feature only.

## How access is controlled

Two layers of authentication:

1. **Cloudflare Access** enforces Microsoft Entra ID single sign-on. Only
   identities ending in `@walgett.nsw.gov.au` can reach the application
   at all.
2. **Internal user allow-list** — passing SSO is not sufficient. Each
   user must be explicitly added by an admin within the app. Default-deny.

Audit: every login and every change to an asset is logged to an activity
table with the acting user, timestamp, and (for sensitive operations)
source IP address.

## Backup and recovery

- **Backup schedule:** Weekly, automated, full database export.
- **Backup location:** GitHub (separate provider from Cloudflare —
  deliberate separation so a single-vendor incident cannot remove both
  the system and the backups).
- **Retention:** 90 days rolling.
- **RPO (Recovery Point Objective):** Up to 7 days of data loss in the
  worst case, assuming weekly backups and no manual trigger in between.
- **RTO (Recovery Time Objective):** Approximately 1 hour for a full
  database restore from backup, via an automated restore script.

The restore process is scripted (`scripts/restore-db.sh`) so it does not
depend on a human operator remembering the correct sequence of SQL
commands at 2am. Full runbook in `docs/OPERATIONS.md`.

## Continuity and failure modes

| Failure                          | Effect                                  | Recovery                          |
| -------------------------------- | --------------------------------------- | --------------------------------- |
| Cloudflare outage                | App offline until Cloudflare recovers   | Wait; no data loss.               |
| Microsoft Entra ID outage        | SSO unavailable                         | Break-glass master-key login.     |
| Database corruption              | App may return errors                   | Run scripted restore from backup. |
| System owner unavailable         | New changes blocked; app keeps running  | Documentation hands over ownership.|
| Cloudflare account compromised   | Access and data at risk                 | Off-provider backups on GitHub.   |

The system is not classed as business-critical. A 24-hour outage would be
inconvenient but would not prevent council operations.

## Cost

The full stack currently operates within Cloudflare's free tier. Total
ongoing cost is zero at current usage (~150 devices, small team).

If usage were to grow to where paid tiers apply, the ceilings are:

- **Workers:** 10M requests/day on the free tier. Current usage is
  several orders of magnitude below this.
- **D1:** 5GB storage and generous daily query limits on the free tier.
  Current database is < 10MB.
- **Pages:** Unlimited static hosting.
- **R2:** 10GB storage free. Asset photos are well under this.

A realistic paid-tier scenario would cost less than AUD $30/month.

## Known limitations (disclosed honestly)

- **Single-maintainer risk.** One technical maintainer currently.
  Documentation mitigates this but does not eliminate it. On handover,
  a successor inherits both the code and the three documents in `docs/`.
- **No independent penetration test.** The application has been built
  against current OWASP Top 10 guidance and reviewed for the common
  issues (auth bypass, injection, CORS, access control), but no
  third-party audit has been conducted.
- **Not load-tested at scale.** Designed for a ~150-device council. It
  would likely handle 10× that comfortably, but has not been proven.

## Appendix A — Security controls summary

| Control                          | Implementation                                     |
| -------------------------------- | -------------------------------------------------- |
| Multi-factor authentication      | Enforced via Entra ID policy on council accounts.  |
| Single sign-on                   | Enforced at edge via Cloudflare Access.            |
| Role-based access control        | `admin` / `user` / `viewer` roles, server-enforced.|
| Default-deny authorisation       | Internal `users` allow-list; SSO alone insufficient.|
| Transport encryption             | HTTPS only; HSTS enforced at edge.                 |
| Secret management                | Wrangler secret store; never in Git.               |
| Audit logging                    | Every mutation logged with user, timestamp, IP.    |
| Security event logging           | Separate channel for auth events (master-key etc).|
| Rate limiting                    | Applied to break-glass master-key endpoint.        |
| Least privilege                  | API endpoints check role; destructive ops admin-only.|
| Dependency hygiene               | Vanilla JS frontend; minimal server dependencies.  |
| Backup integrity                 | Off-provider backups; retention 90 days.           |

## Appendix B — Questions this document is intended to answer

**"Where's the data physically stored?"**
Cloudflare APAC region. Backups on GitHub.

**"What's the licensing cost?"**
Zero at current scale.

**"What if the current maintainer leaves?"**
The code, infrastructure, and three documents in `docs/` stay. Any
competent sysadmin with basic web development familiarity can take it
over; the stack is mainstream and well-documented.

**"Why not buy a commercial product?"**
Evaluated — see `docs/ARCHITECTURE.md`. Commercial options either cost
disproportionately at council scale, or don't fit how IT operates here.

**"What if Cloudflare disappears overnight?"**
Off-provider backups on GitHub mean the data is recoverable. Rebuilding
the application on a different stack would require development effort
but is not impossible; all code is open and in the repo.

**"Who's authorised to sign this off?"**
General Manager or delegated authority. Annual review cycle — next review
date at the top of this document.
