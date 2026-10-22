import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {canonical,hash} from '../domain/json.js';
import {type Claim,audit,ledger,release} from './lifecycle.js';
import {authorize,type Purchase} from './procurement.js';
import type {Reservation} from './reserve.js';
import {loadSnapshot} from './snapshots.js';
import type {ProviderResult} from '../providers/contracts.js';
import {verifyResult,type Verification} from '../providers/verify.js';

export function completeDelivery(db:Database.Database,job:Claim,result:ProviderResult,now=Date.now()):string{
 return db.transaction(()=>{
  const purchase=db.prepare('SELECT * FROM purchases WHERE id=?').get(job.purchase_id) as Purchase;
  const reservation=db.prepare('SELECT * FROM reservations WHERE purchase_id=?').get(purchase.id) as Reservation;
  const current=db.prepare("SELECT 1 FROM invocations WHERE id=? AND lease_token=? AND state='RUNNING' AND lease_until>?").get(job.id,job.lease_token,now);
  if(!current||purchase.status!=='EXECUTING'){
   audit(db,reservation,'SYSTEM','LATE_DELIVERY_IGNORED',now);return 'IGNORED';
  }
  const owner=db.prepare('SELECT owner_id FROM accounts WHERE id=?').get(purchase.account_id) as {owner_id:string};
  try{authorize(db,{ownerId:owner.owner_id,accountId:purchase.account_id,taskId:purchase.task_id},now);
   if(purchase.deadline_at<=now)throw new Error('PURCHASE_EXPIRED');
  }catch{release(db,purchase,'FAILED',now);return 'FAILED';}
  const snapshot=loadSnapshot(db,purchase.task_id);
  const verdict=verifyResult(purchase.capability_id,result,snapshot);
  const deliveryId=randomUUID();
  const serialized=canonical(result);
  const stored=Buffer.byteLength(serialized)>65536?{output:null,evidence:[]}:result;
  db.prepare('INSERT INTO deliveries VALUES(?,?,?,?,?,?,?)').run(deliveryId,purchase.id,job.id,job.delivery_attempt,canonical(stored),hash(stored),now);
  db.prepare('INSERT INTO verifications VALUES(?,?,?,?,?)').run(randomUUID(),deliveryId,verdict.pass?'PASS':'FAIL',JSON.stringify(verdict.reasons),now);
  if(verdict.pass)return accept(db,purchase,reservation,deliveryId,now);
  return rejectOrCorrect(db,purchase,reservation,job,verdict,now);
 }).immediate();
}
function accept(db:Database.Database,purchase:Purchase,reservation:Reservation,deliveryId:string,now:number):string{
 db.prepare("UPDATE reservations SET state='CONSUMED' WHERE id=? AND state='HELD'").run(reservation.id);
 db.prepare('UPDATE accounts SET reserved_minor=reserved_minor-?,outstanding_minor=outstanding_minor+?,version=version+1 WHERE id=?')
  .run(reservation.amount_minor,reservation.amount_minor,purchase.account_id);
 const event=ledger(db,reservation,'SERVICE_CHARGED',now);
 db.prepare("INSERT INTO charges VALUES(?,?,?,?,?,?,?,'USD')").run(randomUUID(),purchase.id,deliveryId,event,purchase.account_id,purchase.task_id,reservation.amount_minor);
 db.prepare("UPDATE purchases SET status='ACCEPTED' WHERE id=?").run(purchase.id);
 db.prepare("UPDATE invocations SET state='DONE',lease_until=NULL,lease_token=NULL WHERE id=?").run((db.prepare('SELECT id FROM invocations WHERE purchase_id=?').get(purchase.id) as {id:string}).id);
 audit(db,reservation,'SYSTEM','ACCEPTED',now);
 return 'ACCEPTED';
}
function rejectOrCorrect(db:Database.Database,purchase:Purchase,reservation:Reservation,job:Claim,verdict:Verification,now:number):string{
 const attempts=db.prepare('SELECT execution_attempts FROM invocations WHERE id=?').get(job.id) as {execution_attempts:number};
 if(job.delivery_attempt===1&&attempts.execution_attempts<2&&now+1000<purchase.deadline_at){
  db.prepare("UPDATE purchases SET status='CORRECTION_REQUIRED' WHERE id=?").run(purchase.id);
  db.prepare("UPDATE invocations SET state='READY',lease_until=NULL,lease_token=NULL,delivery_attempt=2 WHERE id=?").run(job.id);
  audit(db,reservation,'SYSTEM',`CORRECTION_REQUIRED:${verdict.reasons.join(',')}`,now);return 'CORRECTION_REQUIRED';
 }
 release(db,purchase,'REJECTED',now);return 'REJECTED';
}
