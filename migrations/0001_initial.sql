PRAGMA foreign_keys = ON;

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  shop_name TEXT NOT NULL DEFAULT 'Set up your shop name',
  phone TEXT NOT NULL DEFAULT 'Set up your phone number',
  email TEXT,
  address TEXT NOT NULL DEFAULT 'Set up your shop address',
  validity_days INTEGER NOT NULL DEFAULT 14 CHECK(validity_days BETWEEN 0 AND 365),
  default_notes TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO settings (id) VALUES (1);

CREATE TABLE buyers (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX buyers_search_idx ON buyers(full_name, phone);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  brand TEXT NOT NULL,
  model_name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  colour TEXT,
  description TEXT,
  price_minor INTEGER NOT NULL CHECK(price_minor >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX products_search_idx ON products(brand, model_name, sku);

CREATE TABLE quotations (
  id INTEGER PRIMARY KEY,
  quotation_number TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  buyer_id INTEGER NOT NULL REFERENCES buyers(id),
  quotation_date TEXT NOT NULL,
  valid_until TEXT,
  notes TEXT,
  total_minor INTEGER NOT NULL CHECK(total_minor >= 0),
  buyer_name TEXT NOT NULL, buyer_phone TEXT NOT NULL, buyer_email TEXT, buyer_address TEXT,
  shop_name TEXT NOT NULL, shop_phone TEXT NOT NULL, shop_email TEXT, shop_address TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX quotations_history_idx ON quotations(created_at DESC);
CREATE INDEX quotations_buyer_idx ON quotations(buyer_name);

CREATE TABLE quotation_items (
  id INTEGER PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  item_name TEXT NOT NULL,
  description TEXT,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0 AND quantity <= 9999),
  unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor >= 0),
  row_total_minor INTEGER NOT NULL CHECK(row_total_minor >= 0)
);
CREATE INDEX quotation_items_quote_idx ON quotation_items(quotation_id);
