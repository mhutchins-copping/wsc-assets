-- Lifecycle: when an IT asset is expected to reach end-of-life and be
-- replaced. Council policy is roughly a three-year refresh on PCs /
-- laptops, so we backfill existing rows from purchase_date + 3 years;
-- the field is editable per asset for gear that legitimately runs
-- longer (monitors, printers, network hardware) or shorter.

ALTER TABLE assets ADD COLUMN retirement_date TEXT;

-- Backfill: any row with a purchase_date gets a default retirement
-- three years out. Rows without a purchase_date leave retirement null
-- -- the admin can fill it in when they have the data.
UPDATE assets
SET retirement_date = date(purchase_date, '+3 years')
WHERE purchase_date IS NOT NULL AND retirement_date IS NULL;
