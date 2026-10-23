import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {hash,text} from '../domain/json.js';
import {createTask,type DemoIdentity} from '../registry/catalog.js';
import {repositoryInput,type Fetcher} from '../providers/source.js';
import type {JsonModel} from '../llm/client.js';
import {preflightReview} from './planning.js';
import {readTask,type TaskSummary} from './read-model.js';
import {resumeMission} from './missions.js';
export type ControlledModelFactory=(taskId:string,guard:()=>void)=>JsonModel;
export interface StartMission {accountId:string;repository:{owner:string;name:string;commitSha:string}}
const LEASE_MS=90000;
export class MissionControl {
 private active:Promise<void>|undefined;private stopping=false;
 constructor(private db:Database.Database,private factory:ControlledModelFactory|undefined,private source:Fetcher=fetch){}
 get enabled():boolean{return !!this.factory&&!this.stopping;}
 lookup(owner:string,key:string):TaskSummary{
  text(key,128);const row=this.db.prepare('SELECT task_id FROM mission_requests WHERE owner_id=? AND key=?').get(owner,key) as {task_id:string}|undefined;
  if(!row)throw new Error('MISSION_REQUEST_NOT_FOUND');return readTask(this.db,owner,row.task_id);
 }
 start(owner:string,key:string,input:StartMission):TaskSummary{
  text(key,128);const repo=repositoryInput({repository:input.repository});if(!repo.commitSha)throw new Error('PINNED_REVISION_REQUIRED');
  const fingerprint=hash(input);
  const result=this.db.transaction(()=>{
   const prior=this.db.prepare('SELECT task_id,request_hash FROM mission_requests WHERE owner_id=? AND key=?').get(owner,key) as {task_id:string;request_hash:string}|undefined;
   if(prior){if(prior.request_hash!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return {id:prior.task_id,token:null};}
   this.available();
   const identity=this.db.prepare("SELECT id accountId,owner_id ownerId,buyer_id buyerId FROM accounts WHERE id=? AND owner_id=? AND status='OPEN'").get(input.accountId,owner) as DemoIdentity|undefined;
   if(!identity)throw new Error('ACCOUNT_FORBIDDEN');
   if(this.db.prepare("SELECT 1 FROM tasks WHERE account_id=? AND status='OPEN'").get(input.accountId))throw new Error('OPEN_MISSION_EXISTS');
   const id=createTask(this.db,identity,'Assess repository architecture and adoption risks with independent source-backed review.',{repository:repo},Date.now(),1000,'full-review');
   preflightReview(this.db,{...identity,taskId:id});
   this.db.prepare('INSERT INTO mission_requests VALUES(?,?,?,?)').run(owner,key,fingerprint,id);
   return {id,token:this.lease(id)};
  }).immediate();
  if(result.token)this.launch(result.id,result.token);
  return readTask(this.db,owner,result.id);
 }
 resume(owner:string,id:string,key:string):TaskSummary{
  text(key,128);
  const task=readTask(this.db,owner,id);if(task.status!=='OPEN')return task;
  const token=this.db.transaction(()=>{
   const prior=this.db.prepare('SELECT task_id FROM mission_resume_commands WHERE owner_id=? AND key=?').get(owner,key) as {task_id:string}|undefined;
   if(prior){if(prior.task_id!==id)throw new Error('IDEMPOTENCY_CONFLICT');return null;}
   this.available();const token=this.lease(id);this.db.prepare('INSERT INTO mission_resume_commands VALUES(?,?,?)').run(owner,key,id);return token;
  }).immediate();
  if(token)this.launch(id,token);return task;
 }
 private available():void{
  if(!this.enabled)throw new Error('LLM_CONFIGURATION_REQUIRED');
  if(this.active||this.db.prepare('SELECT 1 FROM mission_leases WHERE lease_until>?').get(Date.now()))throw new Error('MISSION_BUSY_WAIT_FOR_LEASE');
 }
 private lease(id:string):string{
  const token=randomUUID();this.db.prepare('INSERT INTO mission_leases VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET token=excluded.token,lease_until=excluded.lease_until').run(id,token,Date.now()+LEASE_MS);return token;
 }
 private launch(id:string,token:string):void{
  const guard=()=>{if(this.stopping||!this.db.prepare('SELECT 1 FROM mission_leases WHERE task_id=? AND token=? AND lease_until>?').get(id,token,Date.now()))throw new Error('MISSION_LEASE_LOST');};
  const timer=setInterval(()=>{this.db.prepare('UPDATE mission_leases SET lease_until=? WHERE task_id=? AND token=? AND lease_until>?').run(Date.now()+LEASE_MS,id,token,Date.now());},10000);timer.unref();
  const factory=()=>{const model=this.factory!(id,guard);return {complete:async(system:string,input:unknown,signal?:AbortSignal)=>{guard();const value=await model.complete(system,input,signal);guard();return value;}};};
  const source:Fetcher=async(...args)=>{guard();const response=await this.source(...args);guard();return response;};
  this.active=new Promise<void>(resolve=>setImmediate(resolve)).then(async()=>{await resumeMission(this.db,factory,id,source,guard);}).catch(()=>{ /* Saved task state or lease loss is observed through the read API; no raw model error logs. */ }).finally(()=>{
   clearInterval(timer);this.db.prepare('DELETE FROM mission_leases WHERE task_id=? AND token=?').run(id,token);this.active=undefined;
  });
 }
 stop():void{this.stopping=true;}
 async drained():Promise<void>{await this.active;}
}
