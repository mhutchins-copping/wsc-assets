-- Phone-specific attributes promoted out of the notes field into proper
-- columns. Previously the phone enrolment form stuffed "Phone: xxx -
-- Carrier: yyy" into notes, which made the detail page ugly (Hardware
-- Specs was a grid of em-dashes with phone info in the Notes card) and
-- the values unqueryable. Nullable so non-phone assets are unaffected.

ALTER TABLE assets ADD COLUMN phone_number TEXT;
ALTER TABLE assets ADD COLUMN carrier TEXT;
