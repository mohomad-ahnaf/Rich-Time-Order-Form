-- Soft visibility states preserve order snapshots, ownership, and references.
ALTER TABLE quotations ADD COLUMN hidden_at TEXT;
ALTER TABLE quotations ADD COLUMN deleted_at TEXT;

CREATE INDEX quotations_visibility_history_idx
  ON quotations(deleted_at, hidden_at, created_at DESC);
