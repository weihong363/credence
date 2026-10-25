import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {JudgeDemo} from '../src/web/judge-demo.js';
import {openDatabase} from '../src/persistence/database.js';
import {initializeDemo} from '../src/application/initialize.js';
import {Payments} from '../src/application/payments.js';
import {readConfig} from '../src/config.js';
import {createRuntimeApp} from '../src/runtime-http.js';
import type {PaymentPort} from '../src/payments/port.js';
import {paymentFixture} from './payment-harness.js';
const port=():PaymentPort=>({async create(){throw new Error('NO_REMOTE_EXPECTED');},async inspect(){throw new Error('NO_REMOTE_EXPECTED');},async capture(){throw new Error('NO_REMOTE_EXPECTED');}});
async function fixture(limit=16,paymentPort:()=>PaymentPort=port){
 const directory=mkdtempSync(join(tmpdir(),'credence-judge-'));let now=Date.now();
 const db=openDatabase(':memory:');initializeDemo(db,1500);
 const config=readConfig({PAYPAL_CLIENT_ID:'fake',PAYPAL_CLIENT_SECRET:'fake',PAYPAL_MERCHANT_ID:'MERCHANT',OWNER_TOKEN:'test-owner-'.repeat(4)});
 const options={directory,maxCalls:limit,port:paymentPort,clock:()=>now,model:()=>()=>({async complete(){throw new Error('MOCK_STOP');}})};
 let judge=new JudgeDemo(config,options);
 const server=createRuntimeApp(config,db,new Payments(db,port(),'MERCHANT',config.publicUrl.origin),undefined,undefined,(req,res,url)=>judge.route(req,res,url));
 server.listen(0,'127.0.0.1');await once(server,'listening');config.publicUrl=new URL(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
 const call=(path:string,init:RequestInit={})=>fetch(config.publicUrl.origin+path,{...init,headers:{'Content-Type':'application/json',...init.headers}});
 const login=async()=>{const r=await call('/judge/api/session',{method:'POST',headers:{Origin:config.publicUrl.origin},body:'{}'});const value=await r.json() as {csrfToken:string};return {r,cookie:r.headers.get('set-cookie')?.split(';')[0]??'',csrf:value.csrfToken};};
 return {config,db,directory,call,login,advance:()=>{now+=11000;},restart:async()=>{await judge.close();judge=new JudgeDemo(config,options);},close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await judge.close();db.close();rmSync(directory,{recursive:true,force:true});}};
}
test('judge sessions isolate account/task/payment reads and never grant owner access; CSRF and Origin required',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call('/judge/api/session',{method:'POST',body:'{}'})).status,403);
  const a=await f.login();assert.equal(a.r.status,200);assert.match(a.r.headers.get('set-cookie')!,/Path=\/judge; HttpOnly; SameSite=Strict/);
  assert.equal((await f.call('/api/finance',{headers:{Cookie:a.cookie}})).status,401);
  const ar=await f.call('/judge/api/finance',{headers:{Cookie:a.cookie}});const av=await ar.json() as {accounts:{id:string}[]};
  f.advance();const b=await f.login();const br=await f.call('/judge/api/finance',{headers:{Cookie:b.cookie}});const bv=await br.json() as {accounts:{id:string}[]};
  assert.notEqual(av.accounts[0].id,bv.accounts[0].id);
  assert.equal((await f.call(`/judge/api/accounts/${av.accounts[0].id}/ledger`,{headers:{Cookie:b.cookie}})).status,404);
  assert.equal((await f.call('/judge/api/batches',{method:'POST',headers:{Cookie:a.cookie,Origin:f.config.publicUrl.origin},body:'{}'})).status,403);
  assert.equal((await f.call('/judge/api/economy',{headers:{Cookie:a.cookie}})).status,403);
  assert.equal((await f.call('/judge/api/finance',{headers:{Cookie:a.cookie,Authorization:'Bearer '+f.config.ownerToken}})).status,403);
 }finally{await f.close();}
});
test('admission slots cannot reset on restart/logout, fixed repository and one task protect durable call envelope',async()=>{
 const f=await fixture(8);try{
  const a=await f.login();assert.equal(a.r.status,200);
  const registry=new Database(join(f.directory,'admission.sqlite'));const row=registry.prepare('SELECT id FROM guests').get() as {id:string};registry.close();
  const guestDb=new Database(join(f.directory,`${row.id}.sqlite`));const account=guestDb.prepare('SELECT id FROM accounts').get() as {id:string};guestDb.close();
  const headers={Cookie:a.cookie,Origin:f.config.publicUrl.origin,'X-CSRF-Token':a.csrf,'Idempotency-Key':'judge-test-key'};
  assert.equal((await f.call('/judge/api/missions',{method:'POST',headers,body:JSON.stringify({accountId:account.id,repository:{owner:'attacker',name:'repo',commitSha:'a'.repeat(40)}})})).status,400);
  const body=JSON.stringify({accountId:account.id,repository:{owner:'expressjs',name:'cors',commitSha:'5317ebe670db2aaebc1d496eb5d33493deefb3ed'}});
  const start=await f.call('/judge/api/missions',{method:'POST',headers,body});assert.equal(start.status,202);const task=await start.json() as {id:string};
  const replay=await f.call('/judge/api/missions',{method:'POST',headers,body});assert.equal((await replay.json() as {id:string}).id,task.id);
  assert.equal((await f.call('/judge/api/missions',{method:'POST',headers:{...headers,'Idempotency-Key':'another-key'},body})).status,409);
  await f.restart();assert.equal((await f.call('/judge/api/finance',{headers:{Cookie:a.cookie}})).status,200);
  f.advance();assert.equal((await f.login()).r.status,429);
  assert.equal((await f.call('/judge/api/session/logout',{method:'POST',headers,body:'{}'})).status,200);
  assert.equal((await f.call('/judge/api/finance',{headers:{Cookie:a.cookie}})).status,401);
  await f.restart();f.advance();assert.equal((await f.login()).r.status,429);
 }finally{await f.close();}
});
test('guest payment isolation, lost capture recovery and replay preserve one receipt across dispatcher restart',async()=>{
 let payment:Awaited<ReturnType<typeof paymentFixture>>|undefined;
 const f=await fixture(16,()=>({create:(...a)=>payment!.port.create(...a),inspect:(...a)=>payment!.port.inspect(...a),capture:(...a)=>payment!.port.capture(...a)}));
 try{
  const a=await f.login();const registry=new Database(join(f.directory,'admission.sqlite'));const row=registry.prepare('SELECT id FROM guests').get() as {id:string};registry.close();
  payment=await paymentFixture(join(f.directory,`${row.id}.sqlite`));
  const headers={Cookie:a.cookie,Origin:f.config.publicUrl.origin,'X-CSRF-Token':a.csrf};
  const command=async(action:string,key:string,body:unknown={})=>f.call(`/judge/api/batches/${payment!.batch.id}/${action}`,{method:'POST',headers:{...headers,'Idempotency-Key':key},body:JSON.stringify(body)});
  assert.equal((await command('order','guest-order')).status,200);payment.approve();payment.state.lostCapture=true;
  const before=await f.call(`/judge/api/batches/${payment.batch.id}`,{headers:{Cookie:a.cookie}});const view=await before.json() as {batch:{version:number}};
  await command('capture','guest-capture',{expectedVersion:view.batch.version});
  assert.equal((payment.db.prepare('SELECT count(*) n FROM settlement_receipts').get() as {n:number}).n,0);
  await f.restart();await command('reconcile','guest-reconcile');
  assert.equal((payment.db.prepare('SELECT count(*) n FROM settlement_receipts').get() as {n:number}).n,1);
  await command('capture','guest-capture',{expectedVersion:view.batch.version});assert.equal(payment.calls.capture,1);
  f.advance();const b=await f.login();assert.equal((await f.call(`/judge/api/batches/${payment.batch.id}`,{headers:{Cookie:b.cookie}})).status,403);
  assert.equal((await f.call(`/judge/api/tasks/${(payment.db.prepare('SELECT id FROM tasks').get() as {id:string}).id}`,{headers:{Cookie:b.cookie}})).status,404);
 }finally{payment?.db.close();await f.close();}
});
test('80-call admission ceiling allows ten sessions total and refuses configuration reset across instances',async()=>{
 const f=await fixture(80);try{
  for(let i=0;i<10;i++){assert.equal((await f.login()).r.status,200);f.advance();}
  assert.equal((await f.login()).r.status,429);await f.restart();f.advance();assert.equal((await f.login()).r.status,429);
  assert.throws(()=>new JudgeDemo(f.config,{directory:f.directory,maxCalls:72,port,model:()=>()=>({async complete(){throw new Error('NO_MODEL');}})}),/JUDGE_LIMIT_CHANGE_REQUIRES_REVIEW/);
  const store=new Database(join(f.directory,'admission.sqlite'));assert.equal((store.prepare('SELECT count(*) n FROM guests').get() as {n:number}).n,10);store.close();
 }finally{await f.close();}
});
