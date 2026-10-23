import {reconcilePayments} from './payment-integrity.js';
import {reconcileBatches} from './batches.js';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { hash } from '../domain/json.js';
import { type Purchase, type Context, authorize } from './procurement.js';
import type { Reservation } from './reserve.js';

export function audit(db: Database.Database, reservation: Reservation, actor: string, action: string, now: number): void {
  db.prepare('INSERT INTO economic_audit(id,account_id,reservation_id,actor_id,action,created_at) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(),reservation.account_id,reservation.id,actor,action,now);
}
export function ledger(db: Database.Database, reservation: Reservation, type: string, now: number): string {
  const id=randomUUID();
  db.prepare(`INSERT INTO ledger_events(id,account_id,task_id,purchase_id,reservation_id,type,amount_minor,currency,dedupe_key,payload_hash,created_at)
    VALUES(?,?,?,?,?,?,?,'USD',?,?,?)`).run(id,reservation.account_id,reservation.task_id,reservation.purchase_id,reservation.id,type,
    reservation.amount_minor,`${type}:${reservation.id}`,hash({type,reservationId:reservation.id,amount:reservation.amount_minor}),now);
  return id;
}
export function release(db: Database.Database, purchase: Purchase, status: 'CANCELLED'|'FAILED'|'REJECTED', now: number): void {
  const hold=db.prepare("SELECT * FROM reservations WHERE purchase_id=? AND state='HELD'").get(purchase.id) as Reservation|undefined;
  if (!hold) return;
  db.prepare("UPDATE reservations SET state='RELEASED' WHERE id=?").run(hold.id);
  db.prepare('UPDATE accounts SET reserved_minor=reserved_minor-?,version=version+1 WHERE id=?').run(hold.amount_minor,hold.account_id);
  db.prepare('UPDATE tasks SET spent_minor=spent_minor-? WHERE id=?').run(hold.amount_minor,hold.task_id);
  db.prepare('UPDATE purchases SET status=? WHERE id=?').run(status,purchase.id);
  db.prepare("UPDATE invocations SET state='DONE',lease_until=NULL,lease_token=NULL WHERE purchase_id=?").run(purchase.id);
  ledger(db,hold,'CREDIT_RELEASED',now);
  audit(db,hold,'SYSTEM',status,now);
}
export function cancelPurchase(db: Database.Database, context: Context, id: string, now=Date.now()): void {
  db.transaction(()=>{
    const owner=db.prepare('SELECT owner_id FROM accounts WHERE id=?').get(context.accountId) as {owner_id:string}|undefined;
    const purchase=db.prepare('SELECT * FROM purchases WHERE id=? AND task_id=? AND account_id=?').get(id,context.taskId,context.accountId) as Purchase|undefined;
    if(owner?.owner_id!==context.ownerId || !purchase) throw new Error('PURCHASE_FORBIDDEN');
    release(db,purchase,'CANCELLED',now);
  }).immediate();
}
export function recover(db: Database.Database, now=Date.now()): void {
  db.transaction(()=>{
    const unfinished=db.prepare("SELECT * FROM purchases WHERE status NOT IN('ACCEPTED','REJECTED','FAILED','CANCELLED')").all() as Purchase[];
    for(const purchase of unfinished){
      const owner=db.prepare('SELECT owner_id FROM accounts WHERE id=?').get(purchase.account_id) as {owner_id:string};
      try {authorize(db,{ownerId:owner.owner_id,accountId:purchase.account_id,taskId:purchase.task_id},now);}
      catch {release(db,purchase,'FAILED',now);continue;}
      if(purchase.deadline_at<=now) release(db,purchase,'FAILED',now);
      else db.prepare("UPDATE invocations SET state='READY',lease_token=NULL,lease_until=NULL WHERE purchase_id=? AND state='RUNNING' AND lease_until<=? AND execution_attempts<2").run(purchase.id,now);
      const exhausted=db.prepare("SELECT 1 FROM invocations WHERE purchase_id=? AND state='RUNNING' AND lease_until<=? AND execution_attempts>=2").get(purchase.id,now);
      if(exhausted) release(db,purchase,'FAILED',now);
    }
  }).immediate();
}
export interface Claim { id:string;purchase_id:string;lease_token:string;delivery_attempt:1|2 }
export function claim(db: Database.Database, now=Date.now(), taskId:string|null=null): Claim|undefined {
  recover(db,now);
  return db.transaction(()=>{
    const job=db.prepare("SELECT i.* FROM invocations i JOIN purchases p ON p.id=i.purchase_id WHERE i.state='READY' AND i.execution_attempts<2 AND (? IS NULL OR p.task_id=?) ORDER BY i.rowid LIMIT 1").get(taskId,taskId) as Claim|undefined;
    if(!job)return;
    const token=randomUUID();
    db.prepare("UPDATE invocations SET state='RUNNING',lease_until=?,lease_token=?,execution_attempts=execution_attempts+1 WHERE id=?").run(now+30_000,token,job.id);
    db.prepare("UPDATE purchases SET status='EXECUTING' WHERE id=?").run(job.purchase_id);
    const hold=db.prepare('SELECT * FROM reservations WHERE purchase_id=?').get(job.purchase_id) as Reservation;
    audit(db,hold,'SYSTEM','EXECUTING',now);
    return {...job,lease_token:token};
  }).immediate();
}
export function heartbeat(db: Database.Database, job: Claim, now=Date.now()): boolean {
  return !!db.prepare("UPDATE invocations SET lease_until=? WHERE id=? AND lease_token=? AND state='RUNNING' AND lease_until>?")
    .run(now+30_000,job.id,job.lease_token,now).changes;
}
export function reconcile(db: Database.Database): void {
 db.transaction(()=>{
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('FOREIGN_KEY_MISMATCH');
  if(db.prepare('SELECT 1 FROM reservations r LEFT JOIN purchases p ON p.id=r.purchase_id WHERE p.id IS NULL LIMIT 1').get())throw new Error('ORPHAN_RESERVATION');
  reconcileBatches(db);
  reconcilePayments(db);
  const accounts=db.prepare('SELECT id,reserved_minor,outstanding_minor FROM accounts').all() as {id:string;reserved_minor:number;outstanding_minor:number}[];
  for(const account of accounts){
    const totals=db.prepare(`SELECT COALESCE(sum(CASE type WHEN 'CREDIT_RESERVED' THEN amount_minor WHEN 'CREDIT_RELEASED' THEN -amount_minor WHEN 'SERVICE_CHARGED' THEN -amount_minor END),0) reserved,
      COALESCE(sum(CASE WHEN type='SERVICE_CHARGED' THEN amount_minor WHEN type IN('CHARGE_SETTLED','CHARGE_REVERSED') THEN -amount_minor ELSE 0 END),0) outstanding FROM ledger_events WHERE account_id=?`).get(account.id) as {reserved:number;outstanding:number};
    const held=db.prepare("SELECT COALESCE(sum(amount_minor),0) amount FROM reservations WHERE account_id=? AND state='HELD'").get(account.id) as {amount:number};
    const charged=db.prepare(`SELECT COALESCE(sum(c.amount_minor),0) amount FROM charges c WHERE c.account_id=? AND NOT EXISTS(SELECT 1 FROM ledger_events l WHERE l.charge_id=c.id AND l.type='CHARGE_REVERSED') AND NOT EXISTS(SELECT 1 FROM allocations a WHERE a.charge_id=c.id AND a.state='SETTLED')`).get(account.id) as {amount:number};
    if(totals.reserved!==account.reserved_minor || held.amount!==totals.reserved || totals.outstanding!==account.outstanding_minor || charged.amount!==totals.outstanding)throw new Error('RECONCILIATION_MISMATCH');
  }
  const tasks=db.prepare('SELECT id,spent_minor FROM tasks').all() as {id:string;spent_minor:number}[];
  for(const task of tasks){
    const spent=db.prepare("SELECT COALESCE(sum(CASE type WHEN 'CREDIT_RESERVED' THEN amount_minor WHEN 'CREDIT_RELEASED' THEN -amount_minor WHEN 'CHARGE_REVERSED' THEN -amount_minor ELSE 0 END),0) amount FROM ledger_events WHERE task_id=?").get(task.id) as {amount:number};
    if(spent.amount!==task.spent_minor)throw new Error('TASK_RECONCILIATION_MISMATCH');
  }
 }).deferred();
}
