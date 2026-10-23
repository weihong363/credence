import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {paymentFixture} from './payment-harness.js';
import {readConfig} from '../src/config.js';
import {createRuntimeApp} from '../src/runtime-http.js';
import {OwnerSessions,SESSION_LIFETIME_MS} from '../src/web/sessions.js';
import {reconcile} from '../src/application/lifecycle.js';
async function fixture(){
 const f=await paymentFixture(),token='owner-http-session-'.repeat(3);let now=Date.now();
 const config=readConfig({PAYPAL_CLIENT_ID:'fake',PAYPAL_CLIENT_SECRET:'server-only-secret',PAYPAL_MERCHANT_ID:'MERCHANT',OWNER_TOKEN:token});
 const sessions=new OwnerSessions(token,false,()=>now),server=createRuntimeApp(config,f.db,f.service(),sessions);
 server.listen(0,'127.0.0.1');await once(server,'listening');config.publicUrl=new URL(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
 const call=(path:string,init:RequestInit={})=>fetch(`${config.publicUrl.origin}${path}`,{...init,headers:{'Content-Type':'application/json',...init.headers}});
 const login=async()=>{
  const response=await call('/api/session',{method:'POST',headers:{Origin:config.publicUrl.origin},body:JSON.stringify({ownerToken:token})});assert.equal(response.status,200);
  return {response,cookie:response.headers.get('set-cookie')!.split(';')[0],...await response.json() as {csrfToken:string;expiresAt:number}};
 };
 const close=async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));f.db.close();};
 return {...f,token,config,call,login,close,advance:(ms:number)=>{now+=ms;}};
}
test('browser login requires same Origin and never returns configured credentials, session cookie is HttpOnly',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call('/api/session',{method:'POST',body:JSON.stringify({ownerToken:f.token})})).status,403);
  assert.equal((await f.call('/api/session',{method:'POST',headers:{Origin:'https://attacker.example'},body:JSON.stringify({ownerToken:f.token})})).status,403);
  assert.equal((await f.call('/api/session',{method:'POST',headers:{Origin:f.config.publicUrl.origin},body:JSON.stringify({ownerToken:'invalid credential'})})).status,401);
  const login=await f.login();assert.match(login.response.headers.get('set-cookie')!,/HttpOnly; SameSite=Strict/);
  assert.ok(!JSON.stringify({cookie:login.cookie,csrfToken:login.csrfToken}).includes(f.token));
  const response=await f.call('/api/session',{headers:{Cookie:login.cookie}});assert.equal(response.status,200);
  const body=await response.text();assert.ok(body.includes(login.csrfToken));assert.ok(!body.includes(f.token));assert.ok(!body.includes(login.cookie.split('=')[1]));
  assert.equal((await f.call('/api/tasks',{headers:{Cookie:login.cookie}})).status,200);
  assert.equal((await f.call('/api/economy',{headers:{Cookie:login.cookie,Authorization:'Bearer invalid'}})).status,401);
  assert.equal((await f.call('/api/session/logout',{method:'GET',headers:{Cookie:login.cookie}})).status,405);
 }finally{await f.close();}
});
test('session CSRF blocks financial requests before writes; Bearer CLI and authenticated session both work',async()=>{
 const f=await fixture();try{
  const login=await f.login(),path=`/api/batches/${f.batch.id}/cancel`,body=JSON.stringify({expectedVersion:0});
  const writes=(f.db.prepare('SELECT total_changes() n').get() as {n:number}).n;
  const cases:Record<string,string>[]=[{},{Origin:f.config.publicUrl.origin},{Origin:'https://attacker.example','X-CSRF-Token':login.csrfToken},{Origin:f.config.publicUrl.origin,'X-CSRF-Token':'wrong'}];
  for(const extra of cases){
   const response=await f.call(path,{method:'POST',headers:{Cookie:login.cookie,'Idempotency-Key':'csrf-test',...extra},body});assert.equal(response.status,403);
  }
  assert.equal((f.db.prepare('SELECT total_changes() n').get() as {n:number}).n,writes);assert.equal(f.calls.create,0);assert.equal(f.calls.capture,0);
  const cancel=await f.call(path,{method:'POST',headers:{Cookie:login.cookie,Origin:f.config.publicUrl.origin,'X-CSRF-Token':login.csrfToken,'Idempotency-Key':'allowed-cancel'},body});
  assert.equal(cancel.status,200);assert.equal((await cancel.json()).batch.state,'CANCELLED');
  assert.equal((await f.call('/api/tasks',{headers:{Authorization:`Bearer ${f.token}`}})).status,200);reconcile(f.db);
 }finally{await f.close();}
});
test('logout, expiry and login rotation invalidate old cookies without touching the economic ledger',async()=>{
 const f=await fixture();try{
  const login=await f.login();
  const next=await f.call('/api/session',{method:'POST',headers:{Cookie:login.cookie,Origin:f.config.publicUrl.origin},body:JSON.stringify({ownerToken:f.token})});
  assert.equal(next.status,200);const cookie=next.headers.get('set-cookie')!.split(';')[0],body=await next.json();
  assert.equal((await f.call('/api/economy',{headers:{Cookie:login.cookie}})).status,401);
  assert.equal((await f.call('/api/session/logout',{method:'POST',headers:{Cookie:cookie,Origin:f.config.publicUrl.origin,'X-CSRF-Token':body.csrfToken}})).status,200);
  assert.equal((await f.call('/api/economy',{headers:{Cookie:cookie}})).status,401);
  const expiring=await f.login();f.advance(SESSION_LIFETIME_MS);
  assert.equal((await f.call('/api/economy',{headers:{Cookie:expiring.cookie}})).status,401);
  assert.equal((f.db.prepare('SELECT outstanding_minor n FROM accounts').get() as {n:number}).n,750);reconcile(f.db);
 }finally{await f.close();}
});
test('read routes validate pagination and ownership, provide incremental task/audit/ledger views and exclude private fields',async()=>{
 const f=await fixture();try{
  const login=await f.login(),headers={Cookie:login.cookie};
  const tasks=await(await f.call('/api/tasks?limit=1',{headers})).json();assert.equal(tasks.items.length,1);const id=tasks.items[0].id;
  const audit=await(await f.call(`/api/tasks/${id}/events?limit=2`,{headers})).json();assert.equal(audit.items.length,2);assert.equal(audit.nextSeq,audit.items[1].seq);
  const next=await(await f.call(`/api/tasks/${id}/events?afterSeq=${audit.nextSeq}&limit=2`,{headers})).json();assert.ok(next.items.every((item:{seq:number})=>item.seq>audit.nextSeq));
  const ledger=await(await f.call(`/api/accounts/${f.account.id}/ledger?limit=2`,{headers})).json();assert.equal(ledger.entries.items.length,2);assert.equal(ledger.account.outstandingMinor,750);
  for(const query of ['limit=101','limit=0','afterSeq=-1','afterSeq=1e2','afterSeq=9007199254740992','limit=1&limit=2','private=true'])assert.equal((await f.call(`/api/events?${query}`,{headers})).status,400);
  assert.equal((await f.call('/api/tasks/00000000-0000-0000-0000-000000000000',{headers})).status,404);
  assert.equal((await f.call('/api/accounts/00000000-0000-0000-0000-000000000000/ledger',{headers})).status,404);
  const serialized=JSON.stringify({tasks,audit,next,ledger});
  for(const value of [f.token,'server-only-secret','input_json','result_json','payload_hash','output_json','dedupe_key'])assert.ok(!serialized.includes(value));
 }finally{await f.close();}
});
