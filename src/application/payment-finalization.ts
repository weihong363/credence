import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {hash,text} from '../domain/json.js';
import {reconcileBatches,type Batch} from './batches.js';
import {matches,paymentAudit,type Attempt,type Receipt} from './payment-records.js';
import type {PaymentObservation} from '../payments/port.js';
export interface SettlementLine {id:string;charge_id:string;amount_minor:number;purchase_id:string;task_id:string;reservation_id:string}
export function settlementLines(db:Database.Database,batchId:string):SettlementLine[]{
 return db.prepare(`SELECT a.*,c.purchase_id,c.task_id,r.id reservation_id FROM allocations a JOIN charges c ON c.id=a.charge_id
  JOIN reservations r ON r.purchase_id=c.purchase_id WHERE a.batch_id=? ORDER BY a.charge_id`).all(batchId) as SettlementLine[];
}
function event(db:Database.Database,batch:Batch,line:SettlementLine,type:'PAYMENT_CONFIRMED'|'CHARGE_SETTLED',payload:unknown,now:number):void{
 const confirmed=type==='PAYMENT_CONFIRMED';
 db.prepare(`INSERT INTO ledger_events(id,account_id,task_id,purchase_id,reservation_id,type,amount_minor,currency,dedupe_key,payload_hash,created_at,allocation_id,batch_id)
 VALUES(?,?,?,?,?,?,?,'USD',?,?,?,?,?)`).run(randomUUID(),batch.account_id,line.task_id,line.purchase_id,line.reservation_id,type,
 confirmed?batch.total_minor:line.amount_minor,`${type}:${confirmed?batch.id:line.id}`,hash(payload),now,confirmed?null:line.id,batch.id);
}
export function finalize(db:Database.Database,batch:Batch,attempt:Attempt,observationId:string,now:number):void{
 db.transaction(()=>{
  const stored=db.prepare("SELECT payload_json FROM payment_observations WHERE id=? AND attempt_id=? AND source='INSPECT'").get(observationId,attempt.id) as {payload_json:string}|undefined;
  if(!stored)throw new Error('INDEPENDENT_VERIFICATION_REQUIRED');
  const observation=JSON.parse(stored.payload_json) as PaymentObservation;matches(batch,observation,attempt.order_id);
  if(observation.status!=='COMPLETED'||observation.capture?.status!=='COMPLETED'||observation.orderStatus!=='COMPLETED')throw new Error('PAYMENT_NOT_COMPLETED');
  const prior=db.prepare('SELECT * FROM settlement_receipts WHERE batch_id=?').get(batch.id) as Receipt|undefined;
  if(prior){if(prior.order_id!==observation.orderId||prior.capture_id!==observation.capture.id)throw new Error('PAYMENT_MISMATCH');return;}
  reconcileBatches(db);
  const lines=settlementLines(db,batch.id);
  if(!lines.length||lines.some(line=>(line as SettlementLine&{state:string}).state!=='LOCKED')||lines.reduce((sum,line)=>sum+line.amount_minor,0)!==batch.total_minor)throw new Error('ALLOCATION_MISMATCH');
  db.prepare('INSERT INTO settlement_receipts VALUES(?,?,?,?,?,?,?,?)').run(batch.id,attempt.id,observation.orderId,observation.capture.id,batch.total_minor,'USD',observationId,now);
  event(db,batch,lines[0],'PAYMENT_CONFIRMED',{batchId:batch.id,orderId:observation.orderId,captureId:observation.capture.id,observationId,minor:batch.total_minor},now);
  for(const line of lines){
   event(db,batch,line,'CHARGE_SETTLED',{batchId:batch.id,allocationId:line.id,chargeId:line.charge_id,amountMinor:line.amount_minor},now);
   db.prepare("UPDATE allocations SET state='SETTLED' WHERE id=? AND state='LOCKED'").run(line.id);
  }
  const updated=db.prepare('UPDATE accounts SET outstanding_minor=outstanding_minor-?,version=version+1 WHERE id=? AND outstanding_minor>=?').run(batch.total_minor,batch.account_id,batch.total_minor);
  if(updated.changes!==1)throw new Error('ACCOUNT_RECONCILIATION_MISMATCH');
  db.prepare("UPDATE batches SET state='SETTLED',version=version+1 WHERE id=?").run(batch.id);
  paymentAudit(db,batch,'SYSTEM','PAYMENT_SETTLED',now);
 }).immediate();
}
export function reverseCharge(db:Database.Database,owner:string,chargeId:string,reason:string,now=Date.now()):void{
 text(reason,500);
 db.transaction(()=>{
  const row=db.prepare(`SELECT c.*,r.id reservation_id FROM charges c JOIN accounts a ON a.id=c.account_id JOIN reservations r ON r.purchase_id=c.purchase_id WHERE c.id=? AND a.owner_id=?`).get(chargeId,owner) as (SettlementLine&{account_id:string})|undefined;
  if(!row)throw new Error('CHARGE_FORBIDDEN');
  const payloadHash=hash({chargeId,reason});
  const prior=db.prepare("SELECT payload_hash FROM ledger_events WHERE charge_id=? AND type='CHARGE_REVERSED'").get(chargeId) as {payload_hash:string}|undefined;
  if(prior){if(prior.payload_hash!==payloadHash)throw new Error('REVERSAL_CONFLICT');return;}
  if(db.prepare('SELECT 1 FROM allocations WHERE charge_id=?').get(chargeId))throw new Error('ALLOCATED_CHARGE_LOCKED');
  db.prepare(`INSERT INTO ledger_events(id,account_id,task_id,purchase_id,reservation_id,type,amount_minor,currency,dedupe_key,payload_hash,created_at,charge_id)
   VALUES(?,?,?,?,?,'CHARGE_REVERSED',?,'USD',?,?,?,?)`).run(randomUUID(),row.account_id,row.task_id,row.purchase_id,row.reservation_id,row.amount_minor,`CHARGE_REVERSED:${chargeId}`,payloadHash,now,chargeId);
  const updated=db.prepare('UPDATE accounts SET outstanding_minor=outstanding_minor-?,version=version+1 WHERE id=?').run(row.amount_minor,row.account_id);
  db.prepare('UPDATE tasks SET spent_minor=spent_minor-? WHERE id=?').run(row.amount_minor,row.task_id);
  db.prepare('INSERT INTO economic_audit(id,account_id,actor_id,action,created_at) VALUES(?,?,?,?,?)').run(randomUUID(),row.account_id,owner,`CHARGE_REVERSED:${reason}`,now);
 }).immediate();
}
