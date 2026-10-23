import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {paymentFixture} from './payment-harness.js';
import {readEvents,readLedger,readTasks,readTask} from '../src/application/read-model.js';
import {createTask} from '../src/registry/catalog.js';
import {reconcile} from '../src/application/lifecycle.js';
const page={afterSeq:0,limit:2};
test('event pages are strictly ordered, replay stable, append-aware and bound to the authenticated owner',async()=>{
 const f=await paymentFixture();try{
  const ids:number[]=[];let afterSeq=0;
  for(let iteration=0;iteration<50;iteration++){
   const result=readEvents(f.db,f.account.owner_id,{afterSeq,limit:2});
   assert.deepEqual(readEvents(f.db,f.account.owner_id,{afterSeq,limit:2}),result);
   for(const event of result.items){assert.ok(event.seq>afterSeq);ids.push(event.seq);afterSeq=event.seq;}
   if(!result.hasMore)break;
  }
  assert.equal(new Set(ids).size,ids.length);assert.ok(ids.length>=10);
  assert.deepEqual(readEvents(f.db,f.account.owner_id,{afterSeq,limit:2}),{items:[],nextSeq:afterSeq,hasMore:false});
  await f.run('cancel');const next=readEvents(f.db,f.account.owner_id,{afterSeq,limit:2});
  assert.equal(next.items[0].type,'OWNER_CANCELLED');assert.ok(next.nextSeq>afterSeq);
  assert.deepEqual(readEvents(f.db,'foreign-owner',page).items,[]);reconcile(f.db);
 }finally{f.db.close();}
});
test('task, audit and ledger read models omit raw prompts, provider responses, free-form audit reasons and operation keys',async()=>{
 const f=await paymentFixture();try{
  const secret='PRIVATE_CANARY_CREDENTIAL';
  const identity={ownerId:f.account.owner_id,accountId:f.account.id,buyerId:(f.db.prepare('SELECT buyer_id FROM accounts').get() as {buyer_id:string}).buyer_id};
  const taskId=createTask(f.db,identity,'safe objective',{rawPrivatePrompt:secret});
  f.db.prepare('UPDATE tasks SET result_json=? WHERE id=?').run(JSON.stringify({rawPrivateResponse:secret}),taskId);
  for(const action of [`CHARGE_REVERSED:${secret}`,`FAILURE:${secret}`,`${secret}:anything`,`CORRECTION_REQUIRED:INVALID_SCHEMA,${secret}`]){
   f.db.prepare('INSERT INTO economic_audit(id,account_id,actor_id,action,created_at) VALUES(?,?,?,?,?)').run(randomUUID(),f.account.id,secret,action,1);
  }
  const before=(f.db.prepare('SELECT total_changes() n').get() as {n:number}).n;
  const tasks=readTasks(f.db,f.account.owner_id,{afterSeq:0,limit:100});
  const task=readTask(f.db,f.account.owner_id,taskId);
  const events=readEvents(f.db,f.account.owner_id,{afterSeq:0,limit:100});
  const ledger=readLedger(f.db,f.account.owner_id,f.account.id,{afterSeq:0,limit:100});
  const serialized=JSON.stringify({tasks,task,events,ledger});
  for(const hidden of [secret,'payload_hash','dedupe_key','input_json','result_json','callback_hash','input_hash','output_json'])assert.ok(!serialized.includes(hidden));
  assert.equal((f.db.prepare('SELECT total_changes() n').get() as {n:number}).n,before);
  assert.ok(events.items.some(event=>event.reasonCodes.includes('INVALID_SCHEMA')));
  const full=tasks.items.find(item=>item.id!==taskId)!;assert.equal(full.purchaseCount,3);assert.equal(full.acceptedCount,3);assert.equal(full.outstandingMinor,750);
  assert.equal(ledger.account.outstandingMinor,750);
 }finally{f.db.close();}
});
test('task event scope includes associated batch history once, excludes other owners and validates every cursor',async()=>{
 const f=await paymentFixture();try{
  const taskId=(f.db.prepare('SELECT id FROM tasks').get() as {id:string}).id;
  const events=readEvents(f.db,f.account.owner_id,{afterSeq:0,limit:100},taskId);
  assert.equal(events.items.filter(event=>event.type==='BATCH_FROZEN').length,1);
  assert.ok(events.items.every(event=>event.taskIds.includes(taskId)));
  assert.throws(()=>readTask(f.db,'foreign-owner',taskId),/TASK_NOT_FOUND/);
  assert.throws(()=>readLedger(f.db,'foreign-owner',f.account.id,page),/ACCOUNT_NOT_FOUND/);
  assert.throws(()=>readEvents(f.db,'foreign-owner',page,taskId),/TASK_NOT_FOUND/);
  for(const value of [{afterSeq:-1,limit:50},{afterSeq:0.1,limit:50},{afterSeq:0,limit:101},{afterSeq:0,limit:0}])assert.throws(()=>readEvents(f.db,f.account.owner_id,value),/INVALID_PAGE/);
 }finally{f.db.close();}
});
