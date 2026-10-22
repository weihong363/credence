import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {object,text,canonical} from '../domain/json.js';
import {seedDemo,createTask} from '../registry/catalog.js';
import {fetchSnapshot,repositoryInput,type Fetcher} from '../providers/source.js';
import {persistSnapshot,loadSnapshot} from './snapshots.js';
import {listCapabilities,requestQuote,proposePurchase,type Context} from './procurement.js';
import {runNext,providers,type Provider} from './runner.js';
import {reconcile,cancelPurchase,recover} from './lifecycle.js';
import type {JsonModel} from '../llm/client.js';
interface Accepted {id:string;purchase_id:string;output_json:string}
export type ModelFactory=(taskId:string)=>JsonModel;
export interface MissionResult {taskId:string;status:'COMPLETED'|'ACTION_REQUIRED';result:unknown;acceptedDeliveryIds:string[]}
function accepted(db:Database.Database,taskId:string):Accepted[]{
 return db.prepare("SELECT d.id,d.purchase_id,d.output_json FROM deliveries d JOIN purchases p ON p.id=d.purchase_id JOIN charges c ON c.delivery_id=d.id WHERE p.task_id=? AND p.status='ACCEPTED' ORDER BY d.created_at").all(taskId) as Accepted[];
}
async function decision(model:JsonModel,input:unknown):Promise<Record<string,unknown>>{
 const raw=await model.complete('Choose the next capability to buy to fulfill the owner objective. Select only a listed capability/version. Return {action:"purchase",capabilityId,version,reason} or {action:"finish",reason}. Do not repeat completed or failed capabilities. Purchase at most five services. Prices are authoritative. A useful review normally needs inventory, architecture and independent risk review.',input);
 const value=raw as Record<string,unknown>;
 const keys=value?.action==='purchase'?['action','capabilityId','version','reason']:['action','reason'];
 object(value,keys);text(value.reason,500);
 if(!['purchase','finish'].includes(value.action as string))throw new Error('INVALID_DECISION');
 if(value.action==='purchase'){text(value.capabilityId,120);if(!Number.isSafeInteger(value.version)||Number(value.version)<1)throw new Error('INVALID_DECISION');}
 return value;
}
function validateFinal(value:unknown,rows:Accepted[],snapshot:ReturnType<typeof loadSnapshot>):unknown{
 const result=object(value,['repository','commitSha','recommendation','summary','findings','limitations']);
 if(canonical(result.repository)!==canonical(snapshot.repository)||result.commitSha!==snapshot.repository.commitSha)throw new Error('FINAL_SOURCE_MISMATCH');
 if(!['ADOPT','ADOPT_WITH_CONDITIONS','DO_NOT_ADOPT','INSUFFICIENT_EVIDENCE'].includes(result.recommendation as string))throw new Error('INVALID_FINAL');
 text(result.summary);
 if(!Array.isArray(result.findings)||!result.findings.length||result.findings.length>20||!Array.isArray(result.limitations)||result.limitations.length>20)throw new Error('INVALID_FINAL');
 for(const finding of result.findings){const item=object(finding,['claim','acceptedDeliveryIds']);text(item.claim);
  if(!Array.isArray(item.acceptedDeliveryIds)||!item.acceptedDeliveryIds.length||item.acceptedDeliveryIds.some(id=>!rows.some(row=>row.id===id)))throw new Error('UNACCEPTED_FINDING');}
 result.limitations.forEach(item=>text(item));return result;
}
async function procure(db:Database.Database,context:Context,model:JsonModel,provider:Provider):Promise<void>{
 let repaired=(db.prepare('SELECT decision_repairs FROM tasks WHERE id=?').get(context.taskId) as {decision_repairs:number}).decision_repairs===1;
 const start=(db.prepare('SELECT count(*) n FROM purchases WHERE task_id=?').get(context.taskId) as {n:number}).n;
 for(let proposal=start;proposal<5;proposal++){
  const rows=accepted(db,context.taskId);
  const purchases=db.prepare('SELECT capability_id,status FROM purchases WHERE task_id=?').all(context.taskId);
  const taskInput=JSON.parse((db.prepare('SELECT input_json FROM tasks WHERE id=?').get(context.taskId) as {input_json:string}).input_json);
  const allowance=db.prepare('SELECT limit_minor-reserved_minor-outstanding_minor availableMinor,per_purchase_minor perPurchaseMinor FROM accounts WHERE id=?').get(context.accountId);
  const input={taskInput,allowance,objective:(db.prepare('SELECT objective FROM tasks WHERE id=?').get(context.taskId) as {objective:string}).objective,
   capabilities:listCapabilities(db,context),purchases,accepted:rows.map(row=>({id:row.id,...JSON.parse(row.output_json)}))};
  let choice:Record<string,unknown>;
  try{choice=await decision(model,input);}catch(error){
   if(repaired || !['MODEL_JSON_INVALID','INVALID_SCHEMA','INVALID_DECISION'].includes((error as Error).message))throw error;
   db.prepare('UPDATE tasks SET decision_repairs=1 WHERE id=?').run(context.taskId);
   repaired=true;choice=await decision(model,{...input,repair:'Previous decision was invalid. Follow the exact JSON contract.'});
  }
  if(choice.action==='finish'){
   db.prepare('INSERT INTO economic_audit(id,account_id,reservation_id,actor_id,action,created_at) VALUES(?,?,NULL,?,?,?)').run(randomUUID(),context.accountId,'COORDINATOR',`FINISH:${choice.reason}`,Date.now());
   return;
  }
  const quote=requestQuote(db,context,choice.capabilityId as string,choice.version as number);
  const purchase=proposePurchase(db,context,quote.id,`task:${context.taskId}:proposal:${proposal}`);
  db.prepare("INSERT INTO economic_audit(id,account_id,reservation_id,actor_id,action,created_at) SELECT ?,?,?,? ,?,? FROM reservations WHERE purchase_id=?")
   .run(randomUUID(),context.accountId,(db.prepare('SELECT id FROM reservations WHERE purchase_id=?').get(purchase.id) as {id:string}).id,'COORDINATOR',`PROPOSAL:${choice.reason}`,Date.now(),purchase.id);
  while(await runNext(db,provider,Date.now,60000,context.taskId)) { /* Includes the single bounded correction. */ }
  reconcile(db);
 }
}
export async function runMission(db:Database.Database,model:JsonModel|ModelFactory,objective:string,input:unknown,fetcher:Fetcher=fetch,provider?:Provider):Promise<MissionResult>{
 repositoryInput(input);
 reconcile(db);
 const identity=seedDemo(db);const taskId=createTask(db,identity,objective,input);const context={...identity,taskId};
 try{
  persistSnapshot(db,taskId,await fetchSnapshot(input,fetcher));
  return await continueMission(db,context,typeof model==='function'?model(taskId):model,provider);
 }catch(error){return failMission(db,context,error);}
}
export async function resumeMission(db:Database.Database,factory:ModelFactory,taskId:string):Promise<MissionResult>{
 reconcile(db);recover(db);
 const task=db.prepare('SELECT t.*,a.owner_id FROM tasks t JOIN accounts a ON a.id=t.account_id WHERE t.id=?').get(taskId) as {account_id:string;owner_id:string;status:string;result_json:string}|undefined;
 if(!task)throw new Error('TASK_NOT_FOUND');
 if(task.status!=='OPEN')return {taskId,status:task.status as MissionResult['status'],result:JSON.parse(task.result_json),acceptedDeliveryIds:accepted(db,taskId).map(row=>row.id)};
 if(db.prepare("SELECT 1 FROM invocations i JOIN purchases p ON p.id=i.purchase_id WHERE p.task_id=? AND i.state='RUNNING'").get(taskId))throw new Error('MISSION_BUSY_WAIT_FOR_LEASE');
 const context={taskId,ownerId:task.owner_id,accountId:task.account_id};
 try{return await continueMission(db,context,factory(taskId));}catch(error){return failMission(db,context,error);}
}
async function continueMission(db:Database.Database,context:Context,model:JsonModel,provider:Provider=providers(model)):Promise<MissionResult>{
 const taskId=context.taskId;
 while(await runNext(db,provider,Date.now,60000,taskId)){}
 await procure(db,context,model,provider);
 const rows=accepted(db,taskId);if(!rows.length)throw new Error('NO_ACCEPTED_DELIVERIES');
 const snapshot=loadSnapshot(db,taskId);
 const objective=(db.prepare('SELECT objective FROM tasks WHERE id=?').get(taskId) as {objective:string}).objective;
 const raw=await model.complete('Synthesize a repository adoption recommendation using only the purchased accepted deliveries. Return {repository,commitSha,recommendation:ADOPT|ADOPT_WITH_CONDITIONS|DO_NOT_ADOPT|INSUFFICIENT_EVIDENCE,summary,findings:[{claim,acceptedDeliveryIds:[id]}],limitations:[string]}. Copy the supplied repository object exactly, including owner, name and commitSha; top-level commitSha must be identical. Each finding must cite accepted delivery IDs; mention missing services and objective-check limitations. Keep the full response under 600 tokens, summary under 80 words, and one concise finding per accepted delivery; do not repeat the file inventory.',{objective,repository:snapshot.repository,commitSha:snapshot.repository.commitSha,deliveries:rows.map(row=>({id:row.id,...JSON.parse(row.output_json)}))});
 const result=validateFinal(raw,rows,snapshot);
 const deadline=(db.prepare('SELECT deadline_at FROM tasks WHERE id=?').get(taskId) as {deadline_at:number}).deadline_at;
 if(deadline<=Date.now())throw new Error('TASK_EXPIRED');
 db.prepare("UPDATE tasks SET result_json=?,status='COMPLETED' WHERE id=?").run(canonical(result),taskId);reconcile(db);
 return {taskId,status:'COMPLETED',result,acceptedDeliveryIds:rows.map(row=>row.id)};
}
function failMission(db:Database.Database,context:Context,error:unknown):MissionResult{
 const taskId=context.taskId;
 const unfinished=db.prepare("SELECT id FROM purchases WHERE task_id=? AND status NOT IN('ACCEPTED','FAILED','REJECTED','CANCELLED')").all(taskId) as {id:string}[];
 unfinished.forEach(item=>cancelPurchase(db,context,item.id));recover(db);reconcile(db);
 const result={reason:safeReason(error)};
 db.prepare("UPDATE tasks SET result_json=?,status='ACTION_REQUIRED' WHERE id=?").run(canonical(result),taskId);
 return {taskId,status:'ACTION_REQUIRED',result,acceptedDeliveryIds:accepted(db,taskId).map(row=>row.id)};
}
function safeReason(error:unknown):string{
 const message=error instanceof Error?error.message:'';
 return /^[A-Z][A-Z0-9_]{1,79}$/.test(message)?message:'MISSION_FAILED';
}
