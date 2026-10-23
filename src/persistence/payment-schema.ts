export const paymentSchema=`
DROP TRIGGER charge_requires_evidence;
DROP TRIGGER allocation_requires_charge;
CREATE TABLE batches_next (
 id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL REFERENCES owners(id),account_id TEXT NOT NULL REFERENCES accounts(id),
 currency TEXT NOT NULL CHECK(currency='USD'),merchant_config_id TEXT NOT NULL,total_minor INTEGER NOT NULL CHECK(total_minor BETWEEN 1 AND 1000000000),
 allocation_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('FROZEN','AWAITING_APPROVAL','CAPTURING','PAYMENT_PENDING','UNKNOWN','CANCELLED','ACTION_REQUIRED','SETTLED')),
 frozen_at INTEGER NOT NULL,cancel_latched INTEGER NOT NULL DEFAULT 0 CHECK(cancel_latched IN(0,1)),version INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT INTO batches_next SELECT *,0,0 FROM batches;
DROP TABLE batches;
ALTER TABLE batches_next RENAME TO batches;
CREATE TABLE allocations_next (
 id TEXT PRIMARY KEY NOT NULL,batch_id TEXT NOT NULL REFERENCES batches(id),charge_id TEXT NOT NULL REFERENCES charges(id),
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),state TEXT NOT NULL CHECK(state IN('LOCKED','SETTLED')),
 created_at INTEGER NOT NULL,UNIQUE(batch_id,charge_id)
) STRICT;
INSERT INTO allocations_next SELECT * FROM allocations;
DROP TABLE allocations;
ALTER TABLE allocations_next RENAME TO allocations;
CREATE UNIQUE INDEX one_locked_charge ON allocations(charge_id) WHERE state IN('LOCKED','SETTLED');
CREATE TABLE ledger_next (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,account_id TEXT NOT NULL REFERENCES accounts(id),task_id TEXT NOT NULL,
 purchase_id TEXT NOT NULL,reservation_id TEXT NOT NULL REFERENCES reservations(id),
 type TEXT NOT NULL CHECK(type IN('CREDIT_RESERVED','CREDIT_RELEASED','SERVICE_CHARGED','SETTLEMENT_ALLOCATED','PAYMENT_CONFIRMED','CHARGE_SETTLED','CHARGE_REVERSED')),
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),currency TEXT NOT NULL CHECK(currency='USD'),
 dedupe_key TEXT NOT NULL,payload_hash TEXT NOT NULL,created_at INTEGER NOT NULL,
 allocation_id TEXT REFERENCES allocations(id),charge_id TEXT REFERENCES charges(id),batch_id TEXT REFERENCES batches(id),
 CHECK((type IN('SETTLEMENT_ALLOCATED','CHARGE_SETTLED'))=(allocation_id IS NOT NULL)),
 CHECK((type='CHARGE_REVERSED')=(charge_id IS NOT NULL)),
 CHECK((type IN('CHARGE_SETTLED','PAYMENT_CONFIRMED'))=(batch_id IS NOT NULL)),
 UNIQUE(account_id,dedupe_key),UNIQUE(reservation_id,type),UNIQUE(allocation_id,type),FOREIGN KEY(task_id,account_id) REFERENCES tasks(id,account_id)
) STRICT;
INSERT INTO ledger_next SELECT *,NULL,NULL FROM ledger_events;
DROP TABLE ledger_events;
ALTER TABLE ledger_next RENAME TO ledger_events;
CREATE UNIQUE INDEX one_batch_confirmation ON ledger_events(batch_id) WHERE type='PAYMENT_CONFIRMED';
CREATE UNIQUE INDEX one_charge_reversal ON ledger_events(charge_id) WHERE type='CHARGE_REVERSED';
CREATE TABLE payment_attempts (
 id TEXT PRIMARY KEY NOT NULL,batch_id TEXT NOT NULL UNIQUE REFERENCES batches(id),
 create_key TEXT NOT NULL UNIQUE,capture_key TEXT NOT NULL UNIQUE,input_json TEXT NOT NULL,
 callback_hash TEXT NOT NULL UNIQUE,callback_used INTEGER NOT NULL DEFAULT 0 CHECK(callback_used IN(0,1)),
 order_id TEXT UNIQUE,approval_url TEXT,create_started_at INTEGER,capture_started_at INTEGER,
 create_attempts INTEGER NOT NULL DEFAULT 0 CHECK(create_attempts BETWEEN 0 AND 3),capture_attempts INTEGER NOT NULL DEFAULT 0 CHECK(capture_attempts BETWEEN 0 AND 3),
 lease_token TEXT,lease_until INTEGER,next_attempt_at INTEGER NOT NULL DEFAULT 0,next_inspect_at INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE payment_observations (
 id TEXT PRIMARY KEY NOT NULL,attempt_id TEXT NOT NULL REFERENCES payment_attempts(id),
 source TEXT NOT NULL CHECK(source IN('CREATE','INSPECT','ERROR')),
 payload_json TEXT NOT NULL,observed_at INTEGER NOT NULL
) STRICT;
CREATE TABLE settlement_receipts (
 batch_id TEXT PRIMARY KEY NOT NULL REFERENCES batches(id),attempt_id TEXT NOT NULL UNIQUE REFERENCES payment_attempts(id),
 order_id TEXT NOT NULL UNIQUE,capture_id TEXT NOT NULL UNIQUE,total_minor INTEGER NOT NULL CHECK(total_minor>0),
 currency TEXT NOT NULL CHECK(currency='USD'),observation_id TEXT NOT NULL UNIQUE REFERENCES payment_observations(id),verified_at INTEGER NOT NULL
) STRICT;
CREATE TABLE settlement_commands (
 owner_id TEXT NOT NULL REFERENCES owners(id),key TEXT NOT NULL,batch_id TEXT NOT NULL REFERENCES batches(id),
 action TEXT NOT NULL CHECK(action IN('order','capture','cancel','resume','reconcile')),request_hash TEXT NOT NULL,applied INTEGER NOT NULL DEFAULT 0 CHECK(applied IN(0,1)),
 PRIMARY KEY(owner_id,key)
) STRICT;
CREATE TRIGGER batch_identity BEFORE UPDATE ON batches WHEN
 NEW.id!=OLD.id OR NEW.owner_id!=OLD.owner_id OR NEW.account_id!=OLD.account_id OR NEW.currency!=OLD.currency OR
 NEW.merchant_config_id!=OLD.merchant_config_id OR NEW.total_minor!=OLD.total_minor OR NEW.allocation_hash!=OLD.allocation_hash OR NEW.frozen_at!=OLD.frozen_at OR
 (OLD.state='SETTLED' AND (NEW.state!='SETTLED' OR NEW.cancel_latched!=OLD.cancel_latched))
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_BATCH'); END;
CREATE TRIGGER batch_no_delete BEFORE DELETE ON batches BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER allocation_terminal BEFORE UPDATE ON allocations WHEN OLD.state!='LOCKED' OR NEW.state!='SETTLED' OR
 NEW.id!=OLD.id OR NEW.batch_id!=OLD.batch_id OR NEW.charge_id!=OLD.charge_id OR NEW.amount_minor!=OLD.amount_minor OR NEW.created_at!=OLD.created_at
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ALLOCATION'); END;
CREATE TRIGGER allocation_no_delete BEFORE DELETE ON allocations BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER attempt_identity BEFORE UPDATE ON payment_attempts WHEN
 NEW.id!=OLD.id OR NEW.batch_id!=OLD.batch_id OR NEW.create_key!=OLD.create_key OR NEW.capture_key!=OLD.capture_key OR NEW.input_json!=OLD.input_json OR NEW.callback_hash!=OLD.callback_hash OR
 (OLD.order_id IS NOT NULL AND NEW.order_id IS NOT OLD.order_id) OR (OLD.create_started_at IS NOT NULL AND NEW.create_started_at IS NOT OLD.create_started_at) OR
 (OLD.capture_started_at IS NOT NULL AND NEW.capture_started_at IS NOT OLD.capture_started_at) OR NEW.callback_used<OLD.callback_used OR NEW.create_attempts<OLD.create_attempts OR NEW.capture_attempts<OLD.capture_attempts
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PAYMENT_INTENT'); END;
CREATE TRIGGER attempt_no_delete BEFORE DELETE ON payment_attempts BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER command_identity BEFORE UPDATE ON settlement_commands WHEN NEW.owner_id!=OLD.owner_id OR NEW.key!=OLD.key OR NEW.batch_id!=OLD.batch_id OR NEW.action!=OLD.action OR NEW.request_hash!=OLD.request_hash OR NEW.applied<OLD.applied BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COMMAND'); END;
CREATE TRIGGER command_no_delete BEFORE DELETE ON settlement_commands BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER charge_requires_evidence BEFORE INSERT ON charges WHEN NOT EXISTS(
 SELECT 1 FROM purchases p JOIN reservations r ON r.purchase_id=p.id
 JOIN deliveries d ON d.id=NEW.delivery_id AND d.purchase_id=p.id JOIN verifications v ON v.delivery_id=d.id AND v.result='PASS'
 JOIN ledger_events l ON l.id=NEW.ledger_event_id AND l.purchase_id=p.id AND l.reservation_id=r.id AND l.type='SERVICE_CHARGED'
 WHERE p.id=NEW.purchase_id AND p.status='EXECUTING' AND r.state='CONSUMED' AND p.account_id=NEW.account_id AND p.task_id=NEW.task_id
 AND r.amount_minor=NEW.amount_minor AND l.amount_minor=NEW.amount_minor AND l.account_id=NEW.account_id AND l.task_id=NEW.task_id AND l.currency=NEW.currency
) BEGIN SELECT RAISE(ABORT,'CHARGE_REQUIRES_VERIFIED_DELIVERY'); END;
CREATE TRIGGER allocation_requires_charge BEFORE INSERT ON allocations WHEN NOT EXISTS (
 SELECT 1 FROM charges c JOIN purchases p ON p.id=c.purchase_id JOIN verifications v ON v.delivery_id=c.delivery_id
 JOIN batches b ON b.id=NEW.batch_id JOIN accounts a ON a.id=c.account_id
 WHERE c.id=NEW.charge_id AND p.status='ACCEPTED' AND v.result='PASS' AND NEW.state='LOCKED' AND b.state='FROZEN'
 AND c.amount_minor=NEW.amount_minor AND c.account_id=b.account_id AND a.owner_id=b.owner_id AND c.currency=b.currency
 AND NOT EXISTS(SELECT 1 FROM ledger_events WHERE charge_id=c.id AND type='CHARGE_REVERSED')
) BEGIN SELECT RAISE(ABORT,'ALLOCATION_REQUIRES_ACCEPTED_CHARGE'); END;
`+['ledger_events','payment_observations','settlement_receipts'].map(table=>['UPDATE','DELETE'].map(operation=>
 `CREATE TRIGGER ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;`).join('\n')).join('\n');
