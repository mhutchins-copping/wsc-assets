# Governance — one-page summary

A short, non-technical overview for Executive Leadership, RMT, and anyone
else who needs to understand what this system is, who owns it, and what
happens if it breaks.

## What it is

**WSC Assets** is Walgett Shire Council's internal IT asset register.
It tracks council hardware (laptops, desktops, phones, peripherals), who
has what, maintenance history, and asset audits. It replaces an informal
spreadsheet that previously filled this role.

- **Live at:** <https://assets.it-wsc.com>
- **Users:** Council IT, currently one permanent admin. Access can be
  granted to additional staff on a per-person basis.
- **Data classification:** Internal use only. Contains device identifiers
  and staff assignment records. No PII beyond staff name, email, and
  department (already held elsewhere in Entra ID).

## Ownership

| Role                 | Person                                     |
| -------------------- | ------------------------------------------ |
| System owner         | Matt Hutchins-Copping (IT, WSC)            |
| Technical maintainer | Matt Hutchins-Copping                      |
| Vendor / support     | Self-hosted; Cloudflare as infrastructure  |

This is a council-owned system, not a third-party SaaS product. The source
code is in a GitHub repository administered by the system owner. Council
holds full control of the data, deployments, and access policies.

## Where the data lives

- **Application:** Cloudflare (global edge network, serverless).
- **Database:** Cloudflare D1 (SQLite-compatible managed database).
- **Photos:** Cloudflare R2 (object storage).
- **Authentication:** Microsoft Entra ID (existing council tenant) via
  Cloudflare Access.

Cloudflare data residency: the active region is set to APAC and data is
stored in Asia-Pacific data centres. This is verifiable in the Cloudflare
dashboard.

## How access is controlled

Two layers of authentication:

1. **Cloudflare Access** enforces Microsoft Entra ID single sign-on. Only
   identities ending in `@walgett.nsw.gov.au` can reach the application at
   all.
2. **Internal user allow-list** — passing SSO is not sufficient. Each user
   must be explicitly added by an admin within the app. Default-deny.

Audit: every login and every change to an asset is logged to an activity
table with the acting user, timestamp, and (for sensitive operations) IP
address.

## Backup and recovery

- **Backup schedule:** Weekly, automated, full database export.
- **Backup location:** GitHub (separate provider from Cloudflare —
  deliberate separation so a single-vendor incident cannot remove both
  the system and the backups).
- **Retention:** 90 days rolling.
- **RPO (Recovery Point Objective):** Up to 7 days of data loss in the
  worst case, assuming weekly backups.
- **RTO (Recovery Time Objective):** Approximately 1 hour for a full
  database restore from backup, performed by the system owner.

A restore runbook is documented in `docs/OPERATIONS.md`.

## Continuity and failure modes

| Failure                           | Effect                                  | Recovery                        |
| --------------------------------- | --------------------------------------- | ------------------------------- |
| Cloudflare outage                 | App offline until Cloudflare recovers   | Wait; no data loss.             |
| Microsoft Entra ID outage         | SSO unavailable                         | Break-glass master-key login.   |
| Database corruption               | App may return errors                   | Restore from weekly backup.     |
| System owner unavailable          | New changes blocked; app keeps running  | Documentation in `docs/` hands over ownership.|
| Cloudflare account compromised    | Access and data at risk                 | Off-provider backups on GitHub. |

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

A realistic paid-tier scenario would cost less than $20/month.

## Security posture — summary

- SSO + explicit allow-list (two-layer auth).
- All communication over HTTPS with HTTP Strict Transport Security.
- API calls to external browsers require either a signed CF Access
  identity cookie or, for authorised enrolment scripts, a secret API key
  stored as a Wrangler secret.
- Write-destructive endpoints (bulk import, user purge, Entra sync) are
  admin-only and server-enforced.
- Rate limiting on the master-key path; rate-limit failures are logged
  separately with source IP.
- No secrets in the Git repository; all secrets managed via Cloudflare's
  Wrangler secret store (encrypted at rest, not visible to the dashboard).
- Detailed security model in `docs/ARCHITECTURE.md`.

## Known limitations (disclosed honestly)

- **Bus factor:** One technical maintainer. Documentation mitigates this
  but does not eliminate it.
- **No independent penetration test.** The application has been built
  against current OWASP Top 10 guidance and reviewed for the common issues
  (auth bypass, injection, CORS, access control), but no third-party
  audit has been conducted.
- **Not load-tested at scale.** Designed for a ~150-device council. It
  would likely comfortably handle 10× that, but has not been proven.

## Questions this is likely to answer

**"Where's the data?"** Cloudflare APAC region. Backups on GitHub.

**"What's the licensing cost?"** Zero at current scale.

**"What if Matt leaves?"** The code, infrastructure, and this
documentation stay. Any competent sysadmin with basic web development
familiarity can take it over; the stack is mainstream and well-documented.

**"Why not buy something?"** Evaluated — see `docs/ARCHITECTURE.md`.
Commercial options either cost more than makes sense at council scale, or
don't fit how IT operates here.

**"What if Cloudflare disappears overnight?"** Off-provider backups on
GitHub mean the data is recoverable. Rebuilding the application on a
different stack would require development effort but is not impossible;
all code is open and in the repo.
