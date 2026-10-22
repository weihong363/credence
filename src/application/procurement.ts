import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { hash } from '../domain/json.js';
import { acceptanceVersion } from '../registry/catalog.js';
import { reserve } from './reserve.js';

export interface Context { ownerId: string; accountId: string; taskId: string }
interface Task { task_status:string; deadline_at: number; input_json: string; owner_id: string; status: string; expires_at: number | null; allowlist_json: string | null }
export interface Quote { id: string; task_id: string; capability_id: string; version: number; provider_id: string; amount_minor: number; input_hash: string; acceptance_hash: string; expires_at: number }
export interface Purchase { id: string; task_id: string; account_id: string; capability_id: string; version: number; provider_id: string; status: string; deadline_at: number }

export function authorize(db: Database.Database, context: Context, now: number): Task {
  const task = db.prepare(`SELECT t.status task_status,t.deadline_at,t.input_json,a.owner_id,a.status,a.expires_at,a.allowlist_json
    FROM tasks t JOIN accounts a ON a.id=t.account_id JOIN owners o ON o.id=a.owner_id JOIN agents g ON g.id=a.buyer_id AND g.owner_id=o.id AND g.role='BUYER' AND g.active=1 WHERE t.id=? AND a.id=?`).get(context.taskId, context.accountId) as Task | undefined;
  if (!task || task.owner_id !== context.ownerId) throw new Error('TASK_FORBIDDEN');
  if (task.status !== 'OPEN' || (task.expires_at !== null && task.expires_at <= now)) throw new Error('ACCOUNT_INACTIVE');
  if (task.deadline_at <= now || task.task_status!=='OPEN') throw new Error('TASK_EXPIRED');
  return task;
}

export function listCapabilities(db: Database.Database, context: Context, now = Date.now()): unknown[] {
  const task = authorize(db, context, now);
  const allowed = task.allowlist_json === null ? null : JSON.parse(task.allowlist_json) as string[];
  return db.prepare('SELECT id,version,price_minor FROM capabilities WHERE available=1').all()
    .filter(row => allowed === null || allowed.includes((row as {id:string}).id));
}

export function requestQuote(db: Database.Database, context: Context, capabilityId: string, version: number, now = Date.now()): Quote {
  return db.transaction(() => {
    const task = authorize(db, context, now);
    const capability = db.prepare('SELECT provider_id,price_minor FROM capabilities WHERE id=? AND version=? AND available=1')
      .get(capabilityId, version) as {provider_id:string;price_minor:number} | undefined;
    if (!capability) throw new Error('CAPABILITY_UNAVAILABLE');
    if (task.allowlist_json !== null && !JSON.parse(task.allowlist_json).includes(capabilityId)) throw new Error('CAPABILITY_DENIED');
    if (!db.prepare('SELECT 1 FROM snapshots WHERE task_id=?').get(context.taskId)) throw new Error('SNAPSHOT_REQUIRED');
    const quote: Quote = {id:randomUUID(),task_id:context.taskId,capability_id:capabilityId,version,
      provider_id:capability.provider_id,amount_minor:capability.price_minor,input_hash:hash(JSON.parse(task.input_json)),
      acceptance_hash:hash({capabilityId,version,verification:acceptanceVersion}),expires_at:now+120_000};
    db.prepare(`INSERT INTO quotes(id,task_id,capability_id,version,provider_id,amount_minor,input_hash,acceptance_hash,expires_at,created_at)
      VALUES(@id,@task_id,@capability_id,@version,@provider_id,@amount_minor,@input_hash,@acceptance_hash,@expires_at,@created_at)`).run({...quote,created_at:now});
    return quote;
  }).immediate();
}

export function proposePurchase(db: Database.Database, context: Context, quoteId: string, key: string, now = Date.now()): Purchase {
  return db.transaction(() => {
    const owner = db.prepare('SELECT owner_id FROM accounts WHERE id=?').get(context.accountId) as {owner_id:string} | undefined;
    if (owner?.owner_id !== context.ownerId) throw new Error('ACCOUNT_FORBIDDEN');
    const digest = hash({context,quoteId});
    const prior = db.prepare('SELECT request_hash,purchase_id FROM purchase_requests WHERE account_id=? AND key=?')
      .get(context.accountId,key) as {request_hash:string;purchase_id:string} | undefined;
    if (prior) {
      if (prior.request_hash !== digest) throw new Error('IDEMPOTENCY_CONFLICT');
      return db.prepare('SELECT * FROM purchases WHERE id=?').get(prior.purchase_id) as Purchase;
    }
    const task = authorize(db, context, now);
    if ((db.prepare('SELECT count(*) n FROM purchases WHERE task_id=?').get(context.taskId) as {n:number}).n>=5) throw new Error('PROPOSAL_LIMIT');
    const quote = db.prepare('SELECT * FROM quotes WHERE id=? AND task_id=?').get(quoteId, context.taskId) as Quote | undefined;
    if (!quote || quote.expires_at <= now) throw new Error('QUOTE_EXPIRED');
    validateQuote(task,quote);
    const id = randomUUID();
    db.prepare(`INSERT INTO purchases VALUES(?,?,?,?,?,?,?,?,?,'RESERVED',?,?)`).run(id,quoteId,context.taskId,context.accountId,
      quote.capability_id,quote.version,quote.provider_id,quote.input_hash,quote.acceptance_hash,Math.min(task.deadline_at,now+90_000),now);
    reserve(db,{...context,purchaseId:id,key,amountMinor:quote.amount_minor},()=>now);
    db.prepare('INSERT INTO purchase_requests VALUES(?,?,?,?)').run(context.accountId,key,digest,id);
    db.prepare("INSERT INTO invocations(id,purchase_id,state) VALUES(?,?,'READY')").run(randomUUID(),id);
    return db.prepare('SELECT * FROM purchases WHERE id=?').get(id) as Purchase;
  }).immediate();
}

function validateQuote(task: Task, quote: Quote): void {
  if (quote.input_hash !== hash(JSON.parse(task.input_json)) || quote.acceptance_hash !== hash({capabilityId:quote.capability_id,version:quote.version,verification:acceptanceVersion})) throw new Error('QUOTE_MISMATCH');
  if (task.allowlist_json !== null && !JSON.parse(task.allowlist_json).includes(quote.capability_id)) throw new Error('CAPABILITY_DENIED');
}
