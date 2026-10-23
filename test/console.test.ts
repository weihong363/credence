import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {paymentFixture} from './payment-harness.js';
import {readActivity} from '../src/application/activity.js';
import {createRuntimeApp} from '../src/runtime-http.js';
import {readConfig} from '../src/config.js';

test('activity projection is owner-scoped, consistent and excludes raw provider/payment data',async()=>{
 const f=await paymentFixture();try{
  const task=(f.db.prepare('SELECT id FROM tasks').get() as {id:string}).id;
  const writes=(f.db.prepare('SELECT total_changes() n').get() as {n:number}).n;
  const result=readActivity(f.db,f.account.owner_id,task);
  assert.equal(result.purchases.length,3);assert.equal(result.plan.length,3);assert.equal(result.deliveries.length,3);
  assert.ok(result.purchases.every(p=>p.status==='ACCEPTED'&&p.reservationState==='CONSUMED'));
  assert.ok(result.deliveries.some(d=>d.evidence.length>0));
  assert.throws(()=>readActivity(f.db,'other-owner',task),/TASK_NOT_FOUND/);
  assert.equal((f.db.prepare('SELECT total_changes() n').get() as {n:number}).n,writes);
  const json=JSON.stringify(result);
  for(const key of ['output_json','input_hash','output_hash','lease_token','request_key','result_json'])assert.ok(!json.includes(key));
  assert.deepEqual(readActivity(f.db,f.account.owner_id,task),result);
 }finally{f.db.close();}
});
test('console serves only built allowlisted assets, retains API auth and protects evidence route',async()=>{
 const f=await paymentFixture(),token='console-test-token-'.repeat(3);
 const config=readConfig({PAYPAL_CLIENT_ID:'fake',PAYPAL_CLIENT_SECRET:'secret-canary-never-in-ui',PAYPAL_MERCHANT_ID:'MERCHANT',OWNER_TOKEN:token});
 const server=createRuntimeApp(config,f.db,f.service());server.listen(0,'127.0.0.1');await once(server,'listening');
 config.publicUrl=new URL(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
 const call=(path:string,init:RequestInit={})=>fetch(config.publicUrl.origin+path,init);
 try{
  const page=await call('/');assert.equal(page.status,200);const html=await page.text();assert.match(html,/Every capability has a trail/);
  assert.match(page.headers.get('content-security-policy')!,/script-src 'self'/);assert.ok(!html.includes(token));assert.ok(!html.includes(config.clientSecret));
  const script=html.match(/src="([^\"]+\.js)"/)![1];const asset=await call(script);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type')!,/javascript/);
  assert.equal((await call('/',{headers:{Origin:'https://other.invalid'}})).status,403);
  for(const path of ['/.env','/assets/unknown.js','/assets/main.js.map','/dist/server.js','/api/tasks'])assert.notEqual((await call(path)).status,200);
  const task=(f.db.prepare('SELECT id FROM tasks').get() as {id:string}).id;
  assert.equal((await call(`/api/tasks/${task}/activity`)).status,401);
  const headers={Authorization:`Bearer ${token}`};const activity=await call(`/api/tasks/${task}/activity`,{headers});assert.equal(activity.status,200);
  assert.equal((await activity.json()).purchases.length,3);
  assert.equal((await call(`/api/tasks/${task}/activity?unexpected=1`,{headers})).status,400);
  assert.equal((await call('/api/tasks/00000000-0000-0000-0000-000000000000/activity',{headers})).status,404);
  assert.equal((await call(`/api/tasks/${task}/result`)).status,401);
  const report=await call(`/api/tasks/${task}/result`,{headers});assert.equal(report.status,200);assert.equal((await report.json()).state,'COMPLETED');
  assert.equal((await call(`/api/tasks/${task}/result?raw=true`,{headers})).status,400);
  assert.equal(f.calls.create,0);assert.equal(f.calls.capture,0);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));f.db.close();}
});
