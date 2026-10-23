import type Database from 'better-sqlite3';
import {readTask} from './read-model.js';
import {loadSnapshot} from './snapshots.js';
import type {Evidence,ProviderResult} from '../providers/contracts.js';
import type {Snapshot} from '../providers/source.js';
interface DeliveryRow {id:string;purchaseId:string;attempt:number;createdAt:number;result:'PASS'|'FAIL';output_json:string}
export interface DeliveryView {id:string;purchaseId:string;attempt:number;createdAt:number;result:'PASS'|'FAIL';evidence:Evidence[]}
export interface PurchaseView {id:string;capabilityId:string;version:number;providerName:string;status:string;amountMinor:number;reservationState:string;deadlineAt:number}
export interface TaskActivity {purchases:PurchaseView[];deliveries:DeliveryView[];plan:{capabilityId:string;version:number;reason:string}[]}
function evidence(row:DeliveryRow,snapshot:Snapshot|undefined):Evidence[]{
 if(row.result!=='PASS'||!snapshot)return [];
 const data=JSON.parse(row.output_json) as ProviderResult;
 if(!Array.isArray(data.evidence))return [];
 return data.evidence.slice(0,30).flatMap(item=>{
  const file=snapshot.files.find(file=>file.path===item.path);
  if(!file||item.artifactId!==snapshot.id||!Number.isSafeInteger(item.startLine)||!Number.isSafeInteger(item.endLine)||item.startLine<1||item.endLine<item.startLine)return [];
  const lines=file.content.split('\n');
  if(item.endLine>lines.length)return [];
  const anchor=lines.slice(item.startLine-1,item.endLine).join('\n');
  if(anchor!==item.anchor||anchor.length>4000)return [];
  return [{artifactId:snapshot.id,path:file.path,startLine:item.startLine,endLine:item.endLine,anchor}];
 });
}
export function readActivity(db:Database.Database,ownerId:string,taskId:string):TaskActivity{
 return db.transaction(()=>{
  readTask(db,ownerId,taskId);
  const purchases=db.prepare(`SELECT p.id,p.capability_id capabilityId,p.version,g.name providerName,p.status,q.amount_minor amountMinor,
   r.state reservationState,p.deadline_at deadlineAt FROM purchases p JOIN quotes q ON q.id=p.quote_id JOIN agents g ON g.id=p.provider_id
   JOIN reservations r ON r.purchase_id=p.id WHERE p.task_id=? ORDER BY p.created_at,p.id LIMIT 5`).all(taskId) as PurchaseView[];
  const saved=db.prepare('SELECT payload_json FROM procurement_plans WHERE task_id=?').get(taskId) as {payload_json:string}|undefined;
  const plan=saved?(JSON.parse(saved.payload_json).purchases as TaskActivity['plan']).slice(0,5).map(p=>({capabilityId:p.capabilityId,version:p.version,reason:p.reason.slice(0,500)})):[];
  const rows=db.prepare(`SELECT d.id,d.purchase_id purchaseId,d.attempt,d.created_at createdAt,v.result,d.output_json FROM deliveries d
   JOIN purchases p ON p.id=d.purchase_id JOIN verifications v ON v.delivery_id=d.id WHERE p.task_id=? ORDER BY d.created_at,d.id LIMIT 10`).all(taskId) as DeliveryRow[];
  const hasSnapshot=db.prepare('SELECT 1 FROM snapshots WHERE task_id=?').get(taskId);
  const snapshot=hasSnapshot?loadSnapshot(db,taskId):undefined;
  const deliveries=rows.map(row=>({id:row.id,purchaseId:row.purchaseId,attempt:row.attempt,createdAt:row.createdAt,result:row.result,evidence:evidence(row,snapshot)}));
  return {purchases,deliveries,plan};
 }).deferred();
}
