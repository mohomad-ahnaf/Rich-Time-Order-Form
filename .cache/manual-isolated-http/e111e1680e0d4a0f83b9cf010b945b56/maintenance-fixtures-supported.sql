INSERT OR IGNORE INTO users (username,username_normalized,password_hash,role,role_v2,active,maintenance_capable)
SELECT 'Developer','developer',password_hash,'ADMIN','ADMIN',1,1
FROM users WHERE username_normalized='admin';

INSERT OR IGNORE INTO users (username,username_normalized,password_hash,role,role_v2,active,maintenance_capable)
SELECT 'OtherAdmin','otheradmin',password_hash,'ADMIN','ADMIN',1,0
FROM users WHERE username_normalized='admin';

INSERT OR IGNORE INTO users (username,username_normalized,password_hash,role,role_v2,active,maintenance_capable)
SELECT 'maintenance-rep','maintenance-rep',password_hash,'REP','REP',1,0
FROM users WHERE username_normalized='admin';

INSERT OR IGNORE INTO users (username,username_normalized,password_hash,role,role_v2,active,maintenance_capable)
SELECT 'maintenance-store','maintenance-store',password_hash,'REP','STOREKEEPER',1,0
FROM users WHERE username_normalized='admin';

UPDATE users
SET password_hash=(SELECT password_hash FROM users WHERE username_normalized='admin'),
    active=1,
    role='ADMIN',
    role_v2='ADMIN',
    maintenance_capable=1
WHERE username_normalized='developer';

UPDATE users
SET password_hash=(SELECT password_hash FROM users WHERE username_normalized='admin'),
    active=1,
    role='ADMIN',
    role_v2='ADMIN',
    maintenance_capable=0
WHERE username_normalized='otheradmin';

UPDATE users
SET password_hash=(SELECT password_hash FROM users WHERE username_normalized='admin'),
    active=1,
    role='REP',
    role_v2='REP',
    maintenance_capable=0
WHERE username_normalized='maintenance-rep';

UPDATE users
SET password_hash=(SELECT password_hash FROM users WHERE username_normalized='admin'),
    active=1,
    role='REP',
    role_v2='STOREKEEPER',
    maintenance_capable=0
WHERE username_normalized='maintenance-store';

UPDATE maintenance_state
SET enabled=0, updated_at=CURRENT_TIMESTAMP, updated_by_user_id=NULL, updated_by_username=NULL
WHERE id=1;