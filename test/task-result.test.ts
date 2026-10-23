import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paymentFixture} from './payment-harness.js';
import {readTaskResult} from '../src/application/task-result.js';
import {openDatabase} from '../src/persistence/database.js';
import {initializeDemo} from '../src/application/initialize.js';
import {createTask} from '../src/registry/catalog.js';
import {createRehearsal,scenarios} from '../scripts/console-rehearsal.js';
import {readFinance} from '../src/application/finance.js';

test('result reads require ownership and expose only verified reports citing the same task accepted deliveries',async()=>{
 const f=await paymentFixture();try{
  const id=(f.db.prepare('SELECT id FROM tasks').get() as {id:string}).id;
  const before=(f.db.prepare('SELECT total_changes() n').get() as {n:number}).n;
  const result=readTaskResult(f.db,f.account.owner_id,id);assert.equal(result.state,'COMPLETED');assert.equal(result.acceptedDeliveryIds.length,3);
  assert.equal(result.report?.repository.commitSha,'a'.repeat(40));assert.ok(result.report?.findings.every(f=>f.acceptedDeliveryIds.every(id=>result.acceptedDeliveryIds.includes(id))));
  assert.throws(()=>readTaskResult(f.db,'other-owner',id),/TASK_NOT_FOUND/);
  assert.equal((f.db.prepare('SELECT total_changes() n').get() as {n:number}).n,before);
  const saved=JSON.parse((f.db.prepare('SELECT result_json FROM tasks WHERE id=?').get(id) as {result_json:string}).result_json);
  for(const invalid of [{...saved,extra:'PRIVATE_CANARY'},{...saved,commitSha:'b'.repeat(40)},{...saved,findings:[{claim:'PRIVATE_CANARY',acceptedDeliveryIds:['foreign-delivery']}]}]){
   f.db.prepare('UPDATE tasks SET result_json=? WHERE id=?').run(JSON.stringify(invalid),id);
   const rejected=readTaskResult(f.db,f.account.owner_id,id);assert.equal(rejected.state,'UNAVAILABLE');assert.equal(rejected.report,null);assert.ok(!JSON.stringify(rejected).includes('PRIVATE_CANARY'));
  }
 }finally{f.db.close();}
});
test('open and failed tasks never become completed or leak arbitrary failure payloads',()=>{
 const db=openDatabase(':memory:');try{
  const owner=initializeDemo(db,1500),task=createTask(db,owner,'Pending review',{});
  assert.equal(readTaskResult(db,owner.ownerId,task).state,'NOT_READY');
  for(const reason of ['CREDIT_LIMIT','PRIVATE_CANARY']){
   db.prepare("UPDATE tasks SET status='ACTION_REQUIRED',result_json=? WHERE id=?").run(JSON.stringify({reason,secret:'hidden'}),task);
   const result=readTaskResult(db,owner.ownerId,task);assert.equal(result.state,'ACTION_REQUIRED');assert.equal(result.reason,reason==='CREDIT_LIMIT'?reason:'MISSION_FAILED');assert.ok(!JSON.stringify(result).includes('hidden'));
  }
 }finally{db.close();}
});
test('controlled rehearsal scenarios use isolated memory state and no global network transport',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('NETWORK_FORBIDDEN_IN_REHEARSAL');};
 try{for(const scenario of scenarios){
  const fixture=await createRehearsal(scenario);try{
   const finance=readFinance(fixture.db,fixture.identity.ownerId);assert.equal(finance.accounts[0].limitMinor,1500);
   if(scenario==='empty'){assert.equal(finance.charges.length,0);continue;}
   const task=(fixture.db.prepare('SELECT id FROM tasks').get() as {id:string}).id;
   assert.equal(readTaskResult(fixture.db,fixture.identity.ownerId,task).state,scenario==='action-required'?'ACTION_REQUIRED':'COMPLETED');
   if(scenario==='settled')assert.equal(finance.batches[0].state,'SETTLED');
   if(scenario==='unknown')assert.equal(finance.batches[0].state,'UNKNOWN');
   if(scenario==='declined')assert.equal(finance.batches[0].state,'ACTION_REQUIRED');
   if(['unknown','declined'].includes(scenario))assert.equal(finance.batches[0].receipt,null);
  }finally{fixture.db.close();}
 }}finally{globalThis.fetch=original;}
});
