-- Add hardware spec columns to assets table
ALTER TABLE assets ADD COLUMN hostname TEXT;
ALTER TABLE assets ADD COLUMN os TEXT;
ALTER TABLE assets ADD COLUMN cpu TEXT;
ALTER TABLE assets ADD COLUMN ram_gb INTEGER;
ALTER TABLE assets ADD COLUMN disk_gb INTEGER;
ALTER TABLE assets ADD COLUMN mac_address TEXT;
ALTER TABLE assets ADD COLUMN ip_address TEXT;
ALTER TABLE assets ADD COLUMN enrolled_user TEXT;
