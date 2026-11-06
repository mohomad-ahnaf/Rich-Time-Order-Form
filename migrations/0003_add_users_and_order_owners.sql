CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','REP')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE quotations ADD COLUMN created_by_user_id INTEGER REFERENCES users(id);
CREATE INDEX quotations_creator_history_idx ON quotations(created_by_user_id, created_at DESC);
