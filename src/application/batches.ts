import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {hash,text} from '../domain/json.js';
import {add,usd} from '../domain/money.js';

export interface BatchRequest {ownerId:string;accountId:string;key:string;chargeIds:readonly string[]}
export type BatchState='FROZEN'|'AWAITING_APPROVAL'|'CAPTURING'|'PAYMENT_PENDING'|'UNKNOWN'|'CANCELLED'|'ACTION_REQUIRED'|'SETTLED';
export interface Batch {id:string;owner_id:string;account_id:string;currency:'USD';merchant_config_id:string;total_minor:number;allocation_hash:string;state:BatchState;frozen_at:number;cancel_latched:0|1;version:number}
interface Charge {id:string;account_id:string;task_id:string;purchase_id:string;reservation_id:string;amount_minor:number}
interface Item {chargeId:string;amountMinor:number}
const allocationItems=(charges:Charge[]):Item[]=>charges.map(charge=>({chargeId:charge.id,amountMinor:charge.amount_minor}));

function selectCharges(db:Database.Database,request:BatchRequest,ids:string[]):Charge[]{
 return ids.map(id=>{
  const charge=db.prepare(`SELECT c.*,r.id reservation_id FROM charges c
   JOIN purchases p ON p.id=c.purchase_id JOIN reservations r ON r.purchase_id=p.id
   JOIN verifications v ON v.delivery_id=c.delivery_id
   WHERE c.id=? AND c.account_id=? AND c.currency='USD' AND p.status='ACCEPTED' AND v.result='PASS'
   AND NOT EXISTS(SELECT 1 FROM ledger_events WHERE charge_id=c.id AND type='CHARGE_REVERSED')
   AND r.state='CONSUMED' AND NOT EXISTS(SELECT 1 FROM allocations WHERE charge_id=c.id)`)
   .get(id,request.accountId) as Charge|undefined;
  if(!charge)throw new Error('CHARGE_NOT_ELIGIBLE');
  return charge;
 });
}
function allocate(db:Database.Database,batch:Batch,charge:Charge,now:number):void{
 const id=randomUUID();
 db.prepare("INSERT INTO allocations VALUES(?,?,?,?,'LOCKED',?)").run(id,batch.id,charge.id,charge.amount_minor,now);
 db.prepare(`INSERT INTO ledger_events(id,account_id,task_id,purchase_id,reservation_id,type,amount_minor,currency,dedupe_key,payload_hash,created_at,allocation_id)
 VALUES(?,?,?,?,?,'SETTLEMENT_ALLOCATED',?,'USD',?,?,?,?)`)
 .run(randomUUID(),charge.account_id,charge.task_id,charge.purchase_id,charge.reservation_id,charge.amount_minor,
  `SETTLEMENT_ALLOCATED:${charge.id}`,hash({batchId:batch.id,chargeId:charge.id,amountMinor:charge.amount_minor}),now,id);
}
/** Owner application service only. Receiver configuration is injected by trusted server code, never request data. */
export function freezeBatch(db:Database.Database,merchantConfigId:string,request:BatchRequest,now=Date.now()):Batch{
 text(merchantConfigId,128);text(request.key,128);text(request.ownerId,128);text(request.accountId,128);
 if(!Array.isArray(request.chargeIds)||!request.chargeIds.length||request.chargeIds.length>100)throw new Error('INVALID_CHARGE_SELECTION');
 const ids=request.chargeIds.map(id=>text(id,128)).sort();
 if(new Set(ids).size!==ids.length)throw new Error('DUPLICATE_CHARGE');
 const requestHash=hash({accountId:request.accountId,chargeIds:ids,merchantConfigId});
 return db.transaction(()=>{
  if(!db.prepare('SELECT 1 FROM accounts WHERE id=? AND owner_id=?').get(request.accountId,request.ownerId))throw new Error('ACCOUNT_FORBIDDEN');
  const replay=db.prepare('SELECT request_hash,batch_id FROM batch_requests WHERE owner_id=? AND key=?').get(request.ownerId,request.key) as {request_hash:string;batch_id:string}|undefined;
  if(replay){if(replay.request_hash!==requestHash)throw new Error('IDEMPOTENCY_CONFLICT');return db.prepare('SELECT * FROM batches WHERE id=?').get(replay.batch_id) as Batch;}
  return persistBatch(db,merchantConfigId,request,ids,requestHash,now);
 }).immediate();
}
function persistBatch(db:Database.Database,merchant:string,request:BatchRequest,ids:string[],requestHash:string,now:number):Batch{
 const charges=selectCharges(db,request,ids);
 const total=charges.reduce((sum,charge)=>add(sum,usd(charge.amount_minor)),usd(0)).minor;
 const batch:Batch={id:randomUUID(),owner_id:request.ownerId,account_id:request.accountId,currency:'USD',
  merchant_config_id:merchant,total_minor:total,allocation_hash:hash(allocationItems(charges)),state:'FROZEN',frozen_at:now,cancel_latched:0,version:0};
 db.prepare('INSERT INTO batches(id,owner_id,account_id,currency,merchant_config_id,total_minor,allocation_hash,state,frozen_at) VALUES(@id,@owner_id,@account_id,@currency,@merchant_config_id,@total_minor,@allocation_hash,@state,@frozen_at)').run(batch);
 for(const charge of charges)allocate(db,batch,charge,now);
 db.prepare('INSERT INTO batch_requests VALUES(?,?,?,?)').run(request.ownerId,request.key,requestHash,batch.id);
 db.prepare('INSERT INTO economic_audit(id,account_id,actor_id,action,created_at,batch_id) VALUES(?,?,?,?,?,?)')
  .run(randomUUID(),request.accountId,request.ownerId,'BATCH_FROZEN',now,batch.id);
 return batch;
}

export function reconcileBatches(db:Database.Database):void{
 const batches=db.prepare('SELECT * FROM batches').all() as Batch[];
 for(const batch of batches){
  const rows=db.prepare(`SELECT a.charge_id chargeId,a.amount_minor amountMinor,c.amount_minor chargeAmount,c.account_id accountId,
   l.amount_minor eventAmount,l.payload_hash payloadHash,l.purchase_id purchaseId,c.purchase_id chargePurchase,
   l.task_id taskId,c.task_id chargeTask,l.reservation_id reservationId,r.id chargeReservation,l.account_id eventAccount
   FROM allocations a JOIN charges c ON c.id=a.charge_id JOIN reservations r ON r.purchase_id=c.purchase_id
   LEFT JOIN ledger_events l ON l.allocation_id=a.id AND l.type='SETTLEMENT_ALLOCATED'
   WHERE a.batch_id=? ORDER BY a.charge_id`).all(batch.id) as (Item&{chargeAmount:number;accountId:string;eventAmount:number;payloadHash:string;purchaseId:string;chargePurchase:string;taskId:string;chargeTask:string;reservationId:string;chargeReservation:string;eventAccount:string})[];
  const items=rows.map(({chargeId,amountMinor})=>({chargeId,amountMinor}));
  const owner=db.prepare('SELECT owner_id FROM accounts WHERE id=?').get(batch.account_id) as {owner_id:string};
  if(!rows.length||owner.owner_id!==batch.owner_id||hash(items)!==batch.allocation_hash||rows.reduce((sum,row)=>add(usd(sum),usd(row.amountMinor)).minor,0)!==batch.total_minor||
   rows.some(row=>row.amountMinor!==row.chargeAmount||row.eventAmount!==row.amountMinor||row.accountId!==batch.account_id||row.eventAccount!==row.accountId||row.taskId!==row.chargeTask||row.purchaseId!==row.chargePurchase||row.reservationId!==row.chargeReservation||row.payloadHash!==hash({batchId:batch.id,chargeId:row.chargeId,amountMinor:row.amountMinor})))throw new Error('BATCH_RECONCILIATION_MISMATCH');
 }
 if(db.prepare(`SELECT 1 FROM ledger_events l LEFT JOIN allocations a ON a.id=l.allocation_id WHERE l.type='SETTLEMENT_ALLOCATED' AND a.id IS NULL LIMIT 1`).get())throw new Error('ORPHAN_ALLOCATION_EVENT');
}
