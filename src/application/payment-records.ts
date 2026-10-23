import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {hash,text} from '../domain/json.js';
import type {Batch} from './batches.js';
import type {PaymentInput,PaymentObservation} from '../payments/port.js';
export interface Attempt {
 id:string;batch_id:string;create_key:string;capture_key:string;input_json:string;callback_hash:string;callback_used:number;
 order_id:string|null;approval_url:string|null;create_started_at:number|null;capture_started_at:number|null;
 create_attempts:number;capture_attempts:number;lease_token:string|null;lease_until:number|null;next_attempt_at:number;next_inspect_at:number;
}
export interface Receipt {batch_id:string;attempt_id:string;order_id:string;capture_id:string;total_minor:number;currency:'USD';observation_id:string;verified_at:number}
export type PaymentAction='order'|'capture'|'cancel'|'resume'|'reconcile';
export function ownerBatch(db:Database.Database,owner:string,id:string):Batch{
 const batch=db.prepare('SELECT * FROM batches WHERE id=? AND owner_id=?').get(id,owner) as Batch|undefined;
 if(!batch)throw new Error('BATCH_FORBIDDEN');return batch;
}
export function attemptFor(db:Database.Database,id:string):Attempt|undefined{return db.prepare('SELECT * FROM payment_attempts WHERE batch_id=?').get(id) as Attempt|undefined;}
export function paymentAudit(db:Database.Database,batch:Batch,actor:string,action:string,now:number):void{
 db.prepare('INSERT INTO economic_audit(id,account_id,actor_id,action,created_at,batch_id) VALUES(?,?,?,?,?,?)').run(randomUUID(),batch.account_id,actor,action,now,batch.id);
}
export function batchState(db:Database.Database,batch:Batch,state:Batch['state'],now:number):void{
 const current=db.prepare('SELECT state,cancel_latched FROM batches WHERE id=?').get(batch.id) as Batch;
 if(current.state==='SETTLED')return;
 const next=current.cancel_latched?'CANCELLED':state;
 if(current.state!==next){db.prepare('UPDATE batches SET state=?,version=version+1 WHERE id=?').run(next,batch.id);paymentAudit(db,batch,'SYSTEM',next,now);}
}
export function ensureAttempt(db:Database.Database,batch:Batch,base:string):Attempt{
 const existing=attemptFor(db,batch.id);if(existing)return existing;
 const callback=randomUUID();const input:PaymentInput={batchId:batch.id,minor:batch.total_minor,currency:'USD',merchantId:batch.merchant_config_id,
  returnUrl:`${base}/payments/return?batch=${batch.id}&state=${callback}`,cancelUrl:`${base}/payments/cancel?batch=${batch.id}&state=${callback}`};
 db.prepare('INSERT INTO payment_attempts(id,batch_id,create_key,capture_key,input_json,callback_hash) VALUES(?,?,?,?,?,?)')
 .run(randomUUID(),batch.id,randomUUID(),randomUUID(),JSON.stringify(input),hash(callback));
 return attemptFor(db,batch.id)!;
}
export function command(db:Database.Database,owner:string,batchId:string,action:PaymentAction,key:string,expectedVersion?:number):boolean{
 text(key,128);const requestHash=hash({batchId,action,expectedVersion:expectedVersion??null});
 const prior=db.prepare('SELECT request_hash,applied FROM settlement_commands WHERE owner_id=? AND key=?').get(owner,key) as {request_hash:string;applied:number}|undefined;
 if(prior){if(prior.request_hash!==requestHash)throw new Error('IDEMPOTENCY_CONFLICT');return !!prior.applied;}
 const batch=ownerBatch(db,owner,batchId);
 if(expectedVersion!==undefined&&expectedVersion!==batch.version)throw new Error('VERSION_CONFLICT');
 db.prepare('INSERT INTO settlement_commands(owner_id,key,batch_id,action,request_hash) VALUES(?,?,?,?,?)').run(owner,key,batchId,action,requestHash);return false;
}
export function applied(db:Database.Database,owner:string,key:string):void{db.prepare('UPDATE settlement_commands SET applied=1 WHERE owner_id=? AND key=?').run(owner,key);}
export function observe(db:Database.Database,batch:Batch,attempt:Attempt,source:'CREATE'|'INSPECT'|'ERROR',payload:PaymentObservation|{error:string},now:number):string{
 return db.transaction(()=>{
  const id=randomUUID();db.prepare('INSERT INTO payment_observations VALUES(?,?,?,?,?)').run(id,attempt.id,source,JSON.stringify(payload),now);
  paymentAudit(db,batch,'SYSTEM',`PAYMENT_${source}`,now);return id;
 }).immediate();
}
export function matches(batch:Batch,observation:PaymentObservation,orderId?:string|null):void{
 if((orderId&&orderId!==observation.orderId)||observation.batchId!==batch.id||observation.invoiceId!==batch.id||observation.merchantId!==batch.merchant_config_id||observation.currency!=='USD'||observation.minor!==batch.total_minor||
 (observation.capture&&(observation.capture.currency!=='USD'||observation.capture.minor!==batch.total_minor)))throw new Error('PAYMENT_MISMATCH');
}
export interface PaymentView {
 batch:Batch;allocations:{id:string;charge_id:string;amount_minor:number;state:'LOCKED'|'SETTLED'}[];receipt:Receipt|null;
 payment:{orderId:string|null;approvalUrl:string|null;createAttempts:number;captureAttempts:number;nextAttemptAt:number}|null;
 latestObservation:{source:'CREATE'|'INSPECT'|'ERROR';payload_json:string;observed_at:number}|null;
}
export function paymentView(db:Database.Database,owner:string,id:string):PaymentView{
 const batch=ownerBatch(db,owner,id),attempt=attemptFor(db,id);
 const receipt=db.prepare('SELECT * FROM settlement_receipts WHERE batch_id=?').get(id) as Receipt|undefined;
 const allocations=db.prepare('SELECT id,charge_id,amount_minor,state FROM allocations WHERE batch_id=? ORDER BY charge_id').all(id) as PaymentView['allocations'];
 const latest=attempt?db.prepare('SELECT source,payload_json,observed_at FROM payment_observations WHERE attempt_id=? ORDER BY rowid DESC LIMIT 1').get(attempt.id) as PaymentView['latestObservation']:undefined;
 return {batch,allocations,receipt:receipt??null,payment:attempt?{orderId:attempt.order_id,approvalUrl:attempt.approval_url,createAttempts:attempt.create_attempts,captureAttempts:attempt.capture_attempts,nextAttemptAt:attempt.next_attempt_at}:null,latestObservation:latest??null};
}
