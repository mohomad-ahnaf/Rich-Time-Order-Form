-- Separate Rep acknowledgement from the existing ACTIVE/COMPLETED/CANCELLED lifecycle.
-- Existing jobs remain usable and are treated as already accepted.
ALTER TABLE jobs ADD COLUMN response_status TEXT NOT NULL DEFAULT 'ACCEPTED' CHECK(response_status IN ('AWAITING_RESPONSE','ACCEPTED','REJECTED'));
ALTER TABLE jobs ADD COLUMN responded_at TEXT;
ALTER TABLE jobs ADD COLUMN responded_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE jobs ADD COLUMN responded_by_username TEXT;
ALTER TABLE jobs ADD COLUMN rejection_reason TEXT;

CREATE TABLE job_response_audit (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  action TEXT NOT NULL CHECK(action IN ('ACCEPTED','REJECTED')),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  actor_username TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX job_response_audit_job_idx ON job_response_audit(job_id, created_at DESC, id DESC);
CREATE INDEX jobs_response_idx ON jobs(assigned_rep_user_id, response_status, created_at DESC, id DESC);
