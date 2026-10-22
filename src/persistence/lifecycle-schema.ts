export const lifecycleSchema = `
DROP TRIGGER ledger_no_update;
DROP TRIGGER ledger_no_delete;
DROP TRIGGER audit_no_update;
DROP TRIGGER audit_no_delete;
CREATE TABLE reservations_next (
 id TEXT PRIMARY KEY NOT NULL,purchase_id TEXT NOT NULL UNIQUE,account_id TEXT NOT NULL REFERENCES accounts(id),task_id TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),state TEXT NOT NULL CHECK(state IN('HELD','CONSUMED','RELEASED')),expires_at INTEGER NOT NULL,
 FOREIGN KEY(task_id,account_id) REFERENCES tasks(id,account_id)) STRICT;
INSERT INTO reservations_next SELECT * FROM reservations;
CREATE TABLE ledger_next (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,account_id TEXT NOT NULL REFERENCES accounts(id),task_id TEXT NOT NULL,
 purchase_id TEXT NOT NULL,reservation_id TEXT NOT NULL REFERENCES reservations_next(id),type TEXT NOT NULL CHECK(type IN('CREDIT_RESERVED','CREDIT_RELEASED','SERVICE_CHARGED')),
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),currency TEXT NOT NULL CHECK(currency='USD'),dedupe_key TEXT NOT NULL,payload_hash TEXT NOT NULL,created_at INTEGER NOT NULL,
 UNIQUE(account_id,dedupe_key),UNIQUE(reservation_id,type),FOREIGN KEY(task_id,account_id) REFERENCES tasks(id,account_id)) STRICT;
INSERT INTO ledger_next SELECT * FROM ledger_events;
CREATE TABLE audit_next (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,account_id TEXT NOT NULL REFERENCES accounts(id),reservation_id TEXT REFERENCES reservations_next(id),actor_id TEXT NOT NULL,action TEXT NOT NULL,created_at INTEGER NOT NULL) STRICT;
INSERT INTO audit_next SELECT * FROM economic_audit;
DROP TABLE ledger_events;
DROP TABLE economic_audit;
DROP TABLE reservations;
ALTER TABLE reservations_next RENAME TO reservations;
ALTER TABLE ledger_next RENAME TO ledger_events;
ALTER TABLE audit_next RENAME TO economic_audit;
CREATE TABLE invocations(id TEXT PRIMARY KEY NOT NULL,purchase_id TEXT NOT NULL UNIQUE REFERENCES purchases(id),state TEXT NOT NULL CHECK(state IN('READY','RUNNING','DONE')),lease_until INTEGER,lease_token TEXT,execution_attempts INTEGER NOT NULL DEFAULT 0 CHECK(execution_attempts BETWEEN 0 AND 2),delivery_attempt INTEGER NOT NULL DEFAULT 1 CHECK(delivery_attempt IN(1,2))) STRICT;
CREATE TABLE deliveries(id TEXT PRIMARY KEY NOT NULL,purchase_id TEXT NOT NULL REFERENCES purchases(id),invocation_id TEXT NOT NULL REFERENCES invocations(id),attempt INTEGER NOT NULL CHECK(attempt IN(1,2)),output_json TEXT NOT NULL,output_hash TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(purchase_id,attempt)) STRICT;
CREATE TABLE verifications(id TEXT PRIMARY KEY NOT NULL,delivery_id TEXT NOT NULL UNIQUE REFERENCES deliveries(id),result TEXT NOT NULL CHECK(result IN('PASS','FAIL')),reasons_json TEXT NOT NULL,created_at INTEGER NOT NULL) STRICT;
CREATE TABLE charges(id TEXT PRIMARY KEY NOT NULL,purchase_id TEXT NOT NULL UNIQUE REFERENCES purchases(id),delivery_id TEXT NOT NULL UNIQUE REFERENCES deliveries(id),ledger_event_id TEXT NOT NULL UNIQUE REFERENCES ledger_events(id),account_id TEXT NOT NULL REFERENCES accounts(id),task_id TEXT NOT NULL REFERENCES tasks(id),amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),currency TEXT NOT NULL CHECK(currency='USD')) STRICT;
CREATE TRIGGER reservation_terminal BEFORE UPDATE ON reservations WHEN OLD.state!='HELD' OR NEW.state='HELD' OR NEW.id!=OLD.id OR NEW.amount_minor!=OLD.amount_minor OR NEW.purchase_id!=OLD.purchase_id OR NEW.account_id!=OLD.account_id OR NEW.task_id!=OLD.task_id OR NEW.expires_at!=OLD.expires_at BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RESERVATION'); END;
CREATE TRIGGER reservation_no_delete BEFORE DELETE ON reservations BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RESERVATION'); END;
CREATE TRIGGER account_identity BEFORE UPDATE ON accounts WHEN NEW.owner_id!=OLD.owner_id OR NEW.buyer_id!=OLD.buyer_id OR NEW.currency!=OLD.currency BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ACCOUNT_IDENTITY'); END;
`;
export const immutableTables = ['ledger_events','economic_audit','quotes','capabilities','snapshots','deliveries','verifications','charges'];
export const immutableSchema = immutableTables.map(table => ['UPDATE','DELETE'].map(operation =>
 `CREATE TRIGGER ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;`).join('\n')).join('\n');
