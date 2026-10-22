import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
export function claimModelCall(db:Database.Database,taskId:string,model:string,now=Date.now()):void{
 db.transaction(()=>{
  const task=db.prepare("SELECT 1 FROM tasks WHERE id=? AND status='OPEN' AND deadline_at>?").get(taskId,now);
  if(!task)throw new Error('TASK_EXPIRED');
  const count=(db.prepare('SELECT count(*) n FROM model_calls WHERE task_id=?').get(taskId) as {n:number}).n;
  if(count>=8)throw new Error('MODEL_CALL_BUDGET');
  db.prepare('INSERT INTO model_calls VALUES(?,?,?,?,?)').run(randomUUID(),taskId,model,count+1,now);
 }).immediate();
}
