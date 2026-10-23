import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {paymentFixture} from './payment-harness.js';
import {createRuntimeApp} from '../src/runtime-http.js';
import {readConfig} from '../src/config.js';
import {reconcile} from '../src/application/lifecycle.js';
import {attemptFor} from '../src/application/payment-records.js';
import {paymentHint} from '../src/application/payment-callbacks.js';
import type {PaymentInput} from '../src/payments/port.js';
test('owner API enforces auth/origin/schema/version, archives P0, and never trusts callbacks as payment',async()=>{
 const f=await paymentFixture(),token='owner-secret-'.repeat(4);
 const config=readConfig({PAYPAL_CLIENT_ID:'fake',PAYPAL_CLIENT_SECRET:'never-public',PAYPAL_MERCHANT_ID:'MERCHANT',OWNER_TOKEN:token});
 const server=createRuntimeApp(config,f.db,f.service());server.listen(0,'127.0.0.1');await once(server,'listening');
 const port=(server.address() as {port:number}).port;config.publicUrl=new URL(`http://127.0.0.1:${port}`);
 const call=(path:string,init:RequestInit={})=>fetch(`${config.publicUrl.origin}${path}`,{...init,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...init.headers}});
 try{
  assert.equal((await call('/api/economy',{headers:{Authorization:'Bearer wrong'}})).status,401);
  assert.equal((await call('/api/economy',{headers:{Origin:'https://other.example'}})).status,403);
  assert.equal((await call('/api/create',{method:'POST'})).status,410);
  const url=`/api/batches/${f.batch.id}`;
  assert.equal((await call(`${url}/order`,{method:'POST',body:'{"amount":1}',headers:{'Idempotency-Key':'bad'}})).status,409);
  assert.equal((await call(`${url}/order`,{method:'POST',body:'{}',headers:{'Idempotency-Key':'order'}})).status,200);
  f.approve();
  assert.equal((await call(`${url}/capture`,{method:'POST',body:'{"expectedVersion":999}',headers:{'Idempotency-Key':'stale'}})).status,409);
  const attempt=attemptFor(f.db,f.batch.id)!;const input=JSON.parse(attempt.input_json) as PaymentInput;
  const callback=new URL(input.returnUrl);callback.searchParams.set('token','ORDER1');
  assert.equal((await call(`${callback.pathname}${callback.search}`)).status,200);
  assert.equal(f.service().view(f.account.owner_id,f.batch.id).receipt,null);assert.equal(f.calls.capture,0);
  assert.equal((await call(`${url}/capture`,{method:'POST',body:JSON.stringify({expectedVersion:f.service().view(f.account.owner_id,f.batch.id).batch.version}),headers:{'Idempotency-Key':'capture'}})).status,200);
  const response=JSON.stringify(await(await call(url)).json());
  for(const secret of [token,'never-public',attempt.create_key,attempt.capture_key,attempt.callback_hash])assert.ok(!response.includes(secret));
  reconcile(f.db);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));f.db.close();}
});
test('callback state is one-time, binds order and cannot clear a cancellation latch',async()=>{
 const f=await paymentFixture();try{
  await f.run('order');const attempt=attemptFor(f.db,f.batch.id)!,input=JSON.parse(attempt.input_json) as PaymentInput;
  const state=new URL(input.cancelUrl).searchParams.get('state')!;
  assert.throws(()=>paymentHint(f.db,f.batch.id,'wrong','ORDER1','cancel'),/CALLBACK_FORBIDDEN/);
  assert.throws(()=>paymentHint(f.db,f.batch.id,state,'WRONG','cancel'),/CALLBACK_FORBIDDEN/);
  paymentHint(f.db,f.batch.id,state,'ORDER1','cancel');paymentHint(f.db,f.batch.id,state,'ORDER1','return');
  assert.equal(f.service().view(f.account.owner_id,f.batch.id).batch.cancel_latched,1);
  const hints=f.db.prepare("SELECT count(*) n FROM economic_audit WHERE action LIKE 'BUYER_%_HINT'").get() as {n:number};assert.equal(hints.n,1);
  f.approve();await f.run('capture');assert.equal(f.calls.capture,0);reconcile(f.db);
 }finally{f.db.close();}
});
