-- Asset issue / receipt acknowledgement workflow. When an admin checks a
-- device out to someone, they can email the recipient a token-gated
-- signing link; the recipient draws a signature on a public page, and
-- the signed receipt is kept for audit.
--
-- The signing page lives on api.it-wsc.com (not behind CF Access) so
-- recipients can sign from any device on any network without bumping
-- into an SSO challenge for what's a one-off acknowledgement.

CREATE TABLE IF NOT EXISTS asset_issues (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  -- URL-safe unguessable token carried by the signing link. Acts as the
  -- sole authorization for the public signing endpoint, so it must be
  -- generated with crypto.getRandomValues, not Math.random.
  token TEXT UNIQUE NOT NULL,
  issued_by_email TEXT,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  email_sent_at TEXT,
  signed_at TEXT,
  -- Full data URL (image/png;base64,...) of the canvas-drawn signature.
  -- ~15-40KB per signature; kept in D1 alongside the row so the signed
  -- artefact and its metadata can never go out of sync.
  signature_data_url TEXT,
  signature_name TEXT,
  signature_ip TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | signed | cancelled | expired
  expires_at TEXT,
  -- Snapshot of the terms the recipient was shown, so editing the template
  -- later doesn't retroactively change what someone signed for.
  terms_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_asset_issues_asset ON asset_issues(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_issues_person ON asset_issues(person_id);
CREATE INDEX IF NOT EXISTS idx_asset_issues_status ON asset_issues(status);
-- token already has an index via the UNIQUE constraint.
