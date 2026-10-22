import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
export type ModelPhase = 'PLANNING' | 'PROVIDER' | 'SYNTHESIS';
export function setModelPhase(db:Database.Database,taskId:string,phase:ModelPhase):void{
 db.prepare('UPDATE tasks SET model_phase=? WHERE id=?').run(phase,taskId);
}
export function modelRequests(db:Database.Database,taskId:string):number{
 return (db.prepare('SELECT count(*) n FROM model_calls WHERE task_id=?').get(taskId) as {n:number}).n;
}
export function claimModelCall(db:Database.Database,taskId:string,model:string,now=Date.now()):void{
 db.transaction(()=>{
  const task=db.prepare("SELECT model_phase FROM tasks WHERE id=? AND status='OPEN' AND deadline_at>?").get(taskId,now) as {model_phase:ModelPhase}|undefined;
  if(!task)throw new Error('TASK_EXPIRED');
  const count=modelRequests(db,taskId);
  if(count>=8)throw new Error('MODEL_CALL_BUDGET');
  if(task.model_phase!=='SYNTHESIS'&&count>=7)throw new Error('SYNTHESIS_BUDGET_RESERVED');
  db.prepare('INSERT INTO model_calls(id,task_id,model,ordinal,created_at,purpose) VALUES(?,?,?,?,?,?)')
   .run(randomUUID(),taskId,model,count+1,now,task.model_phase);
 }).immediate();
}
