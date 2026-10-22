export const runtimeGuards = `
CREATE TABLE model_calls(id TEXT PRIMARY KEY NOT NULL,task_id TEXT NOT NULL REFERENCES tasks(id),model TEXT NOT NULL,ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 8),created_at INTEGER NOT NULL,UNIQUE(task_id,ordinal)) STRICT;
CREATE TRIGGER model_calls_no_update BEFORE UPDATE ON model_calls BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER model_calls_no_delete BEFORE DELETE ON model_calls BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE UNIQUE INDEX one_snapshot_per_task ON snapshots(task_id);
ALTER TABLE tasks ADD COLUMN decision_repairs INTEGER NOT NULL DEFAULT 0 CHECK(decision_repairs IN(0,1));
ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','COMPLETED','ACTION_REQUIRED'));
CREATE TRIGGER task_input_frozen BEFORE UPDATE OF input_json ON tasks WHEN EXISTS(SELECT 1 FROM quotes WHERE task_id=OLD.id) BEGIN SELECT RAISE(ABORT,'FROZEN_TASK_INPUT'); END;
CREATE TRIGGER snapshot_before_quote BEFORE INSERT ON snapshots WHEN EXISTS(SELECT 1 FROM quotes WHERE task_id=NEW.task_id) BEGIN SELECT RAISE(ABORT,'FROZEN_TASK_INPUT'); END;
CREATE TRIGGER purchase_identity BEFORE UPDATE ON purchases WHEN NEW.id!=OLD.id OR NEW.quote_id!=OLD.quote_id OR NEW.task_id!=OLD.task_id OR NEW.account_id!=OLD.account_id OR NEW.capability_id!=OLD.capability_id OR NEW.version!=OLD.version OR NEW.provider_id!=OLD.provider_id OR NEW.input_hash!=OLD.input_hash OR NEW.acceptance_hash!=OLD.acceptance_hash OR NEW.deadline_at!=OLD.deadline_at BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PURCHASE'); END;
CREATE TRIGGER purchase_terminal BEFORE UPDATE OF status ON purchases WHEN OLD.status IN('ACCEPTED','REJECTED','FAILED','CANCELLED') AND NEW.status!=OLD.status BEGIN SELECT RAISE(ABORT,'TERMINAL_PURCHASE'); END;
CREATE TRIGGER charge_requires_evidence BEFORE INSERT ON charges WHEN NOT EXISTS(
 SELECT 1 FROM purchases p JOIN reservations r ON r.purchase_id=p.id
 JOIN deliveries d ON d.id=NEW.delivery_id AND d.purchase_id=p.id
 JOIN verifications v ON v.delivery_id=d.id AND v.result='PASS'
 JOIN ledger_events l ON l.id=NEW.ledger_event_id AND l.purchase_id=p.id AND l.reservation_id=r.id AND l.type='SERVICE_CHARGED'
 WHERE p.id=NEW.purchase_id AND p.status='EXECUTING' AND r.state='CONSUMED'
 AND p.account_id=NEW.account_id AND p.task_id=NEW.task_id AND r.amount_minor=NEW.amount_minor AND l.amount_minor=NEW.amount_minor
 AND l.account_id=NEW.account_id AND l.task_id=NEW.task_id AND l.currency=NEW.currency
) BEGIN SELECT RAISE(ABORT,'CHARGE_REQUIRES_VERIFIED_DELIVERY'); END;
`;
