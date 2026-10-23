import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paymentFixture} from './payment-harness.js';
import {reconcile} from '../src/application/lifecycle.js';
import {freezeBatch} from '../src/application/batches.js';
import {reverseCharge} from '../src/application/payment-finalization.js';
import {Payments} from '../src/application/payments.js';
import {paymentView} from '../src/application/payment-records.js';
const count=(f:Awaited<ReturnType<typeof paymentFixture>>,table:string)=>(f.db.prepare(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n;
test('accepted procurement charges settle once using fresh GET, restore allowance and retain task lifetime spending',async()=>{
 const f=await paymentFixture();try{
  await f.run('order');f.approve();const result=await f.run('capture');
  assert.equal(result.batch.state,'SETTLED');assert.equal(result.receipt?.capture_id,'CAPTURE1');
  assert.equal(count(f,'settlement_receipts'),1);assert.equal(f.calls.capture,1);reconcile(f.db);
  const balance=f.db.prepare('SELECT outstanding_minor FROM accounts').get() as {outstanding_minor:number};assert.equal(balance.outstanding_minor,0);
  assert.equal((f.db.prepare('SELECT spent_minor FROM tasks').get() as {spent_minor:number}).spent_minor,750);
  const receipt=result.receipt;
  for(const action of ['capture','order','cancel','resume','reconcile'] as const)assert.deepEqual((await f.run(action,`repeat-${action}`)).receipt,receipt);
  assert.equal(f.calls.create,1);assert.equal(f.calls.capture,1);reconcile(f.db);
 }finally{f.db.close();}
});
test('lost create response replays the same durable key/input; new keys cannot rebatch UNKNOWN obligations',async()=>{
 const f=await paymentFixture();try{
  f.state.lostCreate=true;assert.equal((await f.run('order')).batch.state,'UNKNOWN');
  assert.throws(()=>freezeBatch(f.db,'MERCHANT',{...f.request,key:'other'}),/CHARGE_NOT_ELIGIBLE/);
  f.advance(31000);f.state.lostCreate=false;await f.run('order','another-key');
  assert.equal(new Set(f.calls.createKeys).size,1);assert.equal(count(f,'payment_attempts'),1);reconcile(f.db);
 }finally{f.db.close();}
});
test('lost capture response and restarted service reconcile completed capture without another POST',async()=>{
 const f=await paymentFixture();try{
  await f.run('order');f.approve();f.state.lostCapture=true;
  assert.equal((await f.run('capture')).batch.state,'UNKNOWN');assert.equal(count(f,'settlement_receipts'),0);
  const result=await f.service().run(f.account.owner_id,f.batch.id,'capture','retry');
  assert.equal(result.batch.state,'SETTLED');assert.equal(f.calls.capture,1);reconcile(f.db);
 }finally{f.db.close();}
});
test('cancel before order/capture, duplicate hints and explicit approved resume preserve the original attempt',async()=>{
 const f=await paymentFixture();try{
  await f.run('order');f.approve();await f.run('cancel');await f.run('capture');assert.equal(f.calls.capture,0);
  assert.equal((await f.run('resume')).batch.cancel_latched,0);
  await f.run('cancel','new-cancel');await f.run('resume');assert.equal(paymentView(f.db,f.account.owner_id,f.batch.id).batch.cancel_latched,1);
  await f.run('resume','new-resume');await f.run('capture','after-resume');assert.equal(f.calls.capture,1);reconcile(f.db);
 }finally{f.db.close();}
 const before=await paymentFixture();try{await before.run('cancel');await before.run('order');assert.equal(before.calls.create,0);}finally{before.db.close();}
});
test('cancellation while approval GET is running prevents capture intent; later cancel cannot erase actual capture',async()=>{
 const f=await paymentFixture();try{
  await f.run('order');f.approve();const inspect=f.port.inspect;
  f.port.inspect=async id=>{await f.run('cancel');return inspect(id);};await f.run('capture');assert.equal(f.calls.capture,0);
 }finally{f.db.close();}
 const after=await paymentFixture();try{
  await after.run('order');after.approve();const capture=after.port.capture;
  after.port.capture=async(id,key)=>{await after.run('cancel');await capture(id,key);};
  assert.equal((await after.run('capture')).batch.state,'SETTLED');reconcile(after.db);
 }finally{after.db.close();}
});
test('pending/decline/unknown and mismatched API observations never clear outstanding',async()=>{
 for(const mode of ['pending','decline','invalid','unknown'] as const){
  const f=await paymentFixture();try{
   await f.run('order');f.approve();if(mode==='unknown')f.status('UNKNOWN');else f.state[mode]=true;
   const result=await f.run('capture');assert.equal(result.receipt,null);
   assert.equal((f.db.prepare('SELECT outstanding_minor n FROM accounts').get() as {n:number}).n,750);reconcile(f.db);
  }finally{f.db.close();}
 }
});
test('business uniqueness, owner checks, command payload conflicts and cross-instance leases prevent duplicate mutation',async()=>{
 const f=await paymentFixture();try{
  await assert.rejects(f.service().run('wrong-owner',f.batch.id,'order','x'),/BATCH_FORBIDDEN/);
  let unblock!:()=>void;const gate=new Promise<void>(resolve=>{unblock=resolve;});const create=f.port.create;
  f.port.create=async(input,key)=>{await gate;return create(input,key);};
  const first=f.run('order');await assert.rejects(f.service().run(f.account.owner_id,f.batch.id,'order','competing'),/PAYMENT_IN_PROGRESS/);
  unblock();await first;assert.equal(f.calls.create,1);
  await assert.rejects(f.run('cancel','order'),/IDEMPOTENCY_CONFLICT/);
 }finally{f.db.close();}
});
test('expired mutation retention and exhausted budgets permit GET only and keep IDs/charges locked',async()=>{
 const f=await paymentFixture();try{
  f.state.lostCreate=true;await f.run('order');f.advance(5*3600000+1);await f.run('order','stale');assert.equal(f.calls.create,1);
  assert.equal(f.service().view(f.account.owner_id,f.batch.id).batch.state,'ACTION_REQUIRED');reconcile(f.db);
 }finally{f.db.close();}
 const capture=await paymentFixture();try{
  await capture.run('order');capture.approve();capture.state.decline=true;
  for(let i=0;i<4;i++){capture.advance(31000);await capture.run('capture',`decline-${i}`);}
  assert.equal(capture.calls.capture,3);assert.equal(count(capture,'settlement_receipts'),0);reconcile(capture.db);
 }finally{capture.db.close();}
});
test('every finalization write rolls back atomically and a later GET completes once',async()=>{
 for(const [table,operation,condition] of [
 ['settlement_receipts','INSERT','1'],['ledger_events','INSERT',"NEW.type='PAYMENT_CONFIRMED'"],
 ['ledger_events','INSERT',"NEW.type='CHARGE_SETTLED'"],['allocations','UPDATE',"NEW.state='SETTLED'"],
 ['accounts','UPDATE','NEW.outstanding_minor<OLD.outstanding_minor'],['batches','UPDATE',"NEW.state='SETTLED'"],
 ['economic_audit','INSERT',"NEW.action='PAYMENT_SETTLED'"],
 ]){
  const f=await paymentFixture();try{
   await f.run('order');f.approve();f.db.exec(`CREATE TRIGGER fail_final BEFORE ${operation} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(ABORT,'INJECTED'); END`);
   const result=await f.run('capture');assert.equal(result.receipt,null);assert.equal(count(f,'settlement_receipts'),0);reconcile(f.db);
   f.db.exec('DROP TRIGGER fail_final');assert.equal((await f.run('reconcile')).batch.state,'SETTLED');assert.equal(f.calls.capture,1);reconcile(f.db);
  }finally{f.db.close();}
 }
});
test('wrong order, amount, currency, batch, invoice and capture identity cannot finalize',async()=>{
 for(const mutate of [(o:any)=>o.orderId='WRONG',(o:any)=>o.minor=749,(o:any)=>o.currency='EUR',
  (o:any)=>o.batchId='wrong',(o:any)=>o.invoiceId='wrong',(o:any)=>o.capture.minor=1]){
  const f=await paymentFixture();try{
   await f.run('order');f.status('COMPLETED');const inspect=f.port.inspect;
   f.port.inspect=async id=>{const o=await inspect(id);mutate(o);return o;};
   assert.equal((await f.run('reconcile')).receipt,null);reconcile(f.db);
  }finally{f.db.close();}
 }
});
test('unallocated pre-payment reversal is append-only, replay-safe and excluded from later batches',async()=>{
 const f=await paymentFixture();try{assert.throws(()=>reverseCharge(f.db,f.account.owner_id,f.chargeIds[0],'correction'),/ALLOCATED_CHARGE_LOCKED/);}finally{f.db.close();}
 // A second task has an independent accepted charge, without allocating it.
 const {setupRuntime,analysisResult}=await import('./runtime-fixture.js');const {claim}=await import('../src/application/lifecycle.js');const {completeDelivery}=await import('../src/application/deliveries.js');
 const g=setupRuntime();try{
  completeDelivery(g.db,claim(g.db,100)!,analysisResult(g.snapshot),101);
  const id=(g.db.prepare('SELECT id FROM charges').get() as {id:string}).id;
  reverseCharge(g.db,g.context.ownerId,id,'invalidated by owner',102);reverseCharge(g.db,g.context.ownerId,id,'invalidated by owner',103);
  assert.equal((g.db.prepare('SELECT outstanding_minor n FROM accounts').get() as {n:number}).n,0);
  assert.throws(()=>freezeBatch(g.db,'MERCHANT',{ownerId:g.context.ownerId,accountId:g.context.accountId,key:'bad',chargeIds:[id]}),/CHARGE_NOT_ELIGIBLE/);reconcile(g.db);
 }finally{g.db.close();}
});

test('successful capture POST cannot settle when the independent GET still reports approval',async()=>{
 const f=await paymentFixture();try{
  await f.run('order');f.approve();f.port.capture=async()=>{f.calls.capture++;};
  assert.equal((await f.run('capture')).receipt,null);
  assert.equal((f.db.prepare('SELECT outstanding_minor n FROM accounts').get() as {n:number}).n,750);reconcile(f.db);
 }finally{f.db.close();}
});
test('reversal projection/audit failures roll back and settled allocations cannot be reversed',async()=>{
 const {setupRuntime,analysisResult}=await import('./runtime-fixture.js');const {claim}=await import('../src/application/lifecycle.js');const {completeDelivery}=await import('../src/application/deliveries.js');
 const f=setupRuntime();try{
  completeDelivery(f.db,claim(f.db,100)!,analysisResult(f.snapshot),101);const id=(f.db.prepare('SELECT id FROM charges').get() as {id:string}).id;
  f.db.exec("CREATE TRIGGER reversal_failure BEFORE INSERT ON economic_audit WHEN NEW.action LIKE 'CHARGE_REVERSED:%' BEGIN SELECT RAISE(ABORT,'INJECTED'); END");
  assert.throws(()=>reverseCharge(f.db,f.context.ownerId,id,'correction'),/INJECTED/);
  assert.equal((f.db.prepare('SELECT outstanding_minor n FROM accounts').get() as {n:number}).n,250);reconcile(f.db);
 }finally{f.db.close();}
 const paid=await paymentFixture();try{await paid.run('order');paid.approve();await paid.run('capture');assert.throws(()=>reverseCharge(paid.db,paid.account.owner_id,paid.chargeIds[0],'correction'),/ALLOCATED_CHARGE_LOCKED/);reconcile(paid.db);}finally{paid.db.close();}
});

test('reconciliation rejects missing settlement journal and projection drift after a receipt exists',async()=>{
 const f=await paymentFixture();try{
  await f.run('order');f.approve();await f.run('capture');reconcile(f.db);
  f.db.exec("UPDATE accounts SET outstanding_minor=1");assert.throws(()=>reconcile(f.db),/RECONCILIATION_MISMATCH/);
  f.db.exec("UPDATE accounts SET outstanding_minor=0; DROP TRIGGER ledger_events_no_delete; DELETE FROM ledger_events WHERE type='CHARGE_SETTLED'");
  assert.throws(()=>reconcile(f.db),/PAYMENT_RECONCILIATION_MISMATCH/);
 }finally{f.db.close();}
});
