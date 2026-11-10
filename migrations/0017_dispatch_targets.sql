CREATE TABLE dispatch_targets (
  month_key TEXT PRIMARY KEY CHECK(month_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  order_target INTEGER NOT NULL CHECK(order_target > 0),
  value_target_minor INTEGER NOT NULL CHECK(value_target_minor > 0),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_user_id INTEGER NOT NULL REFERENCES users(id),
  updated_by_username TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
