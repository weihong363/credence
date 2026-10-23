import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {once} from 'node:events';
import {openDatabase} from '../src/persistence/database.js';
import {initializeDemo} from '../src/application/initialize.js';
import {MissionControl} from '../src/application/mission-control.js';
import {readTaskResult} from '../src/application/task-result.js';
import {readConfig} from '../src/config.js';
import {createRuntimeApp} from '../src/runtime-http.js';
import {Payments} from '../src/application/payments.js';
import {reconcile} from '../src/application/lifecycle.js';
import {missionHarness,sourceFetcher,repositoryInput} from './mission-harness.js';
function setup(path=':memory:'){
 const db=openDatabase(path),identity=initializeDemo(db,1500),h=missionHarness(db);
 const input={accountId:identity.accountId,repository:repositoryInput.repository};
 const control=new MissionControl(db,h.factory,sourceFetcher);
 return {db,identity,input,control};
}
test('start persists one task and request atomically; replay and another connection cannot duplicate execution',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'credence-mission-control-')),f=setup(join(dir,'test.sqlite')),other=openDatabase(join(dir,'test.sqlite'));
 try{
  const c2=new MissionControl(other,missionHarness(other).factory,sourceFetcher);
  const task=f.control.start(f.identity.ownerId,'start-one',f.input);
  assert.equal(c2.start(f.identity.ownerId,'start-one',f.input).id,task.id);
  assert.throws(()=>c2.start(f.identity.ownerId,'other',f.input),/MISSION_BUSY/);
  assert.throws(()=>f.control.start(f.identity.ownerId,'start-one',{...f.input,repository:{...f.input.repository,name:'different'}}),/IDEMPOTENCY_CONFLICT/);
  await f.control.drained();assert.equal(readTaskResult(f.db,f.identity.ownerId,task.id).state,'COMPLETED');
  assert.equal(c2.start(f.identity.ownerId,'start-one',f.input).id,task.id);assert.equal((f.db.prepare('SELECT count(*) n FROM charges').get() as {n:number}).n,3);
  assert.equal((f.db.prepare('SELECT count(*) n FROM model_calls').get() as {n:number}).n,4);
  assert.throws(()=>c2.lookup('foreign','start-one'),/NOT_FOUND/);reconcile(f.db);
 }finally{other.close();f.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('missing configuration, denied credit and failed request insertion create no task or obligation',()=>{
 const f=setup();try{
  assert.throws(()=>new MissionControl(f.db,undefined).start(f.identity.ownerId,'disabled',f.input),/LLM_CONFIGURATION_REQUIRED/);
  f.db.exec("CREATE TRIGGER fail_mission BEFORE INSERT ON mission_requests BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.throws(()=>f.control.start(f.identity.ownerId,'rollback',f.input),/injected/);
  assert.equal((f.db.prepare('SELECT count(*) n FROM tasks').get() as {n:number}).n,0);f.db.exec('DROP TRIGGER fail_mission');
  f.db.prepare('UPDATE accounts SET limit_minor=500').run();assert.throws(()=>f.control.start(f.identity.ownerId,'credit',f.input),/CREDIT_LIMIT/);
  for(const table of ['tasks','mission_requests','mission_leases','model_calls','charges'])assert.equal((f.db.prepare(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n,0);
  reconcile(f.db);
 }finally{f.db.close();}
});
test('explicit recovery fences expired workers, retains task deadline and creates each accepted charge once',async()=>{
 const f=setup();let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});
 const old=new MissionControl(f.db,missionHarness(f.db).factory,async(...args)=>{await blocked;return sourceFetcher(...args);});
 try{
  const task=old.start(f.identity.ownerId,'recovery',f.input);await new Promise<void>(resolve=>setImmediate(resolve));
  assert.throws(()=>f.control.resume(f.identity.ownerId,task.id,'busy-resume'),/MISSION_BUSY/);
  f.db.prepare('UPDATE mission_leases SET lease_until=0').run();
  f.control.resume(f.identity.ownerId,task.id,'owner-resume');await f.control.drained();release();await old.drained();
  const final=f.control.lookup(f.identity.ownerId,'recovery');assert.equal(final.id,task.id);assert.equal(final.deadlineAt,task.deadlineAt);assert.equal(final.status,'COMPLETED');
  assert.equal(readTaskResult(f.db,f.identity.ownerId,task.id).acceptedDeliveryIds.length,3);
  const calls=(f.db.prepare('SELECT count(*) n FROM model_calls').get() as {n:number}).n;
  f.control.resume(f.identity.ownerId,task.id,'terminal-replay');await f.control.drained();assert.equal((f.db.prepare('SELECT count(*) n FROM model_calls').get() as {n:number}).n,calls);reconcile(f.db);
 }finally{release();await old.drained();await f.control.drained();f.db.close();}
});
test('HTTP start requires session CSRF, strict schema and a pinned revision; polling never runs a model',async()=>{
 const f=setup(),token='mission-http-token-'.repeat(3);
 const config=readConfig({PAYPAL_CLIENT_ID:'fake',PAYPAL_CLIENT_SECRET:'fake',PAYPAL_MERCHANT_ID:'M',OWNER_TOKEN:token});
 const port={create:async()=>{throw new Error('PAYMENT_FORBIDDEN');},capture:async()=>{throw new Error('PAYMENT_FORBIDDEN');},inspect:async()=>{throw new Error('PAYMENT_FORBIDDEN');}};
 const server=createRuntimeApp(config,f.db,new Payments(f.db,port,'M','http://localhost'),undefined,f.control);server.listen(0,'127.0.0.1');await once(server,'listening');
 config.publicUrl=new URL(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
 const call=(path:string,options:RequestInit={})=>fetch(config.publicUrl.origin+path,options);
 try{
  assert.equal((await call('/api/missions/config')).status,401);
  const login=await call('/api/session',{method:'POST',headers:{Origin:config.publicUrl.origin,'Content-Type':'application/json'},body:JSON.stringify({ownerToken:token})});
  const cookie=login.headers.get('set-cookie')!.split(';')[0],grant=await login.json();
  const headers={Origin:config.publicUrl.origin,Cookie:cookie,'Content-Type':'application/json','Idempotency-Key':'http-start'};
  assert.equal((await call('/api/missions',{method:'POST',headers,body:JSON.stringify(f.input)})).status,403);
  const authenticated={...headers,'X-CSRF-Token':grant.csrfToken};
  assert.equal((await call('/api/missions',{method:'POST',headers:authenticated,body:JSON.stringify({...f.input,budgetMinor:999999})})).status,409);
  const result=await call('/api/missions',{method:'POST',headers:authenticated,body:JSON.stringify(f.input)});assert.equal(result.status,202);
  await f.control.drained();const task=await(await call('/api/mission-requests/http-start',{headers:{Cookie:cookie}})).json();assert.equal(task.status,'COMPLETED');
  assert.equal((f.db.prepare('SELECT count(*) n FROM tasks').get() as {n:number}).n,1);reconcile(f.db);
 }finally{f.control.stop();await f.control.drained();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));f.db.close();}
});

test('expired task recovery consumes no new model or source request and preserves its original bounds',async()=>{
 const f=setup();let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});
 const first=new MissionControl(f.db,missionHarness(f.db).factory,async(...args)=>{await blocked;return sourceFetcher(...args);});
 try{
  const task=first.start(f.identity.ownerId,'expire',f.input);await new Promise<void>(resolve=>setImmediate(resolve));
  f.db.prepare('UPDATE mission_leases SET lease_until=0').run();f.db.prepare('UPDATE tasks SET deadline_at=? WHERE id=?').run(Date.now()-1,task.id);
  const recovery=new MissionControl(f.db,()=>{throw new Error('MODEL_MUST_NOT_RUN');},async()=>{throw new Error('SOURCE_MUST_NOT_RUN');});
  recovery.resume(f.identity.ownerId,task.id,'expired-resume');await recovery.drained();release();await first.drained();
  assert.equal(recovery.lookup(f.identity.ownerId,'expire').status,'ACTION_REQUIRED');
  assert.equal((f.db.prepare('SELECT count(*) n FROM model_calls').get() as {n:number}).n,0);
  assert.throws(()=>f.db.exec("DELETE FROM mission_requests"),/APPEND_ONLY/);reconcile(f.db);
 }finally{release();await first.drained();f.db.close();}
});

test('version-seven procurement history survives the mission-control migration unchanged',async()=>{
 const {default:Database}=await import('better-sqlite3');const {migrations}=await import('../src/persistence/migrations.js');
 const {runMission}=await import('../src/application/missions.js');
 const directory=mkdtempSync(join(tmpdir(),'credence-v7-upgrade-')),path=join(directory,'history.sqlite');
 const old=new Database(path);for(const migration of migrations.filter(m=>m.version<=7))old.exec(migration.sql);old.pragma('user_version=7');
 const h=missionHarness(old);await runMission(old,h.factory,'Historical full review',repositoryInput,sourceFetcher,undefined,{profile:'full-review'});
 const tables=['accounts','tasks','charges','ledger_events','economic_audit','snapshots','procurement_plans'];
 const before=Object.fromEntries(tables.map(t=>[t,old.prepare(`SELECT * FROM ${t}`).all()]));old.close();
 const upgraded=openDatabase(path);try{
  assert.equal(upgraded.pragma('user_version',{simple:true}),8);
  for(const table of tables)assert.deepEqual(upgraded.prepare(`SELECT * FROM ${table}`).all(),before[table]);reconcile(upgraded);
 }finally{upgraded.close();rmSync(directory,{recursive:true,force:true});}
});
