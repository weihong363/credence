import type Database from 'better-sqlite3';
import {paymentView} from './payment-records.js';
import type {BatchState} from './batches.js';
export interface AccountView {id:string;limitMinor:number;reservedMinor:number;outstandingMinor:number;availableMinor:number;perPurchaseMinor:number;status:string}
export interface ChargeView {id:string;accountId:string;taskId:string;purchaseId:string;amountMinor:number;eligible:number}
export interface BatchView {id:string;accountId:string;state:BatchState;version:number;totalMinor:number;cancelled:boolean;orderId:string|null;approvalUrl:string|null;observedStatus:string;observedAt:number|null;nextAttemptAt:number;allocations:{chargeId:string;amountMinor:number;state:string}[];receipt:{orderId:string;captureId:string;verifiedAt:number}|null}
export interface FinanceView {accounts:AccountView[];charges:ChargeView[];batches:BatchView[]}
function approval(value:string|null|undefined):string|null{
 if(!value)return null;
 try{const url=new URL(value);return url.origin==='https://www.sandbox.paypal.com'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
function batchView(db:Database.Database,ownerId:string,id:string):BatchView{
 const view=paymentView(db,ownerId,id),b=view.batch;
 const observation=view.latestObservation?.source==='INSPECT'?JSON.parse(view.latestObservation.payload_json) as {status?:string}:null;
 const status=observation?.status;
 return {id:b.id,accountId:b.account_id,state:b.state,version:b.version,totalMinor:b.total_minor,cancelled:!!b.cancel_latched,
  orderId:view.payment?.orderId??null,approvalUrl:approval(view.payment?.approvalUrl),
  observedStatus:status&&['CREATED','APPROVED','COMPLETED','PENDING','FAILED','UNKNOWN'].includes(status)?status:'UNVERIFIED',
  observedAt:view.latestObservation?.observed_at??null,nextAttemptAt:view.payment?.nextAttemptAt??0,
  allocations:view.allocations.map(a=>({chargeId:a.charge_id,amountMinor:a.amount_minor,state:a.state})),
  receipt:view.receipt?{orderId:view.receipt.order_id,captureId:view.receipt.capture_id,verifiedAt:view.receipt.verified_at}:null};
}
export function readFinance(db:Database.Database,ownerId:string):FinanceView{
 return db.transaction(()=>{
  const accounts=db.prepare(`SELECT id,limit_minor limitMinor,reserved_minor reservedMinor,outstanding_minor outstandingMinor,
   limit_minor-reserved_minor-outstanding_minor availableMinor,per_purchase_minor perPurchaseMinor,status FROM accounts WHERE owner_id=?`).all(ownerId) as AccountView[];
  const charges=db.prepare(`SELECT c.id,c.account_id accountId,c.task_id taskId,c.purchase_id purchaseId,c.amount_minor amountMinor,
   NOT EXISTS(SELECT 1 FROM allocations x WHERE x.charge_id=c.id) AND NOT EXISTS(SELECT 1 FROM ledger_events l WHERE l.charge_id=c.id AND l.type='CHARGE_REVERSED') eligible
   FROM charges c JOIN accounts a ON a.id=c.account_id WHERE a.owner_id=? ORDER BY c.rowid`).all(ownerId) as ChargeView[];
  const ids=db.prepare('SELECT id FROM batches WHERE owner_id=? ORDER BY frozen_at,id').all(ownerId) as {id:string}[];
  return {accounts,charges,batches:ids.map(({id})=>batchView(db,ownerId,id))};
 }).deferred();
}
