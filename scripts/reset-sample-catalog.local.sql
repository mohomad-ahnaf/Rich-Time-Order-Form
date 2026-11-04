-- DESTRUCTIVE LOCAL DEVELOPMENT ACTION.
-- This script only targets the local D1 state passed by the companion PowerShell script.
-- It preserves quotations, quotation-item snapshots, settings, and authentication data.
-- Buyers and products referenced by existing quotations are retained but deactivated.

BEGIN TRANSACTION;

DELETE FROM buyers
WHERE NOT EXISTS (
  SELECT 1 FROM quotations WHERE quotations.buyer_id = buyers.id
);

UPDATE buyers
SET active = 0, updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM quotations WHERE quotations.buyer_id = buyers.id
);

DELETE FROM products
WHERE NOT EXISTS (
  SELECT 1 FROM quotation_items WHERE quotation_items.product_id = products.id
);

UPDATE products
SET active = 0, updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM quotation_items WHERE quotation_items.product_id = products.id
);

INSERT INTO buyers (full_name, phone, email, address, active) VALUES
  ('Kasun Perera', 'DEV-NO-PHONE-01', NULL, NULL, 1),
  ('Nimal Fernando', 'DEV-NO-PHONE-02', NULL, NULL, 1),
  ('Chamara Silva', 'DEV-NO-PHONE-03', NULL, NULL, 1),
  ('Dilini Jayawardena', 'DEV-NO-PHONE-04', NULL, NULL, 1),
  ('Sachini Wijesinghe', 'DEV-NO-PHONE-05', NULL, NULL, 1),
  ('Tharindu Bandara', 'DEV-NO-PHONE-06', NULL, NULL, 1),
  ('Fathima Ayesha', 'DEV-NO-PHONE-07', NULL, NULL, 1),
  ('Mohamed Imran', 'DEV-NO-PHONE-08', NULL, NULL, 1),
  ('Kavitha Rajendran', 'DEV-NO-PHONE-09', NULL, NULL, 1),
  ('Suresh Kumar', 'DEV-NO-PHONE-10', NULL, NULL, 1);

INSERT INTO products (brand, model_name, sku, colour, description, price_minor, active) VALUES
  ('Casio', 'F-91W Digital', 'CAS-F91W', 'Black', 'Local demonstration product', 850000, 1),
  ('Casio', 'A168 Digital', 'CAS-A168', 'Silver', 'Local demonstration product', 1550000, 1),
  ('Casio', 'MTP-1302 Analog', 'CAS-MTP1302', 'Blue/Silver', 'Local demonstration product', 2200000, 1),
  ('Casio G-Shock', 'DW-5600', 'GSH-DW5600', 'Black', 'Local demonstration product', 3800000, 1),
  ('Seiko', 'Seiko 5 SNK809', 'SEI-SNK809', 'Black', 'Local demonstration product', 5500000, 1),
  ('Citizen', 'BI5000 Analog', 'CIT-BI5000', 'Silver', 'Local demonstration product', 3200000, 1),
  ('Orient', 'Bambino', 'ORI-BAMBINO', 'Brown/Cream', 'Local demonstration product', 6800000, 1),
  ('Timex', 'Weekender', 'TIM-WEEKENDER', 'Green', 'Local demonstration product', 1850000, 1),
  ('Q&Q', 'VP46 Analog', 'QNQ-VP46', 'Black', 'Local demonstration product', 450000, 1),
  ('SKMEI', '1251 Digital', 'SKM-1251', 'Black', 'Local demonstration product', 350000, 1)
ON CONFLICT(sku) DO UPDATE SET
  brand = excluded.brand,
  model_name = excluded.model_name,
  colour = excluded.colour,
  description = excluded.description,
  price_minor = excluded.price_minor,
  active = 1,
  updated_at = CURRENT_TIMESTAMP;

COMMIT;
