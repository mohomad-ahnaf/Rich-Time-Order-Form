-- Keeps existing quotation_number values untouched for historical compatibility.
ALTER TABLE quotations ADD COLUMN order_code TEXT;
CREATE UNIQUE INDEX quotations_order_code_unique
  ON quotations(order_code)
  WHERE order_code IS NOT NULL;
