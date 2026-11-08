-- Cancellation is a separate terminal status; returned-to-pending remains Pending.
ALTER TABLE quotations ADD COLUMN cancelled_at TEXT;
ALTER TABLE quotations ADD COLUMN cancelled_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE quotations ADD COLUMN canceller_username TEXT;
ALTER TABLE quotations ADD COLUMN cancellation_reason TEXT;

CREATE TABLE order_status_audit (
  id INTEGER PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id),
  action TEXT NOT NULL CHECK(action IN ('CANCELLED')),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  actor_username TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX quotations_status_history_idx ON quotations(deleted_at, hidden_at, cancelled_at, dispatched_at, created_at DESC, id DESC);
CREATE INDEX order_status_audit_order_idx ON order_status_audit(quotation_id, created_at DESC);
