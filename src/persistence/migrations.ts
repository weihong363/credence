import { planningSchema } from './planning-schema.js';
import { runtimeGuards } from './runtime-guards.js';
import { lifecycleSchema, immutableSchema } from './lifecycle-schema.js';
import { procurementSchema } from './procurement-schema.js';
// P1.1 foundations only; full procurement entities arrive in subsequent migrations.
export const migrations = [{ version: 1, sql: `
CREATE TABLE accounts (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, buyer_id TEXT NOT NULL,
 currency TEXT NOT NULL CHECK(currency='USD'),
 limit_minor INTEGER NOT NULL CHECK(limit_minor BETWEEN 0 AND 1000000000),
 per_purchase_minor INTEGER NOT NULL CHECK(per_purchase_minor BETWEEN 0 AND limit_minor),
 reserved_minor INTEGER NOT NULL DEFAULT 0 CHECK(reserved_minor>=0),
 outstanding_minor INTEGER NOT NULL DEFAULT 0 CHECK(outstanding_minor>=0),
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','SUSPENDED','REVOKED')),
 expires_at INTEGER, version INTEGER NOT NULL DEFAULT 0,
 CHECK(reserved_minor+outstanding_minor<=limit_minor)
) STRICT;
CREATE TABLE tasks (
 id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id),
 budget_minor INTEGER NOT NULL CHECK(budget_minor BETWEEN 0 AND 1000000000),
 spent_minor INTEGER NOT NULL DEFAULT 0 CHECK(spent_minor BETWEEN 0 AND budget_minor),
 deadline_at INTEGER NOT NULL,
 UNIQUE(id,account_id)
) STRICT;
CREATE TABLE reservations (
 id TEXT PRIMARY KEY NOT NULL, purchase_id TEXT NOT NULL UNIQUE,
 account_id TEXT NOT NULL REFERENCES accounts(id), task_id TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),
 state TEXT NOT NULL CHECK(state='HELD'), expires_at INTEGER NOT NULL,
 FOREIGN KEY(task_id,account_id) REFERENCES tasks(id,account_id)
) STRICT;
CREATE TABLE ledger_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 account_id TEXT NOT NULL REFERENCES accounts(id), task_id TEXT NOT NULL,
 purchase_id TEXT NOT NULL UNIQUE, reservation_id TEXT NOT NULL UNIQUE REFERENCES reservations(id),
 type TEXT NOT NULL CHECK(type='CREDIT_RESERVED'),
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),
 currency TEXT NOT NULL CHECK(currency='USD'), dedupe_key TEXT NOT NULL,
 payload_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(account_id,dedupe_key),
 FOREIGN KEY(task_id,account_id) REFERENCES tasks(id,account_id)
) STRICT;
CREATE TABLE economic_audit (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 account_id TEXT NOT NULL REFERENCES accounts(id), reservation_id TEXT NOT NULL UNIQUE REFERENCES reservations(id),
 actor_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action='CREDIT_RESERVED'), created_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON economic_audit BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON economic_audit BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
` }, {version: 2, sql: procurementSchema}, {version: 3, sql: lifecycleSchema + immutableSchema}, {version: 4, sql: runtimeGuards}, {version: 5, sql: planningSchema}];
