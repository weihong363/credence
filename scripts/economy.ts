import {existsSync} from 'node:fs';
import {LlmClient,llmConfig} from '../src/llm/client.js';
import {claimModelCall} from '../src/application/model-budget.js';
import {resumeMission} from '../src/application/missions.js';
import {openDatabase} from '../src/persistence/database.js';
import {recover,reconcile,cancelPurchase} from '../src/application/lifecycle.js';

const path=process.env.CREDENCE_DB_PATH??'.data/credence.sqlite';
if(!existsSync(path))throw new Error('DATABASE_NOT_CREATED_RUN_MISSION_FIRST');
const db=openDatabase(path);
try{
 const [command='status',purchaseId]=process.argv.slice(2).filter(arg=>arg!=='--');
 if(command==='resume'){
  const config=llmConfig();
  const result=await resumeMission(db,id=>new LlmClient(config,fetch,()=>claimModelCall(db,id,config.model)),purchaseId);
  console.log(JSON.stringify(result,null,2));if(result.status!=='COMPLETED')process.exitCode=1;
 }else if(command==='recover')recover(db);
 else if(command==='cancel'){
  const context=db.prepare('SELECT p.task_id taskId,p.account_id accountId,a.owner_id ownerId FROM purchases p JOIN accounts a ON a.id=p.account_id WHERE p.id=?').get(purchaseId) as {ownerId:string;accountId:string;taskId:string}|undefined;
  if(!context)throw new Error('PURCHASE_NOT_FOUND');cancelPurchase(db,context,purchaseId);
 }else if(command!=='status')throw new Error('Usage: pnpm economy status|recover|cancel PURCHASE_ID|resume TASK_ID');
 reconcile(db);
 console.log(JSON.stringify({
  accounts:db.prepare('SELECT id,limit_minor,reserved_minor,outstanding_minor,limit_minor-reserved_minor-outstanding_minor available_minor,status FROM accounts').all(),
  tasks:db.prepare('SELECT id,status,spent_minor,deadline_at FROM tasks').all(),
  purchases:db.prepare('SELECT id,task_id,capability_id,status,deadline_at FROM purchases').all(),
  charges:db.prepare('SELECT id,purchase_id,delivery_id,amount_minor,currency FROM charges').all(),
  modelCalls:db.prepare('SELECT task_id,model,count(*) requests FROM model_calls GROUP BY task_id,model').all(),
  reconciliation:'PASS',
 },null,2));
}finally{db.close();}
