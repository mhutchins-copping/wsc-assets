-- Phase 1 of MDM enrolment helper. Mirrors the asset_issues pattern
-- (token-gated public page, no SSO) for the staff-facing handover URL
-- that goes out with each provisioned device. Token = sole authorization.

CREATE TABLE IF NOT EXISTS intune_handovers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  token TEXT UNIQUE NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  serial TEXT NOT NULL,
  os TEXT NOT NULL,                    -- 'ios' | 'android' | 'byod_android' | 'byod_ios' | 'aosp'
  profile_id TEXT,                     -- Apple enrolment profile id, or Android Device Owner profile id
  profile_name TEXT,
  dep_token_id TEXT,                   -- which ABM token, when applicable
  qr_payload TEXT,                     -- Android only: base64 JSON for QR rendering
  qr_expires_at TEXT,                  -- Android token validity; informational
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | opened | enrolled | expired
  created_by_email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  opened_at TEXT,
  enrolled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_intune_handovers_asset ON intune_handovers(asset_id);
CREATE INDEX IF NOT EXISTS idx_intune_handovers_person ON intune_handovers(person_id);
CREATE INDEX IF NOT EXISTS idx_intune_handovers_status ON intune_handovers(status);
CREATE INDEX IF NOT EXISTS idx_intune_handovers_expiry ON intune_handovers(expires_at);
CREATE INDEX IF NOT EXISTS idx_intune_handovers_serial ON intune_handovers(serial);
