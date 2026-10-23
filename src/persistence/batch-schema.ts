// Rebuild the referenced ledger and its charge child together; retain every historical column.
export const batchSchema = `
CREATE TABLE batches (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES owners(id),
 account_id TEXT NOT NULL REFERENCES accounts(id), currency TEXT NOT NULL CHECK(currency='USD'),
 merchant_config_id TEXT NOT NULL, total_minor INTEGER NOT NULL CHECK(total_minor BETWEEN 1 AND 1000000000),
 allocation_hash TEXT NOT NULL, state TEXT NOT NULL CHECK(state='FROZEN'), frozen_at INTEGER NOT NULL
) STRICT;
CREATE TABLE allocations (
 id TEXT PRIMARY KEY NOT NULL,batch_id TEXT NOT NULL REFERENCES batches(id),
 charge_id TEXT NOT NULL REFERENCES charges(id),amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),
 state TEXT NOT NULL CHECK(state='LOCKED'),created_at INTEGER NOT NULL,UNIQUE(batch_id,charge_id)
) STRICT;
CREATE UNIQUE INDEX one_locked_charge ON allocations(charge_id) WHERE state='LOCKED';
CREATE TABLE batch_requests (
 owner_id TEXT NOT NULL REFERENCES owners(id),key TEXT NOT NULL,request_hash TEXT NOT NULL,
 batch_id TEXT NOT NULL REFERENCES batches(id),PRIMARY KEY(owner_id,key)
) STRICT;
CREATE TABLE ledger_next (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,account_id TEXT NOT NULL REFERENCES accounts(id),task_id TEXT NOT NULL,
 purchase_id TEXT NOT NULL,reservation_id TEXT NOT NULL REFERENCES reservations(id),
 type TEXT NOT NULL CHECK(type IN('CREDIT_RESERVED','CREDIT_RELEASED','SERVICE_CHARGED','SETTLEMENT_ALLOCATED')),
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),currency TEXT NOT NULL CHECK(currency='USD'),
 dedupe_key TEXT NOT NULL,payload_hash TEXT NOT NULL,created_at INTEGER NOT NULL,
 allocation_id TEXT UNIQUE REFERENCES allocations(id),
 CHECK((type='SETTLEMENT_ALLOCATED')=(allocation_id IS NOT NULL)),
 UNIQUE(account_id,dedupe_key),UNIQUE(reservation_id,type),FOREIGN KEY(task_id,account_id) REFERENCES tasks(id,account_id)
) STRICT;
INSERT INTO ledger_next SELECT *,NULL FROM ledger_events;
CREATE TABLE charges_next (
 id TEXT PRIMARY KEY NOT NULL,purchase_id TEXT NOT NULL UNIQUE REFERENCES purchases(id),
 delivery_id TEXT NOT NULL UNIQUE REFERENCES deliveries(id),ledger_event_id TEXT NOT NULL UNIQUE REFERENCES ledger_next(id),
 account_id TEXT NOT NULL REFERENCES accounts(id),task_id TEXT NOT NULL REFERENCES tasks(id),
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),currency TEXT NOT NULL CHECK(currency='USD')
) STRICT;
INSERT INTO charges_next SELECT * FROM charges;
DROP TABLE charges;
DROP TABLE ledger_events;
ALTER TABLE ledger_next RENAME TO ledger_events;
ALTER TABLE charges_next RENAME TO charges;
ALTER TABLE economic_audit ADD COLUMN batch_id TEXT REFERENCES batches(id);
CREATE TRIGGER charge_requires_evidence BEFORE INSERT ON charges WHEN NOT EXISTS(
 SELECT 1 FROM purchases p JOIN reservations r ON r.purchase_id=p.id
 JOIN deliveries d ON d.id=NEW.delivery_id AND d.purchase_id=p.id
 JOIN verifications v ON v.delivery_id=d.id AND v.result='PASS'
 JOIN ledger_events l ON l.id=NEW.ledger_event_id AND l.purchase_id=p.id AND l.reservation_id=r.id AND l.type='SERVICE_CHARGED'
 WHERE p.id=NEW.purchase_id AND p.status='EXECUTING' AND r.state='CONSUMED'
 AND p.account_id=NEW.account_id AND p.task_id=NEW.task_id AND r.amount_minor=NEW.amount_minor AND l.amount_minor=NEW.amount_minor
 AND l.account_id=NEW.account_id AND l.task_id=NEW.task_id AND l.currency=NEW.currency
) BEGIN SELECT RAISE(ABORT,'CHARGE_REQUIRES_VERIFIED_DELIVERY'); END;
` +
 ['ledger_events','charges','batches','allocations','batch_requests'].map(table=>['UPDATE','DELETE'].map(operation=>
 `CREATE TRIGGER ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;`).join('\n')).join('\n') + `
CREATE TRIGGER allocation_requires_charge BEFORE INSERT ON allocations WHEN NOT EXISTS (
 SELECT 1 FROM charges c JOIN purchases p ON p.id=c.purchase_id JOIN verifications v ON v.delivery_id=c.delivery_id
 JOIN batches b ON b.id=NEW.batch_id JOIN accounts a ON a.id=c.account_id
 WHERE c.id=NEW.charge_id AND p.status='ACCEPTED' AND v.result='PASS'
 AND c.amount_minor=NEW.amount_minor AND c.account_id=b.account_id AND a.owner_id=b.owner_id AND c.currency=b.currency
) BEGIN SELECT RAISE(ABORT,'ALLOCATION_REQUIRES_ACCEPTED_CHARGE'); END;
`;
