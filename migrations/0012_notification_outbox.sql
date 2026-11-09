CREATE TABLE notification_outbox (
  id INTEGER PRIMARY KEY,
  notification_id INTEGER NOT NULL UNIQUE REFERENCES notifications(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TEXT,
  failed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX notification_outbox_due_idx ON notification_outbox(delivered_at, failed_at, next_attempt_at, id);
