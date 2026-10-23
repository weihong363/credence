import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {paymentFixture} from './payment-harness.js';
import {openDatabase} from '../src/persistence/database.js';
import {Payments} from '../src/application/payments.js';
import {reconcile} from '../src/application/lifecycle.js';
import {freezeBatch} from '../src/application/batches.js';
import {attemptFor} from '../src/application/payment-records.js';

test('durable recovery after reopen uses GET only, including a stale lease left by a dead worker',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'credence-payment-reopen-'));const path=join(dir,'db.sqlite');const f=await paymentFixture(path);
 await f.run('order');f.approve();f.state.lostCapture=true;await f.run('capture');
 const attempt=attemptFor(f.db,f.batch.id)!;f.db.prepare('UPDATE payment_attempts SET lease_token=?,lease_until=? WHERE id=?').run('dead-worker',f.clock()+180000,attempt.id);
 const receiptCount=()=>f.db.prepare('SELECT count(*) n FROM settlement_receipts').get() as {n:number};assert.equal(receiptCount().n,0);f.db.close();
 const db=openDatabase(path);try{
  const service=new Payments(db,f.port,'MERCHANT','http://localhost:3001',()=>f.clock());
  await assert.rejects(service.run(f.account.owner_id,f.batch.id,'reconcile','before-lease'),/PAYMENT_IN_PROGRESS/);
  f.advance(180001);await service.recover();assert.equal(service.view(f.account.owner_id,f.batch.id).batch.state,'SETTLED');
  assert.equal(f.calls.capture,1);assert.equal(f.calls.create,1);reconcile(db);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('two independent processes reconcile one completed provider capture with one local confirmation',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'credence-payment-race-'));const path=join(dir,'db.sqlite');const f=await paymentFixture(path);
 await f.run('order');f.status('COMPLETED');
 const children=['first','second'].map(key=>fork(new URL('../scripts/payment-contender.ts',import.meta.url),[],{execArgv:['--import','tsx'],stdio:['ignore','ignore','inherit','ipc'],env:{...process.env,CREDIT_TEST_PATH:path,CREDIT_TEST_REQUEST:JSON.stringify({ownerId:f.account.owner_id,batchId:f.batch.id,key,observation:f.observation()})}}));
 try{
  await Promise.all(children.map(child=>once(child,'message')));
  const results=children.map(child=>once(child,'message')),exits=children.map(child=>once(child,'exit'));children.forEach(child=>child.send('go'));
  const values=(await Promise.all(results)).map(([value])=>value);assert.ok(values.includes('SETTLED'));assert.ok(values.every(value=>['SETTLED','PAYMENT_IN_PROGRESS'].includes(String(value))));await Promise.all(exits);
  assert.equal((f.db.prepare('SELECT count(*) n FROM settlement_receipts').get() as {n:number}).n,1);
  assert.equal((f.db.prepare("SELECT count(*) n FROM ledger_events WHERE type='PAYMENT_CONFIRMED'").get() as {n:number}).n,1);reconcile(f.db);
 }finally{children.forEach(child=>child.kill());f.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('version-six frozen allocations and immutable ledger payloads survive payment migration',async()=>{
 const {default:Database}=await import('better-sqlite3');const {migrations}=await import('../src/persistence/migrations.js');
 const {setupRuntime,analysisResult}=await import('./runtime-fixture.js');const {claim}=await import('../src/application/lifecycle.js');const {completeDelivery}=await import('../src/application/deliveries.js');
 const dir=mkdtempSync(join(tmpdir(),'credence-payment-v6-')),path=join(dir,'db.sqlite');const f=setupRuntime('repo.architecture',path);
 completeDelivery(f.db,claim(f.db,100)!,analysisResult(f.snapshot),101);
 const id=(f.db.prepare('SELECT id FROM charges').get() as {id:string}).id;
 // Construct an authentic v6 schema from its migrations, then transfer the P1 foundation before freezing.
 const proof=(f.db.prepare("SELECT sql FROM sqlite_master WHERE name='charge_requires_evidence'").get() as {sql:string}).sql;
 const batch=freezeBatch(f.db,'MERCHANT',{...f.context,key:'old-batch',chargeIds:[id]});
 const oldPath=join(dir,'old.sqlite'),old=new Database(oldPath);old.pragma('foreign_keys=ON');
 for(const migration of migrations.filter(item=>item.version<=6))old.exec(migration.sql);
 old.pragma('foreign_keys=OFF');
 for(const table of ['owners','agents','accounts','tasks','capabilities','snapshots','quotes','purchases','reservations','ledger_events','economic_audit','invocations','deliveries','verifications','charges','batches','allocations','batch_requests']){
  const columns=(old.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(row=>row.name);
  const rows=f.db.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all() as Record<string,unknown>[];
  if(table==='charges')old.exec('DROP TRIGGER charge_requires_evidence');
  for(const row of rows)old.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(column=>row[column]));
 }
 f.db.close();old.exec(proof);old.pragma('foreign_keys=ON');
 const history=old.prepare('SELECT * FROM ledger_events').all();old.pragma('user_version=6');old.close();
 const upgraded=openDatabase(oldPath);try{
  assert.equal((upgraded.prepare('SELECT * FROM batches WHERE id=?').get(batch.id) as {total_minor:number}).total_minor,250);
  assert.deepEqual(upgraded.prepare('SELECT * FROM ledger_events').all(),history.map(row=>({...row as object,charge_id:null,batch_id:null})));
  assert.equal(upgraded.pragma('foreign_keys',{simple:true}),1);reconcile(upgraded);
 }finally{upgraded.close();rmSync(dir,{recursive:true,force:true});}
});

test('worker process death after capture intent leaves durable uncertainty and recovers once by GET',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'credence-payment-crash-'));const path=join(dir,'db.sqlite');const f=await paymentFixture(path);await f.run('order');
 const child=fork(new URL('../scripts/payment-crash.ts',import.meta.url),[],{execArgv:['--import','tsx'],stdio:['ignore','ignore','inherit','ipc'],env:{...process.env,CREDIT_TEST_PATH:path,CREDIT_TEST_REQUEST:JSON.stringify({ownerId:f.account.owner_id,batchId:f.batch.id,observation:f.observation()})}});
 try{
  const [code]=await once(child,'exit');assert.equal(code,0);
  const attempt=attemptFor(f.db,f.batch.id)!;assert.equal(attempt.capture_attempts,1);assert.ok(attempt.capture_started_at);
  assert.equal(f.service().view(f.account.owner_id,f.batch.id).receipt,null);
  f.advance(181000);f.status('COMPLETED');await f.service().recover();
  assert.equal(f.service().view(f.account.owner_id,f.batch.id).batch.state,'SETTLED');assert.equal(f.calls.capture,0);reconcile(f.db);
 }finally{child.kill();f.db.close();rmSync(dir,{recursive:true,force:true});}
});
