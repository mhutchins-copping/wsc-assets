-- The Intune enrolment wizard was removed: it duplicated work that's
-- faster to do directly in the Intune portal, and asset rows are
-- easier to type by hand than navigate a UI for. Drop the table that
-- backed the public token-gated handover walkthroughs.
--
-- Nothing else references intune_handovers — the cascade DELETE in
-- purgeAsset has already been removed in the same change set.

DROP INDEX IF EXISTS idx_intune_handovers_asset;
DROP INDEX IF EXISTS idx_intune_handovers_person;
DROP INDEX IF EXISTS idx_intune_handovers_status;
DROP INDEX IF EXISTS idx_intune_handovers_expiry;
DROP INDEX IF EXISTS idx_intune_handovers_serial;

DROP TABLE IF EXISTS intune_handovers;
