import {timingSafeEqual} from 'node:crypto';
import type Database from 'better-sqlite3';
import {hash} from '../domain/json.js';
import {attemptFor,ownerBatch,paymentAudit} from './payment-records.js';
export function paymentHint(db:Database.Database,batchId:string,state:string,orderId:string,kind:'return'|'cancel',now=Date.now()):void{
 db.transaction(()=>{
  const attempt=attemptFor(db,batchId);
  if(!attempt||!state||state.length>128||!timingSafeEqual(Buffer.from(hash(state)),Buffer.from(attempt.callback_hash))||attempt.order_id!==orderId)throw new Error('CALLBACK_FORBIDDEN');
  if(attempt.callback_used)return;
  const batch=db.prepare('SELECT owner_id FROM batches WHERE id=?').get(batchId) as {owner_id:string};
  const owned=ownerBatch(db,batch.owner_id,batchId);
  db.prepare('UPDATE payment_attempts SET callback_used=1,next_inspect_at=? WHERE id=?').run(now,attempt.id);
  if(kind==='cancel'&&owned.state!=='SETTLED')db.prepare("UPDATE batches SET cancel_latched=1,state='CANCELLED',version=version+1 WHERE id=?").run(batchId);
  paymentAudit(db,owned,'BUYER',`BUYER_${kind.toUpperCase()}_HINT`,now);
 }).immediate();
}
