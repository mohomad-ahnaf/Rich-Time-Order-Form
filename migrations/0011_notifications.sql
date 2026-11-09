-- Persistent, per-user inbox. Target data is deliberately limited to a type/id;
-- clients must re-authorize through the normal order/job API before opening it.
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  recipient_user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  event_key TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(recipient_user_id, event_key)
);
CREATE INDEX notifications_inbox_idx ON notifications(recipient_user_id, read_at, created_at DESC, id DESC);

CREATE TABLE notification_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  private_lock_screen INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  content_encoding TEXT NOT NULL DEFAULT 'aes128gcm',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error_at TEXT,
  disabled_at TEXT
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions(user_id, disabled_at);
