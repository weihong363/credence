import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seedDemo,createTask} from '../src/registry/catalog.js';
import {source} from './runtime-fixture.js';
import {openDatabase} from '../src/persistence/database.js';
import {persistSnapshot} from '../src/application/snapshots.js';
import {getPlan} from '../src/application/planning.js';
import {claimModelCall,setModelPhase} from '../src/application/model-budget.js';
import {runMission} from '../src/application/missions.js';
import {missionHarness,sourceFetcher,repositoryInput} from './mission-harness.js';

test('full-review availability is preflighted before model calls and financial effects',async()=>{
 const db=openDatabase(':memory:');const identity=seedDemo(db);
 db.prepare('UPDATE accounts SET per_purchase_minor=100').run();
 const harness=missionHarness(db);
 try{
  const result=await runMission(db,harness.factory,'Review all',repositoryInput,async()=>{throw new Error('MUST_NOT_FETCH');},undefined,{profile:'full-review'});
  assert.equal(result.profile,'full-review');assert.deepEqual(result.result,{reason:'CREDIT_LIMIT'});
  assert.equal(harness.planningRequests(),0);
  assert.equal((db.prepare('SELECT count(*) n FROM purchases').get() as {n:number}).n,0);
  assert.equal((db.prepare('SELECT reserved_minor FROM accounts WHERE id=?').get(identity.accountId) as {reserved_minor:number}).reserved_minor,0);
 }finally{db.close();}
});
test('immutable persisted plan and profile cannot be rewritten or silently re-planned',async()=>{
 const db=openDatabase(':memory:');const identity=seedDemo(db),snapshot=source();
 const taskId=createTask(db,identity,'Review all',repositoryInput,Date.now(),1000,'full-review');
 persistSnapshot(db,taskId,snapshot);const context={...identity,taskId};const harness=missionHarness(db);
 try{
  const plan=await getPlan(db,context,harness.factory(taskId));
  assert.deepEqual(await getPlan(db,context,{async complete(){throw new Error('MUST_NOT_REPLAN');}}),plan);
  assert.equal(harness.planningRequests(),1);
  assert.throws(()=>db.exec("UPDATE procurement_plans SET payload_json='{}'"),/APPEND_ONLY/);
  assert.throws(()=>db.exec("UPDATE tasks SET review_profile='scoped'"),/IMMUTABLE_REVIEW_PROFILE/);
 }finally{db.close();}
});
test('provider/planning cannot consume the last model request reserved for synthesis',()=>{
 const db=openDatabase(':memory:');const identity=seedDemo(db);
 const taskId=createTask(db,identity,'Review',repositoryInput);
 try{
  setModelPhase(db,taskId,'PROVIDER');
  for(let index=0;index<7;index++)claimModelCall(db,taskId,'fixture');
  assert.throws(()=>claimModelCall(db,taskId,'fixture'),/SYNTHESIS_BUDGET_RESERVED/);
  setModelPhase(db,taskId,'SYNTHESIS');claimModelCall(db,taskId,'fixture');
  assert.throws(()=>claimModelCall(db,taskId,'fixture'),/MODEL_CALL_BUDGET/);
  assert.equal((db.prepare('SELECT count(*) n FROM model_calls').get() as {n:number}).n,8);
 }finally{db.close();}
});
