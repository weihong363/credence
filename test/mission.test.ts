import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runMission} from '../src/application/missions.js';
import {openDatabase} from '../src/persistence/database.js';
import {reconcile} from '../src/application/lifecycle.js';
import {missionHarness,sourceFetcher,repositoryInput} from './mission-harness.js';

test('full-review production adapters: zero, one and two corrections use 4, 5 and 6 requests',async()=>{
 for(const corrections of [0,1,2]){
  const db=openDatabase(':memory:');const harness=missionHarness(db,{corrections});
  try{
   const result=await runMission(db,harness.factory,'Review all three services',repositoryInput,sourceFetcher,undefined,{profile:'full-review'});
   assert.equal(result.status,'COMPLETED');assert.equal(result.acceptedDeliveryIds.length,3);
   assert.equal((db.prepare('SELECT count(*) n FROM model_calls').get() as {n:number}).n,4+corrections);
   assert.equal(harness.planningRequests(),1);
   assert.deepEqual(db.prepare('SELECT reserved_minor,outstanding_minor FROM accounts').get(),{reserved_minor:0,outstanding_minor:750});
   assert.equal((db.prepare('SELECT spent_minor FROM tasks').get() as {spent_minor:number}).spent_minor,750);reconcile(db);
  }finally{db.close();}
 }
});
test('two provider corrections plus both HTTP retries still fit eight requests',async()=>{
 const db=openDatabase(':memory:');const harness=missionHarness(db,{corrections:2,retryProviders:true});
 try{
  const result=await runMission(db,harness.factory,'Complete review',repositoryInput,sourceFetcher,undefined,{profile:'full-review'});
  assert.equal(result.status,'COMPLETED');assert.equal(result.acceptedDeliveryIds.length,3);
  assert.equal((db.prepare('SELECT count(*) n FROM model_calls').get() as {n:number}).n,8);
  assert.equal((db.prepare("SELECT count(*) n FROM model_calls WHERE purpose='SYNTHESIS'").get() as {n:number}).n,1);reconcile(db);
 }finally{db.close();}
});
test('full review rejects empty/partial/duplicate/unknown plans before any holds or charges',async()=>{
 for(const capabilities of [[],['repo.inventory'],['repo.inventory','repo.inventory'],['fake.service']]){
  const db=openDatabase(':memory:');const harness=missionHarness(db,{capabilities});
  try{
   const result=await runMission(db,harness.factory,'Complete review',repositoryInput,sourceFetcher,undefined,{profile:'full-review'});
   assert.equal(result.status,'ACTION_REQUIRED');assert.equal(result.acceptedDeliveryIds.length,0);
   assert.equal((db.prepare('SELECT count(*) n FROM purchases').get() as {n:number}).n,0);reconcile(db);
  }finally{db.close();}
 }
});
test('full review cannot complete with missing final coverage or unaccepted finding IDs',async()=>{
 for(const options of [{missingCoverage:true},{unknownFinding:true}]){
  const db=openDatabase(':memory:');const harness=missionHarness(db,options);
  try{
   const result=await runMission(db,harness.factory,'Review all three',repositoryInput,sourceFetcher,undefined,{profile:'full-review'});
   assert.equal(result.status,'ACTION_REQUIRED');assert.equal(result.acceptedDeliveryIds.length,3);
   assert.deepEqual(result.result,{reason:options.missingCoverage?'INCOMPLETE_FINAL_COVERAGE':'UNACCEPTED_FINDING'});
   assert.equal((db.prepare('SELECT outstanding_minor FROM accounts').get() as {outstanding_minor:number}).outstanding_minor,750);reconcile(db);
  }finally{db.close();}
 }
});
test('failed required provider prevents full-review success and releases its hold',async()=>{
 const db=openDatabase(':memory:');const harness=missionHarness(db,{rejectRisk:true});
 try{
  const result=await runMission(db,harness.factory,'Complete review',repositoryInput,sourceFetcher,undefined,{profile:'full-review'});
  assert.equal(result.status,'ACTION_REQUIRED');assert.deepEqual(result.result,{reason:'REQUIRED_SERVICE_NOT_ACCEPTED'});
  assert.equal(result.acceptedDeliveryIds.length,2);
  assert.deepEqual(db.prepare('SELECT reserved_minor,outstanding_minor FROM accounts').get(),{reserved_minor:0,outstanding_minor:375});reconcile(db);
 }finally{db.close();}
});
test('scoped inventory missions remain distinct and task-scoped idempotency keys do not collide',async()=>{
 const db=openDatabase(':memory:');
 try{
  for(let index=0;index<2;index++){
   const harness=missionHarness(db,{capabilities:['repo.inventory']});
   const result=await runMission(db,harness.factory,'Inventory only',repositoryInput,sourceFetcher);
   assert.equal(result.status,'COMPLETED');assert.equal(result.acceptedDeliveryIds.length,1);
  }
  assert.equal((db.prepare('SELECT outstanding_minor FROM accounts').get() as {outstanding_minor:number}).outstanding_minor,250);reconcile(db);
 }finally{db.close();}
});

test('malformed provider envelope and JSON each get one bounded correction without duplicate charges',async()=>{
 const db=openDatabase(':memory:');const harness=missionHarness(db,{protocolErrors:true});
 try{
  const result=await runMission(db,harness.factory,'Full review',repositoryInput,sourceFetcher,undefined,{profile:'full-review'});
  assert.equal(result.status,'COMPLETED');assert.equal(result.acceptedDeliveryIds.length,3);
  assert.equal((db.prepare('SELECT count(*) n FROM model_calls').get() as {n:number}).n,6);
  assert.equal((db.prepare("SELECT count(*) n FROM verifications WHERE result='FAIL'").get() as {n:number}).n,2);
  assert.equal((db.prepare('SELECT count(*) n FROM charges').get() as {n:number}).n,3);reconcile(db);
 }finally{db.close();}
});
