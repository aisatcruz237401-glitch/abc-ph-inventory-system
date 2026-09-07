USE inventory;

INSERT INTO users (username, password, role, branch)
VALUES
  ('admin', '$2a$10$J6/2sV0F0K4gBUH5Xqp2X.On9m5Z3NrC1kaZDJINoR1jYpC3Bz0xK', 'admin', 'Main')
ON DUPLICATE KEY UPDATE username = username;

INSERT INTO products (barcode, product_name, category, expiration_date)
VALUES
  ('RB-773-Z', 'Rabipur Vaccine', 'Vaccine', '2027-12-31'),
  ('AB-202-Z', 'Covid Shield', 'Vaccine', '2026-06-30'),
  ('FL-101-Z', 'Influenza Vaccine', 'Vaccine', '2026-10-15'),
  ('VAX-ABHAYRAB', 'Abhayrab', 'Vaccines / Biologicals', NULL),
  ('VAX-ERIG', 'Equirab / ERIG', 'Vaccines / Biologicals', NULL),
  ('VAX-TT', 'Tetanus Toxoid (TT)', 'Vaccines / Biologicals', NULL),
  ('VAX-TTS', 'TT Serum', 'Vaccines / Biologicals', NULL),
  ('VAX-SYR-ARV', 'Syringe for ARV & ERIG', 'Medical Supplies', NULL),
  ('VAX-SYR-TT', 'Syringe for TT', 'Medical Supplies', NULL),
  ('VAX-GLOVES', 'Gloves', 'Medical Supplies', NULL),
  ('VAX-FACEMASK', 'Facemask', 'Medical Supplies', NULL),
  ('VAX-ALCOHOL', 'Alcohol', 'Medical Supplies', NULL),
  ('VAX-COTTON', 'Cotton', 'Medical Supplies', NULL),
  ('VAX-MICROPORE', 'Micropore Tape', 'Medical Supplies', NULL),
  ('VAX-BANDAID', 'Band-Aid', 'Medical Supplies', NULL),
  ('VAX-GAUZE', 'Gauze', 'Medical Supplies', NULL),
  ('VAX-BETADINE', 'Betadine', 'Medical Supplies', NULL),
  ('VAX-TEMP-RECEIPT', 'Temporary Receipt', 'Administrative / Documentation', NULL),
  ('VAX-VACCINE-CARD', 'Vaccine Card', 'Administrative / Documentation', NULL),
  ('VAX-PATIENT-RECORD', 'Patient''s Record', 'Administrative / Documentation', NULL),
  ('VAX-BALLPEN-RB', 'Ballpen Red/Black', 'Administrative / Documentation', NULL)
ON DUPLICATE KEY UPDATE barcode = barcode;

INSERT INTO inventory (product_id, branch, quantity, last_updated)
VALUES
  ((SELECT id FROM products WHERE barcode = 'RB-773-Z'), 'Main', 150, NOW()),
  ((SELECT id FROM products WHERE barcode = 'AB-202-Z'), 'Main', 80, NOW()),
  ((SELECT id FROM products WHERE barcode = 'FL-101-Z'), 'East', 45, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-ABHAYRAB'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-ERIG'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-TT'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-TTS'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-SYR-ARV'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-SYR-TT'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-GLOVES'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-FACEMASK'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-ALCOHOL'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-COTTON'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-MICROPORE'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-BANDAID'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-GAUZE'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-BETADINE'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-TEMP-RECEIPT'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-VACCINE-CARD'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-PATIENT-RECORD'), 'Main', 0, NOW()),
  ((SELECT id FROM products WHERE barcode = 'VAX-BALLPEN-RB'), 'Main', 0, NOW())
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), last_updated = VALUES(last_updated);

INSERT INTO stock_transactions (barcode, product_id, type, quantity, user, branch)
VALUES
  ('RB-773-Z', (SELECT id FROM products WHERE barcode = 'RB-773-Z'), 'RECEIVE', 100, 'admin', 'Main'),
  ('AB-202-Z', (SELECT id FROM products WHERE barcode = 'AB-202-Z'), 'RECEIVE', 80, 'admin', 'Main'),
  ('FL-101-Z', (SELECT id FROM products WHERE barcode = 'FL-101-Z'), 'RECEIVE', 45, 'admin', 'East');
