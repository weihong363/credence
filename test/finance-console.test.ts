import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {paymentFixture} from './payment-harness.js';
import {readFinance} from '../src/application/finance.js';
import {reconcile} from '../src/application/lifecycle.js';
import {readConfig} from '../src/config.js';
import {createRuntimeApp} from '../src/runtime-http.js';
import {commandKey,freezeCommand,paymentCommand} from '../console/commands.js';
import {attemptFor} from '../src/application/payment-records.js';

test('finance projection preserves owner isolation, locked charges and sanitized authoritative receipts',async()=>{
 const f=await paymentFixture();try{
  const initial=readFinance(f.db,f.account.owner_id);assert.equal(initial.accounts[0].outstandingMinor,750);
  assert.equal(initial.charges.length,3);assert.ok(initial.charges.every(c=>!c.eligible));assert.equal(initial.batches[0].totalMinor,750);
  assert.deepEqual(readFinance(f.db,'other-owner'),{accounts:[],charges:[],batches:[]});
  await f.run('order');const attempted=readFinance(f.db,f.account.owner_id).batches[0];assert.equal(attempted.observedStatus,'CREATED');
  f.approve();await f.run('reconcile');assert.equal(readFinance(f.db,f.account.owner_id).batches[0].observedStatus,'APPROVED');
  await f.run('capture','test-capture');const settled=readFinance(f.db,f.account.owner_id);
  assert.equal(settled.batches[0].state,'SETTLED');assert.equal(settled.batches[0].receipt?.captureId,'CAPTURE1');assert.equal(settled.accounts[0].outstandingMinor,0);
  const attempt=attemptFor(f.db,f.batch.id)!;const json=JSON.stringify(settled);
  for(const secret of [attempt.capture_key,attempt.create_key,attempt.callback_hash,'payload_json','allocation_hash'])assert.ok(!json.includes(secret));
  const writes=(f.db.prepare('SELECT total_changes() n').get() as {n:number}).n;
  assert.deepEqual(readFinance(f.db,f.account.owner_id),settled);assert.equal((f.db.prepare('SELECT total_changes() n').get() as {n:number}).n,writes);reconcile(f.db);
 }finally{f.db.close();}
});
test('browser command identities survive reloads and preserve exact versions and selections',async()=>{
 const first=freezeCommand('account',['b','a']);assert.deepEqual(first,freezeCommand('account',['a','b']));
 assert.equal(await commandKey(first),await commandKey(freezeCommand('account',['a','b'])));
 assert.notEqual(await commandKey(first),await commandKey(freezeCommand('account',['a'])));
 assert.notEqual(await commandKey(paymentCommand('batch','capture',1)),await commandKey(paymentCommand('batch','capture',2)));
 assert.deepEqual(paymentCommand('batch','reconcile',3).body,{});assert.throws(()=>paymentCommand('batch','automatic',1));
});
test('cookie financial controls reject CSRF/stale commands and concurrent/replayed captures settle once',async()=>{
 const f=await paymentFixture(),token='finance-http-token-'.repeat(3);
 const config=readConfig({PAYPAL_CLIENT_ID:'fake',PAYPAL_CLIENT_SECRET:'fake',PAYPAL_MERCHANT_ID:'MERCHANT',OWNER_TOKEN:token});
 const server=createRuntimeApp(config,f.db,f.service());server.listen(0,'127.0.0.1');await once(server,'listening');
 config.publicUrl=new URL(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
 const call=(path:string,init:RequestInit={})=>fetch(config.publicUrl.origin+path,init);
 try{
  assert.equal((await call('/api/finance')).status,401);
  const login=await call('/api/session',{method:'POST',headers:{Origin:config.publicUrl.origin,'Content-Type':'application/json'},body:JSON.stringify({ownerToken:token})});
  const cookie=login.headers.get('set-cookie')!.split(';')[0],grant=await login.json();
  const send=async(command:ReturnType<typeof paymentCommand>,csrf=true)=>call(command.path,{method:'POST',headers:{Cookie:cookie,Origin:config.publicUrl.origin,'Content-Type':'application/json','Idempotency-Key':await commandKey(command),...(csrf?{'X-CSRF-Token':grant.csrfToken}:{})},body:JSON.stringify(command.body)});
  const order=paymentCommand(f.batch.id,'order',0);assert.equal((await send(order,false)).status,403);assert.equal(f.calls.create,0);
  assert.equal((await send(order)).status,200);f.approve();await send(paymentCommand(f.batch.id,'reconcile',0));
  const version=f.service().view(f.account.owner_id,f.batch.id).batch.version;
  assert.equal((await send(paymentCommand(f.batch.id,'capture',999))).status,409);assert.equal(f.calls.capture,0);
  const capture=paymentCommand(f.batch.id,'capture',version);
  const responses=await Promise.all([send(capture),send(capture)]);assert.ok(responses.some(r=>r.status===200));
  assert.equal((await send(capture)).status,200);assert.equal(f.calls.capture,1);assert.equal(f.calls.create,1);
  const view=await(await call('/api/finance',{headers:{Cookie:cookie}})).json();assert.equal(view.batches[0].state,'SETTLED');
  assert.equal((f.db.prepare("SELECT count(*) n FROM ledger_events WHERE type='PAYMENT_CONFIRMED'").get() as {n:number}).n,1);reconcile(f.db);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));f.db.close();}
});
test('decline, cancellation and lost capture never display an unverified settlement',async()=>{
 for(const scenario of ['decline','cancel','lost'] as const){
  const f=await paymentFixture();try{
   await f.run('order');f.approve();
   if(scenario==='cancel')await f.run('cancel');else if(scenario==='decline')f.state.decline=true;else f.state.lostCapture=true;
   await f.run('capture');let view=readFinance(f.db,f.account.owner_id).batches[0];assert.equal(view.receipt,null);assert.notEqual(view.state,'SETTLED');
   assert.ok(readFinance(f.db,f.account.owner_id).charges.every(c=>!c.eligible));
   if(scenario==='lost'){await f.run('reconcile');view=readFinance(f.db,f.account.owner_id).batches[0];assert.equal(view.state,'SETTLED');assert.equal(f.calls.capture,1);}
   reconcile(f.db);
  }finally{f.db.close();}
 }
});

test('concurrent browser freeze requests allocate a fresh charge set once and retain ledger batch lineage',async()=>{
 const f=await paymentFixture();try{
  const {setAccountLimit}=await import('../src/application/policy.js');
  const {runMission}=await import('../src/application/missions.js');
  const {missionHarness,repositoryInput,sourceFetcher}=await import('./mission-harness.js');
  const {freezeBatch}=await import('../src/application/batches.js');
  const {readLedger}=await import('../src/application/read-model.js');
  setAccountLimit(f.db,f.account.owner_id,f.account.id,1500);const h=missionHarness(f.db);
  await runMission(f.db,h.factory,'second mock review',repositoryInput,sourceFetcher,undefined,{profile:'full-review'});
  const charges=readFinance(f.db,f.account.owner_id).charges.filter(c=>c.eligible).map(c=>c.id);assert.equal(charges.length,3);
  const command=freezeCommand(f.account.id,charges),key=await commandKey(command);
  const request={ownerId:f.account.owner_id,accountId:f.account.id,chargeIds:charges,key};
  const batches=await Promise.all([Promise.resolve().then(()=>freezeBatch(f.db,'MERCHANT',request)),Promise.resolve().then(()=>freezeBatch(f.db,'MERCHANT',request))]);
  assert.equal(batches[0].id,batches[1].id);assert.equal(readFinance(f.db,f.account.owner_id).batches.length,2);
  assert.ok(readFinance(f.db,f.account.owner_id).charges.every(c=>!c.eligible));
  assert.throws(()=>freezeBatch(f.db,'MERCHANT',{...request,key:'another-key'}),/CHARGE_NOT_ELIGIBLE/);
  const ledger=readLedger(f.db,f.account.owner_id,f.account.id,{afterSeq:0,limit:100});
  assert.ok(ledger.entries.items.filter(e=>e.type==='SETTLEMENT_ALLOCATED').every(e=>!!e.batchId));reconcile(f.db);
 }finally{f.db.close();}
});
