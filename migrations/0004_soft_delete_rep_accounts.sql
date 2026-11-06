ALTER TABLE users ADD COLUMN deleted_at TEXT;

CREATE INDEX users_active_accounts_idx ON users(deleted_at, role, username_normalized);
