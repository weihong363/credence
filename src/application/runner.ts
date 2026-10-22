import type Database from 'better-sqlite3';
import {claim,heartbeat,release,audit,type Claim} from './lifecycle.js';
import type {Reservation} from './reserve.js';
import type {Purchase} from './procurement.js';
import {completeDelivery} from './deliveries.js';
import {loadSnapshot} from './snapshots.js';
import type {Snapshot} from '../providers/source.js';
import {inventory,type ProviderResult} from '../providers/contracts.js';
import {analyze} from '../providers/analysis.js';
import type {JsonModel} from '../llm/client.js';
export type Provider=(purchase:Purchase,snapshot:Snapshot,signal:AbortSignal,correction:string[])=>Promise<ProviderResult>;
export function providers(model:JsonModel):Provider{
 return async(purchase,snapshot,signal,correction)=>{
  if(purchase.capability_id==='repo.inventory')return inventory(snapshot);
  if(!['repo.architecture','repo.risk-review'].includes(purchase.capability_id))throw new Error('UNKNOWN_PROVIDER');
  return analyze(model,purchase.capability_id,snapshot,signal,correction);
 };
}
export async function runNext(db:Database.Database,provider:Provider,clock:()=>number=Date.now,timeoutMs=60000,taskId:string|null=null):Promise<string|undefined>{
 const job=claim(db,clock(),taskId);if(!job)return;
 const purchase=db.prepare('SELECT * FROM purchases WHERE id=?').get(job.purchase_id) as Purchase;
 const prior=db.prepare('SELECT reasons_json FROM verifications v JOIN deliveries d ON d.id=v.delivery_id WHERE d.purchase_id=? ORDER BY d.attempt DESC LIMIT 1').get(purchase.id) as {reasons_json:string}|undefined;
 const abort=new AbortController();const duration=Math.max(1,Math.min(timeoutMs,purchase.deadline_at-clock()));
 let timer:ReturnType<typeof setTimeout>|undefined;
 const pulse=setInterval(()=>{if(!heartbeat(db,job,clock()))abort.abort();},10000);
 try{
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new Error('PROVIDER_TIMEOUT'));},duration);});
  const result=await Promise.race([provider(purchase,loadSnapshot(db,purchase.task_id),abort.signal,prior?JSON.parse(prior.reasons_json):[]),timeout]);
  return completeDelivery(db,job,result,clock());
 }catch(error){
  const code=error instanceof Error?error.message:'';
  if(['INVALID_SCHEMA','EVIDENCE_RANGE','MODEL_JSON_INVALID','MODEL_OUTPUT_LIMIT'].includes(code)){
   // Persist a rejected marker for unreadable output; it can never pass verification.
   return completeDelivery(db,job,{output:null,evidence:[]},clock());
  }
  db.transaction(()=>{
   const current=db.prepare("SELECT 1 FROM invocations WHERE id=? AND lease_token=? AND state='RUNNING'").get(job.id,job.lease_token);
   if(current){
    const message=error instanceof Error?error.message:'';
    const reason=/^[A-Z][A-Z0-9_]{1,79}$/.test(message)?message:'PROVIDER_FAILED';
    const hold=db.prepare('SELECT * FROM reservations WHERE purchase_id=?').get(purchase.id) as Reservation;
    audit(db,hold,'SYSTEM',`FAILURE:${reason}`,clock());release(db,purchase,'FAILED',clock());
   }
  }).immediate();
  return 'FAILED';
 }finally{clearInterval(pulse);clearTimeout(timer);}
}
