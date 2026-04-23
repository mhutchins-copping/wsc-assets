-- Align existing data with the new cancel-on-delete + checkin-clears-
-- receipts rules. Two one-off cleanups:
--
-- 1. Any issue row previously marked status='cancelled' is now dead weight
--    -- the UI no longer offers the status and the cancel handler deletes
--    going forward. Drop them.
-- 2. Any issue row tied to an asset that's currently status='available' or
--    'disposed' (i.e. has been checked back in or dispositioned) no longer
--    applies to the asset's current state. New flow deletes these on
--    check-in, but existing rows from before this change should go too.

DELETE FROM asset_issues WHERE status = 'cancelled';

DELETE FROM asset_issues
WHERE asset_id IN (
  SELECT id FROM assets WHERE status IN ('available', 'disposed')
);
