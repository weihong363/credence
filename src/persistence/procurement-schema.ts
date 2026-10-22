export const procurementSchema = `
CREATE TABLE owners(id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL) STRICT;
CREATE TABLE agents(id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL REFERENCES owners(id),role TEXT NOT NULL CHECK(role IN ('BUYER','PROVIDER')),name TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN (0,1))) STRICT;
INSERT INTO owners SELECT DISTINCT owner_id,0 FROM accounts;
INSERT INTO agents SELECT buyer_id,owner_id,'BUYER','Existing buyer',1 FROM accounts GROUP BY buyer_id;
ALTER TABLE accounts ADD COLUMN allowlist_json TEXT;
ALTER TABLE tasks ADD COLUMN objective TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN input_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN result_json TEXT;
CREATE TABLE capabilities(id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),provider_id TEXT NOT NULL REFERENCES agents(id),price_minor INTEGER NOT NULL CHECK(price_minor BETWEEN 1 AND 1000000000),available INTEGER NOT NULL CHECK(available IN(0,1)),PRIMARY KEY(id,version)) STRICT;
CREATE TABLE snapshots(id TEXT PRIMARY KEY NOT NULL,task_id TEXT NOT NULL REFERENCES tasks(id),payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,created_at INTEGER NOT NULL) STRICT;
CREATE TABLE quotes(id TEXT PRIMARY KEY NOT NULL,task_id TEXT NOT NULL REFERENCES tasks(id),capability_id TEXT NOT NULL,version INTEGER NOT NULL,provider_id TEXT NOT NULL REFERENCES agents(id),amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),input_hash TEXT NOT NULL,acceptance_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,FOREIGN KEY(capability_id,version) REFERENCES capabilities(id,version)) STRICT;
CREATE TABLE purchases(id TEXT PRIMARY KEY NOT NULL,quote_id TEXT NOT NULL UNIQUE REFERENCES quotes(id),task_id TEXT NOT NULL REFERENCES tasks(id),account_id TEXT NOT NULL REFERENCES accounts(id),capability_id TEXT NOT NULL,version INTEGER NOT NULL,provider_id TEXT NOT NULL REFERENCES agents(id),input_hash TEXT NOT NULL,acceptance_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('RESERVED','EXECUTING','CORRECTION_REQUIRED','ACCEPTED','REJECTED','FAILED','CANCELLED')),deadline_at INTEGER NOT NULL,created_at INTEGER NOT NULL,UNIQUE(task_id,capability_id,version,input_hash,acceptance_hash)) STRICT;
CREATE TABLE purchase_requests(account_id TEXT NOT NULL REFERENCES accounts(id),key TEXT NOT NULL,request_hash TEXT NOT NULL,purchase_id TEXT NOT NULL REFERENCES purchases(id),PRIMARY KEY(account_id,key)) STRICT;
`;
