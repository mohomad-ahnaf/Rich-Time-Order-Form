-- Additive Rep job assignments. Buyer and Rep details are snapshotted so jobs
-- remain historically readable if those source records later change.
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  location_query TEXT NOT NULL,
  instructions TEXT,
  due_date TEXT,
  assigned_rep_user_id INTEGER REFERENCES users(id),
  assigned_rep_username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','COMPLETED','CANCELLED')),
  version INTEGER NOT NULL DEFAULT 0,
  cancelled_at TEXT,
  cancelled_by_user_id INTEGER REFERENCES users(id),
  cancellation_reason TEXT,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE job_items (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  buyer_id INTEGER REFERENCES buyers(id),
  buyer_name TEXT NOT NULL,
  buyer_address TEXT NOT NULL,
  visited_at TEXT,
  visited_by_user_id INTEGER REFERENCES users(id),
  visited_by_username TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(job_id, buyer_id)
);

CREATE TABLE job_audit (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  job_item_id INTEGER REFERENCES job_items(id),
  action TEXT NOT NULL CHECK(action IN ('ASSIGNED','UPDATED','CANCELLED','VISITED','UNVISITED','COMPLETED','REOPENED')),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  actor_username TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX jobs_rep_status_idx ON jobs(assigned_rep_user_id, status, created_at DESC, id DESC);
CREATE INDEX jobs_status_idx ON jobs(status, created_at DESC, id DESC);
CREATE INDEX job_items_job_idx ON job_items(job_id, visited_at, id);
CREATE INDEX job_audit_job_idx ON job_audit(job_id, created_at DESC, id DESC);
