-- Maintenance is controlled by an explicit, persisted capability rather than a
-- client-side username comparison.  The existing local Developer admin is the
-- initial controller; other accounts remain unchanged.
ALTER TABLE users ADD COLUMN maintenance_capable INTEGER NOT NULL DEFAULT 0 CHECK(maintenance_capable IN (0,1));
UPDATE users SET maintenance_capable=1 WHERE username_normalized='developer' AND COALESCE(role_v2, role)='ADMIN';

CREATE TABLE maintenance_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id INTEGER REFERENCES users(id),
  updated_by_username TEXT
);
INSERT INTO maintenance_state(id, enabled) VALUES(1, 0);

CREATE TABLE maintenance_audit (
  id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  actor_username TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX maintenance_audit_created_idx ON maintenance_audit(created_at DESC, id DESC);
