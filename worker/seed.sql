-- WSC IT Asset Management System — Seed Data

-- Locations
INSERT INTO locations (id, name, address, type) VALUES
  ('loc_chambers', 'Council Chambers', '77 Fox St, Walgett NSW 2832', 'office'),
  ('loc_lr_office', 'Lightning Ridge Office', 'Morilla St, Lightning Ridge NSW 2834', 'office'),
  ('loc_lr_depot', 'Lightning Ridge Depot', 'Morilla St, Lightning Ridge NSW 2834', 'depot'),
  ('loc_collare', 'Collarenebri Agency', '34 Mitchell St, Collarenebri NSW 2833', 'agency'),
  ('loc_store', 'IT Storeroom', '77 Fox St, Walgett NSW 2832', 'storage');

-- Categories — Parents
INSERT INTO categories (id, name, prefix, parent_id, icon) VALUES
  ('cat_hw', 'Hardware', 'H', NULL, '💻'),
  ('cat_net', 'Network', 'N', NULL, '🌐'),
  ('cat_periph', 'Peripherals', 'PE', NULL, '🖱️'),
  ('cat_infra', 'Infrastructure', 'I', NULL, '🏗️');

-- Categories — Hardware children
INSERT INTO categories (id, name, prefix, parent_id, icon) VALUES
  ('cat_laptop', 'Laptop', 'L', 'cat_hw', '💻'),
  ('cat_desktop', 'Desktop', 'D', 'cat_hw', '🖥️'),
  ('cat_monitor', 'Monitor', 'M', 'cat_hw', '🖥️'),
  ('cat_phone', 'Phone', 'P', 'cat_hw', '📱'),
  ('cat_deskphone', 'Desk Phone', 'DP', 'cat_hw', '☎️'),
  ('cat_printer', 'Printer', 'PR', 'cat_hw', '🖨️'),
  ('cat_scanner', 'Scanner', 'SC', 'cat_hw', '📠'),
  ('cat_tablet', 'Tablet', 'T', 'cat_hw', '📱');

-- Categories — Network children
INSERT INTO categories (id, name, prefix, parent_id, icon) VALUES
  ('cat_switch', 'Switch', 'SW', 'cat_net', '🔌'),
  ('cat_ap', 'Access Point', 'AP', 'cat_net', '📡'),
  ('cat_router', 'Router', 'RT', 'cat_net', '🔀'),
  ('cat_firewall', 'Firewall', 'FW', 'cat_net', '🛡️');

-- Categories — Peripheral children
INSERT INTO categories (id, name, prefix, parent_id, icon) VALUES
  ('cat_keyboard', 'Keyboard', 'KB', 'cat_periph', '⌨️'),
  ('cat_mouse', 'Mouse', 'MS', 'cat_periph', '🖱️'),
  ('cat_headset', 'Headset', 'HS', 'cat_periph', '🎧'),
  ('cat_webcam', 'Webcam', 'WC', 'cat_periph', '📷'),
  ('cat_dock', 'Docking Station', 'DS', 'cat_periph', '🔗');

-- Categories — Infrastructure children
INSERT INTO categories (id, name, prefix, parent_id, icon) VALUES
  ('cat_server', 'Server', 'SV', 'cat_infra', '🖥️'),
  ('cat_ups', 'UPS', 'UPS', 'cat_infra', '🔋'),
  ('cat_nvr', 'NVR', 'NVR', 'cat_infra', '📹'),
  ('cat_camera', 'Camera', 'CAM', 'cat_infra', '📷');
