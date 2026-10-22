import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/persistence/database.js';
import {seedDemo,createTask} from '../src/registry/catalog.js';
import {persistSnapshot} from '../src/application/snapshots.js';
import {getPlan} from '../src/application/planning.js';
import {requestQuote,proposePurchase} from '../src/application/procurement.js';
import {runNext,providers} from '../src/application/runner.js';
import {claim,reconcile} from '../src/application/lifecycle.js';
import {resumeMission} from '../src/application/missions.js';
import {missionHarness,repositoryInput} from './mission-harness.js';
import {source} from './runtime-fixture.js';

test('full review resumes persisted plan after a worker crash, without duplicate quotes or charges',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'credence-plan-restart-'));const path=join(directory,'db.sqlite');
 let db=openDatabase(path);
 try{
  const identity=seedDemo(db),taskId=createTask(db,identity,'Full review',repositoryInput,Date.now(),1000,'full-review');
  persistSnapshot(db,taskId,source());const context={...identity,taskId},initial=missionHarness(db);
  const plan=await getPlan(db,context,initial.factory(taskId));
  for(const index of [0,1]){
   const item=plan.purchases[index],quote=requestQuote(db,context,item.capabilityId,item.version);
   proposePurchase(db,context,quote.id,`task:${taskId}:plan:${index}`);
   if(index===0)assert.equal(await runNext(db,providers(initial.factory(taskId))), 'ACCEPTED');
  }
  const leased=claim(db,Date.now()-31000,taskId)!;
  db.close();db=openDatabase(path);const resumed=missionHarness(db);
  const result=await resumeMission(db,resumed.factory,taskId);
  assert.equal(result.status,'COMPLETED');assert.equal(result.profile,'full-review');assert.equal(result.acceptedDeliveryIds.length,3);
  assert.equal(resumed.planningRequests(),0);
  assert.equal((db.prepare('SELECT execution_attempts FROM invocations WHERE id=?').get(leased.id) as {execution_attempts:number}).execution_attempts,2);
  assert.equal((db.prepare('SELECT count(*) n FROM quotes').get() as {n:number}).n,3);
  assert.equal((db.prepare('SELECT count(*) n FROM charges').get() as {n:number}).n,3);
  const calls=(db.prepare('SELECT count(*) n FROM model_calls').get() as {n:number}).n;
  assert.equal(calls,4);
  assert.deepEqual(await resumeMission(db,()=>{throw new Error('MUST_NOT_CALL_MODEL');},taskId),result);
  assert.equal((db.prepare('SELECT count(*) n FROM model_calls').get() as {n:number}).n,calls);reconcile(db);
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});
