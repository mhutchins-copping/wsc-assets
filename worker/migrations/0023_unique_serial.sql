-- 0023_unique_serial.sql
-- Enforce one-asset-per-physical-device by adding a partial UNIQUE index on
-- assets.serial_number. NULL and empty serials remain allowed (peripherals,
-- consumable-style items, or devices we haven't recorded a serial for yet).
--
-- Pre-existing duplicates are resolved deterministically: the row with the
-- most recent updated_at wins; loser rows have their serial_number nulled
-- and the original serial recorded in .notes. No row is deleted.
--
-- Run integrity check before applying:
--   curl -H "Authorization: Bearer $TOKEN" https://api.it-wsc.com/api/admin/integrity
-- to see the duplicate set this migration will rewrite.

UPDATE assets
SET
  notes = COALESCE(notes || char(10), '') ||
          '[migration 0023: duplicate serial ''' || serial_number ||
          ''' cleared ' || datetime('now') ||
          '; canonical record is the most recently updated asset with this serial]',
  serial_number = NULL,
  updated_at = datetime('now')
WHERE serial_number IS NOT NULL
  AND serial_number != ''
  AND id NOT IN (
    SELECT id FROM (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY serial_number
               ORDER BY updated_at DESC, rowid DESC
             ) AS rn
      FROM assets
      WHERE serial_number IS NOT NULL AND serial_number != ''
    )
    WHERE rn = 1
  );

-- Replace the non-unique lookup index with a partial UNIQUE one.
-- Partial because NULL/empty serials are legitimate (mice, keyboards, cables).
DROP INDEX IF EXISTS idx_assets_serial;
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_serial_unique
  ON assets(serial_number)
  WHERE serial_number IS NOT NULL AND serial_number != '';
