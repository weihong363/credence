import type Database from 'better-sqlite3';
import {canonical,object,text} from '../domain/json.js';
import {readTask} from './read-model.js';
import {loadSnapshot} from './snapshots.js';
export interface ReportView {repository:{owner:string;name:string;commitSha:string};recommendation:string;summary:string;findings:{claim:string;acceptedDeliveryIds:string[]}[];limitations:string[]}
export interface TaskResultView {state:'NOT_READY'|'ACTION_REQUIRED'|'COMPLETED'|'UNAVAILABLE';reason:string|null;report:ReportView|null;acceptedDeliveryIds:string[]}
const reasons=new Set(['CREDIT_LIMIT','TASK_BUDGET','TASK_EXPIRED','ACCOUNT_INACTIVE','MODEL_CALL_BUDGET','INSUFFICIENT_COMPLETION_BUDGET',
 'REQUIRED_SERVICE_NOT_ACCEPTED','NO_ACCEPTED_DELIVERIES','INCOMPLETE_REVIEW','FINAL_SOURCE_MISMATCH','INVALID_FINAL','UNACCEPTED_FINDING',
 'MODEL_HTTP_400','MODEL_HTTP_401','MODEL_HTTP_403','MODEL_HTTP_404','MODEL_HTTP_429','MODEL_HTTP_500','MODEL_HTTP_502','MODEL_HTTP_503','MODEL_HTTP_504',
 'PUBLIC_REPOSITORY_REQUIRED','REVISION_MISMATCH','SOURCE_TIMEOUT','SOURCE_HTTP_404','SOURCE_HTTP_403','SOURCE_HTTP_429',
 'INCOMPLETE_FINAL_COVERAGE','MODEL_TRANSPORT_FAILED','MODEL_JSON_INVALID','MODEL_RESPONSE_INVALID','PROVIDER_TIMEOUT','CAPABILITY_UNAVAILABLE','MISSION_FAILED']);
function report(value:unknown,accepted:string[],repository:ReportView['repository']):ReportView{
 const row=object(value,['repository','commitSha','recommendation','summary','findings','limitations']);
 if(canonical(row.repository)!==canonical(repository)||row.commitSha!==repository.commitSha)throw new Error('INVALID_REPORT');
 if(!['ADOPT','ADOPT_WITH_CONDITIONS','DO_NOT_ADOPT','INSUFFICIENT_EVIDENCE'].includes(row.recommendation as string))throw new Error('INVALID_REPORT');
 if(!Array.isArray(row.findings)||!row.findings.length||row.findings.length>20||!Array.isArray(row.limitations)||row.limitations.length>20)throw new Error('INVALID_REPORT');
 const findings=row.findings.map(value=>{
  const finding=object(value,['claim','acceptedDeliveryIds']);
  if(!Array.isArray(finding.acceptedDeliveryIds)||!finding.acceptedDeliveryIds.length||finding.acceptedDeliveryIds.length>5||finding.acceptedDeliveryIds.some(id=>typeof id!=='string'||!accepted.includes(id)))throw new Error('INVALID_REPORT');
  return {claim:text(finding.claim),acceptedDeliveryIds:[...new Set(finding.acceptedDeliveryIds as string[])]};
 });
 if(!accepted.length||accepted.some(id=>!findings.some(f=>f.acceptedDeliveryIds.includes(id))))throw new Error('INVALID_REPORT');
 return {repository:{owner:repository.owner,name:repository.name,commitSha:repository.commitSha},recommendation:row.recommendation as string,
  summary:text(row.summary),findings,limitations:row.limitations.map(value=>text(value))};
}
export function readTaskResult(db:Database.Database,ownerId:string,taskId:string):TaskResultView{
 return db.transaction(():TaskResultView=>{
  const task=readTask(db,ownerId,taskId);
  const ids=(db.prepare(`SELECT d.id FROM deliveries d JOIN purchases p ON p.id=d.purchase_id JOIN charges c ON c.delivery_id=d.id
   WHERE p.task_id=? AND p.status='ACCEPTED' ORDER BY d.id`).all(taskId) as {id:string}[]).map(row=>row.id);
  const result:TaskResultView={state:'NOT_READY',reason:null,report:null,acceptedDeliveryIds:ids};
  if(task.status==='OPEN')return result;
  try{
   const saved=db.prepare('SELECT result_json FROM tasks WHERE id=?').get(taskId) as {result_json:string};
   const value=JSON.parse(saved.result_json);
   if(task.status==='ACTION_REQUIRED')return {...result,state:'ACTION_REQUIRED',reason:reasons.has(value?.reason)?value.reason:'MISSION_FAILED'};
   if(task.status!=='COMPLETED')return {...result,state:'UNAVAILABLE'};
   if(task.profile==='full-review'&&ids.length!==3)return {...result,state:'UNAVAILABLE',reason:'RESULT_VERIFICATION_FAILED'};
   const snapshot=loadSnapshot(db,taskId);
   return {...result,state:'COMPLETED',report:report(value,ids,snapshot.repository)};
  }catch{return {...result,state:'UNAVAILABLE',reason:'RESULT_VERIFICATION_FAILED'};}
 }).deferred();
}
