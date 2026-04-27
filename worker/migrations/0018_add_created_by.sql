-- Track asset creator for scoped edit/delete permissions
ALTER TABLE assets ADD COLUMN created_by TEXT;
