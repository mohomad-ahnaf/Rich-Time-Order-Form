CREATE TABLE order_code_sequence (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  last_value INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO order_code_sequence (id, last_value)
SELECT 1, COALESCE(MAX(id), 0) FROM quotations;
