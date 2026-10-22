import type Database from 'better-sqlite3';
import {object,text,canonical} from '../domain/json.js';
import {fullReviewCapabilities,type ReviewProfile,type ProcurementPlan,type PlanEntry} from '../domain/review.js';
import {listCapabilities,type Context} from './procurement.js';
import {modelRequests,setModelPhase} from './model-budget.js';
import type {JsonModel} from '../llm/client.js';
interface Capability {id:string;version:number;price_minor:number}
interface Task {objective:string;input_json:string;review_profile:ReviewProfile;budget_minor:number;spent_minor:number}
export function reviewProfile(db:Database.Database,taskId:string):ReviewProfile{
 return (db.prepare('SELECT review_profile FROM tasks WHERE id=?').get(taskId) as {review_profile:ReviewProfile}).review_profile;
}
function parsePlan(value:unknown,capabilities:Capability[],profile:ReviewProfile):ProcurementPlan{
 const plan=object(value,['purchases']);
 if(!Array.isArray(plan.purchases)||!plan.purchases.length||plan.purchases.length>5)throw new Error('INVALID_PLAN');
 const seen=new Set<string>();
 const purchases=plan.purchases.map(value=>{
  const row=object(value,['capabilityId','version','reason']);text(row.reason,500);
  const capability=capabilities.find(item=>item.id===row.capabilityId&&item.version===row.version);
  if(!capability)throw new Error('CAPABILITY_UNAVAILABLE');
  if(seen.has(capability.id))throw new Error('DUPLICATE_PLAN_CAPABILITY');seen.add(capability.id);
  return {capabilityId:capability.id,version:capability.version,reason:row.reason as string};
 });
 if(profile==='full-review'&&(purchases.length!==3||fullReviewCapabilities.some(id=>!seen.has(id))))throw new Error('INCOMPLETE_REVIEW_PLAN');
 return {purchases};
}
function preflight(db:Database.Database,context:Context,plan:ProcurementPlan,capabilities:Capability[],task:Task):void{
 const account=db.prepare('SELECT limit_minor-reserved_minor-outstanding_minor available,per_purchase_minor FROM accounts WHERE id=?').get(context.accountId) as {available:number;per_purchase_minor:number};
 const failed=plan.purchases.some(item=>db.prepare("SELECT 1 FROM purchases WHERE task_id=? AND capability_id=? AND version=? AND status IN ('FAILED','REJECTED','CANCELLED')").get(context.taskId,item.capabilityId,item.version));
 if(task.review_profile==='full-review'&&failed)throw new Error('REQUIRED_SERVICE_NOT_ACCEPTED');
 const remaining=plan.purchases.filter(item=>!db.prepare('SELECT 1 FROM purchases WHERE task_id=? AND capability_id=? AND version=?').get(context.taskId,item.capabilityId,item.version));
 const prices=remaining.map(item=>capabilities.find(capability=>capability.id===item.capabilityId&&capability.version===item.version)!.price_minor);
 if(prices.some(price=>price>account.per_purchase_minor)||prices.reduce((a,b)=>a+b,0)>account.available)throw new Error('CREDIT_LIMIT');
 if(prices.reduce((a,b)=>a+b,0)>task.budget_minor-task.spent_minor)throw new Error('TASK_BUDGET');
 ensureExecutionBudget(db,context.taskId,remaining);
}
export function ensureExecutionBudget(db:Database.Database,taskId:string,remaining:PlanEntry[]):void{
 const minimum=remaining.filter(item=>item.capabilityId!=='repo.inventory'&&!db.prepare("SELECT 1 FROM purchases WHERE task_id=? AND capability_id=? AND version=? AND status IN ('ACCEPTED','FAILED','REJECTED','CANCELLED')").get(taskId,item.capabilityId,item.version)).length;
 if(modelRequests(db,taskId)+minimum+1>8)throw new Error('INSUFFICIENT_COMPLETION_BUDGET');
}
async function generatePlan(db:Database.Database,context:Context,task:Task,capabilities:Capability[],model:JsonModel):Promise<ProcurementPlan>{
 const system='Plan bounded capability purchases to fulfill the owner objective using only the registry. Return exactly {"purchases":[{"capabilityId":"registry id","version":1,"reason":"short justification"}]}. No prices or extra fields. No duplicate capabilities. For full-review include inventory, architecture and independent risk review exactly once. For scoped tasks choose only relevant services. Never weaken evidence requirements or invent risks. This plan will be validated and persisted before purchases.';
 const input={objective:task.objective,taskInput:JSON.parse(task.input_json),profile:task.review_profile,capabilities};
 setModelPhase(db,context.taskId,'PLANNING');
 try{return parsePlan(await model.complete(system,input),capabilities,task.review_profile);}
 catch(error){
  const reason=(error as Error).message;
  if(!['MODEL_JSON_INVALID','INVALID_SCHEMA','INVALID_PLAN','INCOMPLETE_REVIEW_PLAN'].includes(reason))throw error;
  if(!db.prepare('UPDATE tasks SET decision_repairs=1 WHERE id=? AND decision_repairs=0').run(context.taskId).changes)throw error;
  return parsePlan(await model.complete(system,{...input,repair:reason}),capabilities,task.review_profile);
 }
}
export async function getPlan(db:Database.Database,context:Context,model:JsonModel):Promise<ProcurementPlan>{
 const task=db.prepare('SELECT * FROM tasks WHERE id=?').get(context.taskId) as Task;
 const capabilities=listCapabilities(db,context) as Capability[];
 const saved=db.prepare('SELECT payload_json FROM procurement_plans WHERE task_id=?').get(context.taskId) as {payload_json:string}|undefined;
 if(!saved)preflightReview(db,context);
 const plan=saved?parsePlan(JSON.parse(saved.payload_json),capabilities,task.review_profile):await generatePlan(db,context,task,capabilities,model);
 preflight(db,context,plan,capabilities,task);
 if(!saved)db.prepare('INSERT INTO procurement_plans VALUES(?,?,?)').run(context.taskId,canonical(plan),Date.now());
 return plan;
}

export function preflightReview(db:Database.Database,context:Context):void{
 const task=db.prepare('SELECT * FROM tasks WHERE id=?').get(context.taskId) as Task;
 if(task.review_profile!=='full-review')return;
 const capabilities=listCapabilities(db,context) as Capability[];
 const required=fullReviewCapabilities.map(id=>{
  const capability=capabilities.find(item=>item.id===id);
  if(!capability)throw new Error('CAPABILITY_UNAVAILABLE');
  return {capabilityId:id,version:capability.version,reason:'Required acceptance profile'};
 });
 preflight(db,context,{purchases:required},capabilities,task);
}
