-- Add ip_address column to activity_log for structured rate-limiting
-- Safe to re-run: only adds column if it doesn't exist (pragma returns NULL for missing column)

ALTER TABLE activity_log ADD COLUMN ip_address TEXT;