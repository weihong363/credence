import type Database from 'better-sqlite3';
export interface PageRequest {afterSeq:number;limit:number}
export interface Page<T> {items:T[];nextSeq:number;hasMore:boolean}
export interface TaskSummary {
 sequence:number;id:string;accountId:string;objective:string;status:string;profile:string;
 budgetMinor:number;spentMinor:number;deadlineAt:number;purchaseCount:number;acceptedCount:number;outstandingMinor:number;
}
export interface AuditEvent {
 seq:number;id:string;accountId:string;taskIds:string[];purchaseId:string|null;batchId:string|null;
 actor:'OWNER'|'SYSTEM'|'BUYER'|'UNKNOWN';type:string;reasonCodes:string[];createdAt:number;
}
export interface LedgerEntry {
 seq:number;id:string;taskId:string;purchaseId:string;reservationId:string;type:string;amountMinor:number;
 currency:'USD';allocationId:string|null;chargeId:string|null;batchId:string|null;createdAt:number;
}
interface AuditRow {seq:number;id:string;account_id:string;task_id:string|null;purchase_id:string|null;batch_id:string|null;actor_id:string;action:string;created_at:number}
const taskColumns=`t.rowid sequence,t.id,t.account_id accountId,t.objective,t.status,t.review_profile profile,t.budget_minor budgetMinor,
 t.spent_minor spentMinor,t.deadline_at deadlineAt,(SELECT count(*) FROM purchases p WHERE p.task_id=t.id) purchaseCount,
 (SELECT count(*) FROM purchases p WHERE p.task_id=t.id AND p.status='ACCEPTED') acceptedCount,
 (SELECT COALESCE(sum(c.amount_minor),0) FROM charges c WHERE c.task_id=t.id
  AND NOT EXISTS(SELECT 1 FROM allocations x WHERE x.charge_id=c.id AND x.state='SETTLED')
  AND NOT EXISTS(SELECT 1 FROM ledger_events l WHERE l.charge_id=c.id AND l.type='CHARGE_REVERSED')) outstandingMinor`;
function validate(page:PageRequest):void{
 if(!Number.isSafeInteger(page.afterSeq)||page.afterSeq<0||!Number.isSafeInteger(page.limit)||page.limit<1||page.limit>100)throw new Error('INVALID_PAGE');
}
function pageOf<T>(rows:T[],page:PageRequest,sequence:(value:T)=>number):Page<T>{
 const items=rows.slice(0,page.limit);return {items,nextSeq:items.length?sequence(items.at(-1)!):page.afterSeq,hasMore:rows.length>page.limit};
}
export function readTask(db:Database.Database,ownerId:string,id:string):TaskSummary{
 const row=db.prepare(`SELECT ${taskColumns} FROM tasks t JOIN accounts a ON a.id=t.account_id WHERE t.id=? AND a.owner_id=?`).get(id,ownerId) as TaskSummary|undefined;
 if(!row)throw new Error('TASK_NOT_FOUND');return row;
}
export function readTasks(db:Database.Database,ownerId:string,page:PageRequest):Page<TaskSummary>{
 validate(page);
 const rows=db.prepare(`SELECT ${taskColumns} FROM tasks t JOIN accounts a ON a.id=t.account_id WHERE a.owner_id=? AND t.rowid>? ORDER BY t.rowid LIMIT ?`)
  .all(ownerId,page.afterSeq,page.limit+1) as TaskSummary[];
 return pageOf(rows,page,row=>row.sequence);
}
const knownActions=new Set(['CREDIT_RESERVED','EXECUTING','ACCEPTED','FAILED','REJECTED','CANCELLED','LATE_DELIVERY_IGNORED','BATCH_FROZEN',
 'FROZEN','AWAITING_APPROVAL','CAPTURING','PAYMENT_PENDING','UNKNOWN','ACTION_REQUIRED','SETTLED','OWNER_CANCELLED','OWNER_RESUMED',
 'CREATE_INTENT','CAPTURE_INTENT','ORDER_ASSOCIATED','PAYMENT_CREATE','PAYMENT_INSPECT','PAYMENT_ERROR','PAYMENT_SETTLED','BUYER_RETURN_HINT','BUYER_CANCEL_HINT']);
const safeReasonCodes=new Set(['INVALID_SCHEMA','EVIDENCE_RANGE','SOURCE_HASH','EVIDENCE_ANCHOR','EVIDENCE_REFERENCE',
 'DUPLICATE_COMPONENT','UNKNOWN_COMPONENT','DUPLICATE_RISK','INSUFFICIENT_EVIDENCE','INVENTORY_MISMATCH',
 'ENTRY_POINT','COMMAND_EVIDENCE','EXCLUSIONS_MISMATCH','DELIVERY_SIZE_LIMIT','REVISION_MISMATCH','UNKNOWN_CAPABILITY',
 'UNKNOWN_PROVIDER','PROVIDER_TIMEOUT','PROVIDER_FAILED','TASK_EXPIRED','MODEL_CALL_BUDGET','SYNTHESIS_BUDGET_RESERVED',
 'MODEL_TRANSPORT_FAILED','MODEL_RESPONSE_READ_FAILED','MODEL_ENVELOPE_INVALID','MODEL_OUTPUT_LIMIT',
 'MODEL_RESPONSE_INVALID','MODEL_JSON_INVALID','LLM_CONFIGURATION_REQUIRED','INVALID_LLM_URL']);
function safeAction(action:string):{type:string;reasonCodes:string[]}{
 if(knownActions.has(action))return {type:action,reasonCodes:[]};
 if(action.startsWith('CHARGE_REVERSED:'))return {type:'CHARGE_REVERSED',reasonCodes:[]};
 if(/^POLICY:LIMIT:\d+->\d+$/.test(action))return {type:'POLICY_LIMIT_CHANGED',reasonCodes:[]};
 if(/^POLICY:(OPEN|SUSPENDED|REVOKED)$/.test(action))return {type:`POLICY_${action.split(':')[1]}`,reasonCodes:[]};
 const [type,codes]=action.split(':');
 if(['FAILURE','CORRECTION_REQUIRED'].includes(type))return {type,reasonCodes:(codes??'').split(',').filter(code=>safeReasonCodes.has(code)).slice(0,20)};
 return {type:'AUDIT_EVENT',reasonCodes:[]};
}
export function readEvents(db:Database.Database,ownerId:string,page:PageRequest,taskId?:string):Page<AuditEvent>{
 validate(page);
 return db.transaction(()=>{
  if(taskId)readTask(db,ownerId,taskId);
  const rows=db.prepare(`SELECT e.seq,e.id,e.account_id,r.task_id,r.purchase_id,e.batch_id,e.actor_id,e.action,e.created_at
   FROM economic_audit e JOIN accounts a ON a.id=e.account_id LEFT JOIN reservations r ON r.id=e.reservation_id
   WHERE a.owner_id=? AND e.seq>? AND (? IS NULL OR r.task_id=? OR EXISTS(
    SELECT 1 FROM allocations x JOIN charges c ON c.id=x.charge_id WHERE x.batch_id=e.batch_id AND c.task_id=?))
   ORDER BY e.seq LIMIT ?`).all(ownerId,page.afterSeq,taskId??null,taskId??null,taskId??null,page.limit+1) as AuditRow[];
  const items=rows.map(row=>({seq:row.seq,id:row.id,accountId:row.account_id,taskIds:row.task_id?[row.task_id]:batchTasks(db,ownerId,row.batch_id),
   purchaseId:row.purchase_id,batchId:row.batch_id,actor:actor(row.actor_id,ownerId),...safeAction(row.action),createdAt:row.created_at}));
  return pageOf(items,page,row=>row.seq);
 }).deferred();
}
function batchTasks(db:Database.Database,ownerId:string,batchId:string|null):string[]{
 if(!batchId)return [];
 return (db.prepare(`SELECT DISTINCT c.task_id FROM allocations x JOIN charges c ON c.id=x.charge_id JOIN accounts a ON a.id=c.account_id
  WHERE x.batch_id=? AND a.owner_id=? ORDER BY c.task_id`).all(batchId,ownerId) as {task_id:string}[]).map(row=>row.task_id);
}
function actor(value:string,ownerId:string):AuditEvent['actor']{return value===ownerId?'OWNER':value==='SYSTEM'?'SYSTEM':value==='BUYER'?'BUYER':'UNKNOWN';}
export function readLedger(db:Database.Database,ownerId:string,accountId:string,page:PageRequest):{account:Record<string,unknown>;entries:Page<LedgerEntry>}{
 validate(page);
 return db.transaction(()=>{
  const account=db.prepare(`SELECT id,currency,limit_minor limitMinor,per_purchase_minor perPurchaseMinor,reserved_minor reservedMinor,
   outstanding_minor outstandingMinor,limit_minor-reserved_minor-outstanding_minor availableMinor,status,expires_at expiresAt,version
   FROM accounts WHERE id=? AND owner_id=?`).get(accountId,ownerId) as Record<string,unknown>|undefined;
  if(!account)throw new Error('ACCOUNT_NOT_FOUND');
  const rows=db.prepare(`SELECT seq,id,task_id taskId,purchase_id purchaseId,reservation_id reservationId,type,amount_minor amountMinor,currency,
   allocation_id allocationId,charge_id chargeId,batch_id batchId,created_at createdAt FROM ledger_events WHERE account_id=? AND seq>? ORDER BY seq LIMIT ?`)
   .all(accountId,page.afterSeq,page.limit+1) as LedgerEntry[];
  return {account,entries:pageOf(rows,page,row=>row.seq)};
 }).deferred();
}
