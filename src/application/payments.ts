import {reconcile} from './lifecycle.js';
import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {PaymentError,type PaymentPort,type PaymentInput,type PaymentObservation} from '../payments/port.js';
import type {Batch} from './batches.js';
import {finalize} from './payment-finalization.js';
import {applied,attemptFor,batchState,command,ensureAttempt,matches,observe,ownerBatch,paymentAudit,paymentView,type Attempt,type PaymentAction,type PaymentView} from './payment-records.js';
const WINDOW=5*3600000,LEASE=180000;
export class Payments {
 constructor(private db:Database.Database,private port:PaymentPort,private merchant:string,private base:string,private clock:()=>number=Date.now){}
 view(owner:string,id:string):PaymentView{return paymentView(this.db,owner,id);}
 async run(owner:string,id:string,action:PaymentAction,key:string,expectedVersion?:number):Promise<PaymentView>{
  reconcile(this.db);
  const batch=ownerBatch(this.db,owner,id);
  if(batch.merchant_config_id!==this.merchant)throw new Error('MERCHANT_CONFIGURATION_CHANGED');
  const replay=this.db.transaction(()=>command(this.db,owner,id,action,key,expectedVersion)).immediate();
  if(action==='cancel'){this.cancel(batch,owner,key,replay);return this.view(owner,id);}
  if(action==='resume'&&replay)return this.view(owner,id);
  if(batch.state==='SETTLED'&&action!=='reconcile')return this.view(owner,id);
  if(action==='order'&&batch.cancel_latched)return this.view(owner,id);
  const attempt=this.db.transaction(()=>action==='order'?ensureAttempt(this.db,batch,this.base):attemptFor(this.db,id)).immediate();
  if(!attempt){if(action==='reconcile')return this.view(owner,id);throw new Error('ORDER_REQUIRED');}
  const token=this.lease(attempt);
  const heartbeat=setInterval(()=>this.db.prepare('UPDATE payment_attempts SET lease_until=? WHERE id=? AND lease_token=?').run(this.clock()+LEASE,attempt.id,token),15000);
  heartbeat.unref();
  try{await this.execute(batch,attempt,action,owner,key,token);}
  catch(error){this.failure(batch,attempt,error);}
  finally{clearInterval(heartbeat);this.db.prepare('UPDATE payment_attempts SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?').run(attempt.id,token);}
  return this.view(owner,id);
 }
 private lease(attempt:Attempt):string{
  const token=randomUUID();
  const changed=this.db.prepare('UPDATE payment_attempts SET lease_token=?,lease_until=? WHERE id=? AND (lease_until IS NULL OR lease_until<=?)').run(token,this.clock()+LEASE,attempt.id,this.clock()).changes;
  if(!changed)throw new Error('PAYMENT_IN_PROGRESS');return token;
 }
 private cancel(batch:Batch,owner:string,key:string,replay:boolean):void{
  if(replay||batch.state==='SETTLED')return;
  this.db.transaction(()=>{
   const recorded=this.db.prepare('SELECT applied FROM settlement_commands WHERE owner_id=? AND key=?').get(owner,key) as {applied:number};
   if(recorded.applied)return;
   this.db.prepare("UPDATE batches SET cancel_latched=1,state='CANCELLED',version=version+1 WHERE id=? AND state!='SETTLED'").run(batch.id);
   paymentAudit(this.db,batch,owner,'OWNER_CANCELLED',this.clock());applied(this.db,owner,key);
  }).immediate();
 }
 private intent(batch:Batch,attempt:Attempt,kind:'create'|'capture',token:string):void{
  this.db.transaction(()=>{
   const current=attemptFor(this.db,batch.id)!;const b=ownerBatch(this.db,batch.owner_id,batch.id);
   if(current.lease_token!==token||current.lease_until!<=this.clock())throw new Error('PAYMENT_LEASE_LOST');
   if(b.cancel_latched)throw new Error('CANCELLED');
   if(current.next_attempt_at>this.clock())throw new PaymentError('RETRY_LATER',current.next_attempt_at-this.clock());
   const started=kind==='create'?current.create_started_at:current.capture_started_at;
   const count=kind==='create'?current.create_attempts:current.capture_attempts;
   if((started!==null&&this.clock()-started>=WINDOW)||count>=3)throw new Error('PAYMENT_RETRY_EXHAUSTED');
   this.db.prepare(`UPDATE payment_attempts SET ${kind}_started_at=COALESCE(${kind}_started_at,?),${kind}_attempts=${kind}_attempts+1 WHERE id=?`).run(this.clock(),attempt.id);
   batchState(this.db,batch,kind==='capture'?'CAPTURING':'UNKNOWN',this.clock());
   paymentAudit(this.db,batch,batch.owner_id,`${kind.toUpperCase()}_INTENT`,this.clock());
  }).immediate();
 }
 private async execute(batch:Batch,attempt:Attempt,action:PaymentAction,owner:string,key:string,token:string):Promise<void>{
  if(!attempt.order_id&&action==='order'){
   this.intent(batch,attempt,'create',token);
   const result=await this.port.create(JSON.parse(attempt.input_json) as PaymentInput,attempt.create_key);
   this.db.transaction(()=>{
    this.db.prepare('UPDATE payment_attempts SET order_id=?,approval_url=? WHERE id=? AND order_id IS NULL').run(result.orderId,result.approvalUrl??null,attempt.id);
    paymentAudit(this.db,batch,'SYSTEM','ORDER_ASSOCIATED',this.clock());
   }).immediate();
   observe(this.db,batch,attempt,'CREATE',result,this.clock());matches(batch,result);
   attempt=attemptFor(this.db,batch.id)!;
  }
  if(!attempt.order_id)return;
  let result=await this.inspect(batch,attempt);
  if(result.status==='COMPLETED')return;
  if(action==='resume'){this.resume(batch,owner,key,result);return;}
  if(action==='capture'&&result.status==='APPROVED'){
   if(ownerBatch(this.db,owner,batch.id).cancel_latched)return;
   this.intent(batch,attempt,'capture',token);
   await this.port.capture(attempt.order_id,attempt.capture_key);
   result=await this.inspect(batch,attempt);
  }
  this.db.transaction(()=>batchState(this.db,batch,result.status==='FAILED'?'ACTION_REQUIRED':result.status==='PENDING'?'PAYMENT_PENDING':result.status==='UNKNOWN'?'UNKNOWN':'AWAITING_APPROVAL',this.clock())).immediate();
 }
 private async inspect(batch:Batch,attempt:Attempt):Promise<PaymentObservation>{
  const result=await this.port.inspect(attempt.order_id!);
  const observationId=observe(this.db,batch,attempt,'INSPECT',result,this.clock());matches(batch,result,attempt.order_id);
  if(result.status==='COMPLETED')finalize(this.db,batch,attempt,observationId,this.clock());
  this.db.prepare('UPDATE payment_attempts SET next_inspect_at=? WHERE id=?').run(this.clock()+30000,attempt.id);
  return result;
 }
 private resume(batch:Batch,owner:string,key:string,result:PaymentObservation):void{
  if(result.status!=='APPROVED')throw new Error('APPROVAL_REQUIRED');
  this.db.transaction(()=>{
   const current=ownerBatch(this.db,owner,batch.id);
   if(current.version!==batch.version)throw new Error('CANCELLATION_CHANGED');
   this.db.prepare("UPDATE batches SET cancel_latched=0,state='AWAITING_APPROVAL',version=version+1 WHERE id=?").run(batch.id);
   paymentAudit(this.db,batch,owner,'OWNER_RESUMED',this.clock());applied(this.db,owner,key);
  }).immediate();
 }
 private failure(batch:Batch,attempt:Attempt,error:unknown):void{
  const code=error instanceof PaymentError?error.code:error instanceof Error&&['PAYMENT_MISMATCH','PAYMENT_RETRY_EXHAUSTED','APPROVAL_REQUIRED','CANCELLATION_CHANGED','CANCELLED','PAYMENT_LEASE_LOST'].includes(error.message)?error.message:'UNAVAILABLE';
  this.db.transaction(()=>{
   const now=this.clock();observe(this.db,batch,attempt,'ERROR',{error:code},now);
   const delay=error instanceof PaymentError&&error.retryAfterMs?error.retryAfterMs:30000;
   this.db.prepare('UPDATE payment_attempts SET next_attempt_at=?,next_inspect_at=? WHERE id=?').run(now+delay,now+30000,attempt.id);
   batchState(this.db,batch,['DECLINED','INVALID_RESPONSE','PAYMENT_MISMATCH','PAYMENT_RETRY_EXHAUSTED'].includes(code)?'ACTION_REQUIRED':'UNKNOWN',now);
  }).immediate();
 }
 async recover():Promise<void>{
  const due=this.db.prepare(`SELECT b.id,b.owner_id FROM batches b JOIN payment_attempts p ON p.batch_id=b.id
   WHERE p.order_id IS NOT NULL AND b.state!='SETTLED' AND p.next_inspect_at<=? AND (p.lease_until IS NULL OR p.lease_until<=?)`).all(this.clock(),this.clock()) as {id:string;owner_id:string}[];
  for(const batch of due){try{await this.run(batch.owner_id,batch.id,'reconcile',`recover:${batch.id}:${this.clock()}`);}catch{/* Another owner process may have acquired the lease. */}}
 }
}
