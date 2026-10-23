import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import type Database from 'better-sqlite3';
import {openDatabase} from '../src/persistence/database.js';
import {runMission} from '../src/application/missions.js';
import {freezeBatch} from '../src/application/batches.js';
import {reconcile} from '../src/application/lifecycle.js';
import {missionHarness,repositoryInput,sourceFetcher} from './mission-harness.js';
async function fixture(path=':memory:',rejectRisk=false){
 const db=openDatabase(path);const harness=missionHarness(db,{rejectRisk});
 await runMission(db,harness.factory,'review repository',repositoryInput,sourceFetcher,undefined,{profile:'full-review'});
 const account=db.prepare('SELECT id,owner_id FROM accounts').get() as {id:string;owner_id:string};
 const chargeIds=(db.prepare('SELECT id FROM charges ORDER BY id').all() as {id:string}[]).map(row=>row.id);
 return {db,request:{ownerId:account.owner_id,accountId:account.id,key:'batch-key',chargeIds}};
}
function counts(db:Database.Database){return ['batches','allocations','batch_requests','ledger_events','economic_audit'].map(table=>(db.prepare(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n);}
test('three accepted charges freeze at 750, replay across restart preserves balances and history',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'credence-batch-'));const path=join(dir,'db.sqlite');const f=await fixture(path);
 try{
  const balances=f.db.prepare('SELECT * FROM accounts').get();
  const batch=freezeBatch(f.db,'sandbox-merchant',f.request,100);
  assert.equal(batch.total_minor,750);const history=counts(f.db);reconcile(f.db);
  assert.throws(()=>freezeBatch(f.db,'sandbox-merchant',{...f.request,chargeIds:f.request.chargeIds.slice(0,1)}),/IDEMPOTENCY_CONFLICT/);
  assert.throws(()=>f.db.prepare("INSERT INTO allocations VALUES('partial',?,?,1,'LOCKED',100)").run(batch.id,f.request.chargeIds[0]),/ALLOCATION_REQUIRES_ACCEPTED_CHARGE/);
  assert.deepEqual(f.db.prepare('SELECT * FROM accounts').get(),balances);
  assert.deepEqual(freezeBatch(f.db,'sandbox-merchant',{...f.request,chargeIds:[...f.request.chargeIds].reverse()},200),batch);
  assert.deepEqual(counts(f.db),history);
  for(const table of ['batches','allocations','batch_requests'])assert.throws(()=>f.db.exec(`DELETE FROM ${table}`),/APPEND_ONLY/);
  assert.throws(()=>f.db.exec('UPDATE batches SET total_minor=1'),/IMMUTABLE_BATCH/);
  assert.throws(()=>freezeBatch(f.db,'other-merchant',f.request),/IDEMPOTENCY_CONFLICT/);
  assert.throws(()=>freezeBatch(f.db,'sandbox-merchant',{...f.request,key:'new-key'}),/CHARGE_NOT_ELIGIBLE/);
  const reopened=openDatabase(path);try{reconcile(reopened);assert.deepEqual(freezeBatch(reopened,'sandbox-merchant',f.request),batch);}finally{reopened.close();}
 }finally{f.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('invalid, foreign, duplicate and rejected purchase selections cannot allocate; failed audit rolls back all writes',async()=>{
 const f=await fixture(':memory:',true);
 try{
  const before=counts(f.db);
  for(const chargeIds of [[],[...f.request.chargeIds,f.request.chargeIds[0]],['missing']])assert.throws(()=>freezeBatch(f.db,'merchant',{...f.request,chargeIds}));
  assert.throws(()=>freezeBatch(f.db,'merchant',{...f.request,ownerId:'foreign'}),/ACCOUNT_FORBIDDEN/);
  const rejected=f.db.prepare("SELECT id FROM purchases WHERE status='REJECTED'").get() as {id:string};
  assert.ok(rejected);assert.throws(()=>freezeBatch(f.db,'merchant',{...f.request,chargeIds:[rejected.id]}),/CHARGE_NOT_ELIGIBLE/);
  assert.deepEqual(counts(f.db),before);
  f.db.exec("CREATE TRIGGER fail_batch_audit BEFORE INSERT ON economic_audit WHEN NEW.action='BATCH_FROZEN' BEGIN SELECT RAISE(ABORT,'INJECTED'); END");
  assert.throws(()=>freezeBatch(f.db,'merchant',f.request),/INJECTED/);assert.deepEqual(counts(f.db),before);reconcile(f.db);
 }finally{f.db.close();}
});
test('reconciliation detects frozen total and missing allocation journal independently',async()=>{
 const f=await fixture();try{
  freezeBatch(f.db,'merchant',f.request);reconcile(f.db);
  f.db.exec('DROP TRIGGER batch_identity; UPDATE batches SET total_minor=1');
  assert.throws(()=>reconcile(f.db),/BATCH_RECONCILIATION_MISMATCH/);
  f.db.exec("UPDATE batches SET total_minor=750; DROP TRIGGER ledger_events_no_delete; DELETE FROM ledger_events WHERE type='SETTLEMENT_ALLOCATED'");
  assert.throws(()=>reconcile(f.db),/BATCH_RECONCILIATION_MISMATCH/);
 }finally{f.db.close();}
});
test('two processes with different keys cannot allocate the same charges twice',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'credence-batch-race-'));const path=join(dir,'db.sqlite');const f=await fixture(path);
 const children=['one','two'].map(key=>fork(new URL('../scripts/batch-contender.ts',import.meta.url),[],{execArgv:['--import','tsx'],stdio:['ignore','ignore','inherit','ipc'],env:{...process.env,CREDIT_TEST_PATH:path,CREDIT_TEST_REQUEST:JSON.stringify({...f.request,key})}}));
 try{
  await Promise.all(children.map(child=>once(child,'message')));
  const results=children.map(child=>once(child,'message'));const exits=children.map(child=>once(child,'exit'));
  children.forEach(child=>child.send('go'));
  assert.deepEqual((await Promise.all(results)).map(([result])=>result).sort(),['CHARGE_NOT_ELIGIBLE','OK']);await Promise.all(exits);
  assert.deepEqual(counts(f.db).slice(0,3),[1,3,1]);reconcile(f.db);
 }finally{children.forEach(child=>child.kill());f.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('version-five accepted charges and ledger hashes survive schema upgrade unchanged',async()=>{
 const {default:Sqlite}=await import('better-sqlite3');const {migrations}=await import('../src/persistence/migrations.js');
 const {seedDemo,createTask}=await import('../src/registry/catalog.js');
 const {source,analysisResult}=await import('./runtime-fixture.js');
 const {persistSnapshot}=await import('../src/application/snapshots.js');
 const {requestQuote,proposePurchase}=await import('../src/application/procurement.js');
 const {claim}=await import('../src/application/lifecycle.js');
 const {completeDelivery}=await import('../src/application/deliveries.js');
 const dir=mkdtempSync(join(tmpdir(),'credence-v5-'));const path=join(dir,'db.sqlite');
 const old=new Sqlite(path);old.pragma('foreign_keys=ON');
 for(const migration of migrations.filter(item=>item.version<=5))old.exec(migration.sql);
 old.pragma('user_version=5');
 const identity=seedDemo(old,100),snapshot=source();const taskId=createTask(old,identity,'review',{repository:snapshot.repository},100);
 persistSnapshot(old,taskId,snapshot,100);const context={...identity,taskId};
 const quote=requestQuote(old,context,'repo.architecture',1,100);proposePurchase(old,context,quote.id,'first',100);
 completeDelivery(old,claim(old,100)!,analysisResult(snapshot),101);
 const charges=old.prepare('SELECT * FROM charges').all();const events=old.prepare('SELECT * FROM ledger_events').all();
 const audit=old.prepare('SELECT * FROM economic_audit').all();old.close();
 const db=openDatabase(path);try{
  assert.deepEqual(db.prepare('SELECT * FROM charges').all(),charges);
  assert.deepEqual(db.prepare('SELECT * FROM ledger_events').all(),events.map(row=>({...row as object,allocation_id:null,charge_id:null,batch_id:null})));
  assert.deepEqual(db.prepare('SELECT * FROM economic_audit').all(),audit.map(row=>({...row as object,batch_id:null})));
  reconcile(db);const charge=charges[0] as {id:string};
  freezeBatch(db,'merchant',{...identity,key:'migration',chargeIds:[charge.id]});reconcile(db);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
