-- Additive Storekeeper and dispatch support. Existing users and orders remain unchanged.
ALTER TABLE users ADD COLUMN role_v2 TEXT CHECK(role_v2 IS NULL OR role_v2 IN ('ADMIN','REP','STOREKEEPER'));

ALTER TABLE quotations ADD COLUMN dispatched_at TEXT;
ALTER TABLE quotations ADD COLUMN dispatched_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE quotations ADD COLUMN dispatcher_username TEXT;
ALTER TABLE quotations ADD COLUMN dispatch_notes TEXT;
ALTER TABLE quotations ADD COLUMN delivery_reference TEXT;
ALTER TABLE quotations ADD COLUMN dispatch_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE quotation_items ADD COLUMN packing_checked INTEGER NOT NULL DEFAULT 0 CHECK(packing_checked IN (0,1));

CREATE TABLE order_dispatch_audit (
  id INTEGER PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id),
  action TEXT NOT NULL CHECK(action IN ('DISPATCHED','RETURNED_TO_PENDING')),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  actor_username TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX quotations_dispatch_queue_idx ON quotations(deleted_at, hidden_at, dispatched_at, created_at);
CREATE INDEX order_dispatch_audit_order_idx ON order_dispatch_audit(quotation_id, created_at DESC);
