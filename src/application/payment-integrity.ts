import type Database from 'better-sqlite3';
import {hash} from '../domain/json.js';
import type {Batch} from './batches.js';
import {matches,type Receipt} from './payment-records.js';
import {settlementLines} from './payment-finalization.js';
import type {PaymentObservation} from '../payments/port.js';
export function reconcilePayments(db:Database.Database):void{
 const receipts=db.prepare('SELECT * FROM settlement_receipts').all() as Receipt[];
 for(const receipt of receipts){
  const batch=db.prepare('SELECT * FROM batches WHERE id=?').get(receipt.batch_id) as Batch;
  const observation=db.prepare("SELECT payload_json,attempt_id FROM payment_observations WHERE id=? AND source='INSPECT'").get(receipt.observation_id) as {payload_json:string;attempt_id:string}|undefined;
  if(!observation||observation.attempt_id!==receipt.attempt_id)throw new Error('PAYMENT_RECONCILIATION_MISMATCH');
  const value=JSON.parse(observation.payload_json) as PaymentObservation;matches(batch,value,receipt.order_id);
  const attempt=db.prepare('SELECT order_id,batch_id FROM payment_attempts WHERE id=?').get(receipt.attempt_id) as {order_id:string;batch_id:string};
  if(batch.state!=='SETTLED'||receipt.total_minor!==batch.total_minor||receipt.currency!=='USD'||value.status!=='COMPLETED'||value.capture?.status!=='COMPLETED'||value.capture.id!==receipt.capture_id||value.orderStatus!=='COMPLETED'||attempt.order_id!==receipt.order_id||attempt.batch_id!==batch.id)throw new Error('PAYMENT_RECONCILIATION_MISMATCH');
  const confirmation=db.prepare("SELECT amount_minor,payload_hash,account_id FROM ledger_events WHERE batch_id=? AND type='PAYMENT_CONFIRMED'").get(batch.id) as {amount_minor:number;payload_hash:string;account_id:string}|undefined;
  if(!confirmation||confirmation.amount_minor!==batch.total_minor||confirmation.account_id!==batch.account_id||confirmation.payload_hash!==hash({batchId:batch.id,orderId:receipt.order_id,captureId:receipt.capture_id,observationId:receipt.observation_id,minor:batch.total_minor}))throw new Error('PAYMENT_RECONCILIATION_MISMATCH');
  for(const line of settlementLines(db,batch.id)){
   const event=db.prepare("SELECT * FROM ledger_events WHERE allocation_id=? AND type='CHARGE_SETTLED'").get(line.id) as {account_id:string;task_id:string;purchase_id:string;reservation_id:string;batch_id:string;amount_minor:number;payload_hash:string}|undefined;
   if((line as {state?:string}).state!=='SETTLED'||!event||event.account_id!==batch.account_id||event.task_id!==line.task_id||event.purchase_id!==line.purchase_id||event.reservation_id!==line.reservation_id||event.batch_id!==batch.id||event.amount_minor!==line.amount_minor||event.payload_hash!==hash({batchId:batch.id,allocationId:line.id,chargeId:line.charge_id,amountMinor:line.amount_minor}))throw new Error('PAYMENT_RECONCILIATION_MISMATCH');
  }
 }
 if(db.prepare(`SELECT 1 FROM allocations a LEFT JOIN settlement_receipts r ON r.batch_id=a.batch_id WHERE a.state='SETTLED' AND r.batch_id IS NULL
 UNION ALL SELECT 1 FROM batches b LEFT JOIN settlement_receipts r ON r.batch_id=b.id WHERE b.state='SETTLED' AND r.batch_id IS NULL
 UNION ALL SELECT 1 FROM ledger_events l LEFT JOIN settlement_receipts r ON r.batch_id=l.batch_id WHERE l.type IN('CHARGE_SETTLED','PAYMENT_CONFIRMED') AND r.batch_id IS NULL LIMIT 1`).get())throw new Error('ORPHAN_SETTLEMENT');
 const reversals=db.prepare(`SELECT l.*,c.account_id charge_account,c.task_id charge_task,c.purchase_id charge_purchase,c.amount_minor charge_amount,r.id charge_reservation
 FROM ledger_events l JOIN charges c ON c.id=l.charge_id JOIN reservations r ON r.purchase_id=c.purchase_id WHERE l.type='CHARGE_REVERSED'`).all() as {charge_id:string;account_id:string;task_id:string;purchase_id:string;reservation_id:string;amount_minor:number;charge_account:string;charge_task:string;charge_purchase:string;charge_amount:number;charge_reservation:string}[];
 for(const row of reversals)if(row.account_id!==row.charge_account||row.task_id!==row.charge_task||row.purchase_id!==row.charge_purchase||row.reservation_id!==row.charge_reservation||row.amount_minor!==row.charge_amount||db.prepare('SELECT 1 FROM allocations WHERE charge_id=?').get(row.charge_id))throw new Error('REVERSAL_RECONCILIATION_MISMATCH');
}
