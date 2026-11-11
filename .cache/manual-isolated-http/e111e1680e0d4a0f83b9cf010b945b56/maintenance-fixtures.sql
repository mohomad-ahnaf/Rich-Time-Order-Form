INSERT OR IGNORE INTO users
  (username, username_normalized, password_hash, role, role_v2, active, maintenance_capable)
SELECT 'Developer', 'developer', password_hash, 'ADMIN', 'ADMIN', 1, 1
FROM users WHERE username_normalized = 'admin';

UPDATE users
SET active = 1, role = 'ADMIN', role_v2 = 'ADMIN', maintenance_capable = 1
WHERE username_normalized = 'developer';

INSERT OR IGNORE INTO users
  (username, username_normalized, password_hash, role, role_v2, active, maintenance_capable)
SELECT 'OtherAdmin', 'otheradmin', password_hash, 'ADMIN', 'ADMIN', 1, 0
FROM users WHERE username_normalized = 'admin';

UPDATE users
SET active = 1, role = 'ADMIN', role_v2 = 'ADMIN', maintenance_capable = 0
WHERE username_normalized = 'otheradmin';

CREATE TEMP TABLE fixture_assertion (value INTEGER NOT NULL CHECK(value = 1));

INSERT INTO fixture_assertion(value)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM users WHERE username_normalized = 'admin'
) THEN 1 ELSE 0 END;

INSERT INTO fixture_assertion(value)
SELECT CASE WHEN (
  SELECT COUNT(*) FROM users
  WHERE username_normalized = 'developer'
    AND active = 1
    AND COALESCE(role_v2, role) = 'ADMIN'
    AND maintenance_capable = 1
) = 1 THEN 1 ELSE 0 END;

INSERT INTO fixture_assertion(value)
SELECT CASE WHEN (
  SELECT COUNT(*) FROM users
  WHERE username_normalized = 'otheradmin'
    AND active = 1
    AND COALESCE(role_v2, role) = 'ADMIN'
    AND maintenance_capable = 0
) = 1 THEN 1 ELSE 0 END;

SELECT username, active, COALESCE(role_v2,role) AS role, maintenance_capable
FROM users
WHERE username_normalized IN ('developer','otheradmin')
ORDER BY username_normalized;