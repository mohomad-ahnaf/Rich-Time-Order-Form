-- Durable identity for notification-worthy product changes.
ALTER TABLE products ADD COLUMN notification_revision INTEGER NOT NULL DEFAULT 0;
