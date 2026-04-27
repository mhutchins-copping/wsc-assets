-- Seed default field profiles for existing categories so the generification
-- is useful immediately without manual DB edits.

UPDATE categories SET field_profile = '{"show_specs":true,"show_phone":false,"custom_fields":[]}' WHERE id IN ('cat_laptop', 'cat_desktop');
UPDATE categories SET field_profile = '{"show_specs":false,"show_phone":true,"custom_fields":[]}' WHERE id IN ('cat_phone', 'cat_deskphone');
UPDATE categories SET field_profile = '{"show_specs":false,"show_phone":false,"custom_fields":[]}' WHERE id IN ('cat_monitor', 'cat_printer', 'cat_scanner', 'cat_tablet');
UPDATE categories SET field_profile = '{"show_specs":false,"show_phone":false,"custom_fields":[{"key":"port_count","label":"Port Count","type":"number"},{"key":"firmware","label":"Firmware Version","type":"text"},{"key":"management_ip","label":"Management IP","type":"text"}]}' WHERE id IN ('cat_switch', 'cat_ap', 'cat_router', 'cat_firewall');
UPDATE categories SET field_profile = '{"show_specs":false,"show_phone":false,"custom_fields":[]}' WHERE id IN ('cat_keyboard', 'cat_mouse', 'cat_headset', 'cat_webcam', 'cat_dock');
