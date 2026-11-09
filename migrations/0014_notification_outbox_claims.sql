-- A short lease makes concurrent scheduled/manual outbox processors safe.
ALTER TABLE notification_outbox ADD COLUMN claim_token TEXT;
ALTER TABLE notification_outbox ADD COLUMN locked_until TEXT;
CREATE INDEX notification_outbox_claim_idx ON notification_outbox(delivered_at, failed_at, next_attempt_at, locked_until, id);
