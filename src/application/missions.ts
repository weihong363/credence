import type Database from 'better-sqlite3';
import {object,text,canonical} from '../domain/json.js';
import {seedDemo,createTask} from '../registry/catalog.js';
import {fetchSnapshot,repositoryInput,type Fetcher} from '../providers/source.js';
import {persistSnapshot,loadSnapshot} from './snapshots.js';
import {requestQuote,proposePurchase,type Context,type Purchase} from './procurement.js';
import {runNext,providers,type Provider} from './runner.js';
import {reconcile,cancelPurchase,recover} from './lifecycle.js';
import {fullReviewCapabilities,type ReviewProfile} from '../domain/review.js';
import {getPlan,reviewProfile,ensureExecutionBudget,preflightReview} from './planning.js';
import {setModelPhase} from './model-budget.js';
import type {JsonModel} from '../llm/client.js';
interface Accepted {id:string;purchase_id:string;output_json:string;capability_id:string}
export type ModelFactory=(taskId:string)=>JsonModel;
export interface MissionOptions {profile?:ReviewProfile}
export interface MissionResult {taskId:string;profile:ReviewProfile;status:'COMPLETED'|'ACTION_REQUIRED';result:unknown;acceptedDeliveryIds:string[]}
function accepted(db:Database.Database,taskId:string):Accepted[]{
 return db.prepare("SELECT d.id,d.purchase_id,d.output_json,p.capability_id FROM deliveries d JOIN purchases p ON p.id=d.purchase_id JOIN charges c ON c.delivery_id=d.id WHERE p.task_id=? AND p.status='ACCEPTED' ORDER BY d.created_at").all(taskId) as Accepted[];
}
function validateFinal(value:unknown,rows:Accepted[],snapshot:ReturnType<typeof loadSnapshot>):unknown{
 const result=object(value,['repository','commitSha','recommendation','summary','findings','limitations']);
 if(canonical(result.repository)!==canonical(snapshot.repository)||result.commitSha!==snapshot.repository.commitSha)throw new Error('FINAL_SOURCE_MISMATCH');
 if(!['ADOPT','ADOPT_WITH_CONDITIONS','DO_NOT_ADOPT','INSUFFICIENT_EVIDENCE'].includes(result.recommendation as string))throw new Error('INVALID_FINAL');
 text(result.summary);
 if(!Array.isArray(result.findings)||!result.findings.length||result.findings.length>20||!Array.isArray(result.limitations)||result.limitations.length>20)throw new Error('INVALID_FINAL');
 for(const finding of result.findings){const item=object(finding,['claim','acceptedDeliveryIds']);text(item.claim);
  if(!Array.isArray(item.acceptedDeliveryIds)||!item.acceptedDeliveryIds.length||item.acceptedDeliveryIds.some(id=>!rows.some(row=>row.id===id)))throw new Error('UNACCEPTED_FINDING');}
 const cited=new Set((result.findings as {acceptedDeliveryIds:string[]}[]).flatMap(item=>item.acceptedDeliveryIds));
 if(rows.some(row=>!cited.has(row.id)))throw new Error('INCOMPLETE_FINAL_COVERAGE');
 result.limitations.forEach(item=>text(item));return result;
}
async function procure(db:Database.Database,context:Context,model:JsonModel,provider:Provider):Promise<void>{
 const plan=await getPlan(db,context,model);
 for(let index=0;index<plan.purchases.length;index++){
  const entry=plan.purchases[index];
  const existing=db.prepare('SELECT * FROM purchases WHERE task_id=? AND capability_id=? AND version=?').get(context.taskId,entry.capabilityId,entry.version) as Purchase|undefined;
  if(existing?.status==='ACCEPTED')continue;
  if(existing&&['FAILED','REJECTED','CANCELLED'].includes(existing.status)){
   if(reviewProfile(db,context.taskId)==='full-review')throw new Error('REQUIRED_SERVICE_NOT_ACCEPTED');
   continue;
  }
  ensureExecutionBudget(db,context.taskId,plan.purchases.slice(index));
  const purchase=existing??proposePurchase(db,context,requestQuote(db,context,entry.capabilityId,entry.version).id,`task:${context.taskId}:plan:${index}`);
  setModelPhase(db,context.taskId,'PROVIDER');
  while(await runNext(db,provider,Date.now,60000,context.taskId)){}
  reconcile(db);
  const outcome=db.prepare('SELECT status FROM purchases WHERE id=?').get(purchase.id) as {status:string};
  if(reviewProfile(db,context.taskId)==='full-review'&&outcome.status!=='ACCEPTED')throw new Error('REQUIRED_SERVICE_NOT_ACCEPTED');
 }
}
function requireReviewCoverage(db:Database.Database,taskId:string,rows:Accepted[]):void{
 if(reviewProfile(db,taskId)!=='full-review')return;
 if(rows.length!==3||fullReviewCapabilities.some(id=>!rows.some(row=>row.capability_id===id)))throw new Error('INCOMPLETE_REVIEW');
}
export async function runMission(db:Database.Database,model:JsonModel|ModelFactory,objective:string,input:unknown,fetcher:Fetcher=fetch,provider?:Provider,options:MissionOptions={}):Promise<MissionResult>{
 repositoryInput(input);
 reconcile(db);
 const identity=seedDemo(db);const taskId=createTask(db,identity,objective,input,Date.now(),1000,options.profile??'scoped');const context={...identity,taskId};
 try{
  preflightReview(db,context);
  persistSnapshot(db,taskId,await fetchSnapshot(input,fetcher));
  return await continueMission(db,context,typeof model==='function'?model(taskId):model,provider);
 }catch(error){return failMission(db,context,error);}
}
export async function resumeMission(db:Database.Database,factory:ModelFactory,taskId:string,fetcher:Fetcher=fetch,guard?:()=>void):Promise<MissionResult>{
 if(!guard&&db.prepare('SELECT 1 FROM mission_leases WHERE task_id=? AND lease_until>?').get(taskId,Date.now()))throw new Error('MISSION_BUSY_WAIT_FOR_LEASE');
 guard?.();
 reconcile(db);recover(db);
 const task=db.prepare('SELECT t.*,a.owner_id FROM tasks t JOIN accounts a ON a.id=t.account_id WHERE t.id=?').get(taskId) as {account_id:string;owner_id:string;status:string;result_json:string}|undefined;
 if(!task)throw new Error('TASK_NOT_FOUND');
 if(task.status!=='OPEN')return {taskId,profile:reviewProfile(db,taskId),status:task.status as MissionResult['status'],result:JSON.parse(task.result_json),acceptedDeliveryIds:accepted(db,taskId).map(row=>row.id)};
 if(db.prepare("SELECT 1 FROM invocations i JOIN purchases p ON p.id=i.purchase_id WHERE p.task_id=? AND i.state='RUNNING'").get(taskId))throw new Error('MISSION_BUSY_WAIT_FOR_LEASE');
 const context={taskId,ownerId:task.owner_id,accountId:task.account_id};
 try{
  guard?.();preflightReview(db,context);
  if(!db.prepare('SELECT 1 FROM snapshots WHERE task_id=?').get(taskId)){
   const input=JSON.parse((db.prepare('SELECT input_json FROM tasks WHERE id=?').get(taskId) as {input_json:string}).input_json);
   const snapshot=await fetchSnapshot(input,fetcher);guard?.();persistSnapshot(db,taskId,snapshot);
  }
  return await continueMission(db,context,factory(taskId));
 }catch(error){if(error instanceof Error&&error.message==='MISSION_LEASE_LOST')throw error;return failMission(db,context,error);}
}
async function continueMission(db:Database.Database,context:Context,model:JsonModel,provider:Provider=providers(model)):Promise<MissionResult>{
 const taskId=context.taskId;
 await procure(db,context,model,provider);
 const rows=accepted(db,taskId);if(!rows.length)throw new Error('NO_ACCEPTED_DELIVERIES');
 requireReviewCoverage(db,taskId,rows);
 setModelPhase(db,taskId,'SYNTHESIS');
 const snapshot=loadSnapshot(db,taskId);
 const objective=(db.prepare('SELECT objective FROM tasks WHERE id=?').get(taskId) as {objective:string}).objective;
 const raw=await model.complete('Synthesize a repository adoption recommendation using only the purchased accepted deliveries. Return {repository,commitSha,recommendation:ADOPT|ADOPT_WITH_CONDITIONS|DO_NOT_ADOPT|INSUFFICIENT_EVIDENCE,summary,findings:[{claim,acceptedDeliveryIds:[id]}],limitations:[string]}. Copy the supplied repository object exactly, including owner, name and commitSha; top-level commitSha must be identical. Each finding must cite accepted delivery IDs; mention missing services and objective-check limitations. Keep the full response under 600 tokens, summary under 80 words, and one concise finding per accepted delivery; cover EVERY supplied delivery ID and do not repeat the file inventory.',{objective,repository:snapshot.repository,commitSha:snapshot.repository.commitSha,deliveries:rows.map(row=>({id:row.id,capabilityId:row.capability_id,...JSON.parse(row.output_json)}))});
 const result=validateFinal(raw,rows,snapshot);
 const deadline=(db.prepare('SELECT deadline_at FROM tasks WHERE id=?').get(taskId) as {deadline_at:number}).deadline_at;
 if(deadline<=Date.now())throw new Error('TASK_EXPIRED');
 db.prepare("UPDATE tasks SET result_json=?,status='COMPLETED' WHERE id=?").run(canonical(result),taskId);reconcile(db);
 return {taskId,profile:reviewProfile(db,taskId),status:'COMPLETED',result,acceptedDeliveryIds:rows.map(row=>row.id)};
}
function failMission(db:Database.Database,context:Context,error:unknown):MissionResult{
 const taskId=context.taskId;
 const unfinished=db.prepare("SELECT id FROM purchases WHERE task_id=? AND status NOT IN('ACCEPTED','FAILED','REJECTED','CANCELLED')").all(taskId) as {id:string}[];
 unfinished.forEach(item=>cancelPurchase(db,context,item.id));recover(db);reconcile(db);
 const result={reason:safeReason(error)};
 db.prepare("UPDATE tasks SET result_json=?,status='ACTION_REQUIRED' WHERE id=?").run(canonical(result),taskId);
 return {taskId,profile:reviewProfile(db,taskId),status:'ACTION_REQUIRED',result,acceptedDeliveryIds:accepted(db,taskId).map(row=>row.id)};
}
function safeReason(error:unknown):string{
 const message=error instanceof Error?error.message:'';
 return /^[A-Z][A-Z0-9_]{1,79}$/.test(message)?message:'MISSION_FAILED';
}
