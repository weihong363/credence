import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {setupRuntime,analysisResult} from './runtime-fixture.js';
import {claim,reconcile} from '../src/application/lifecycle.js';
import {openDatabase} from '../src/persistence/database.js';

test('two processes racing cancel and acceptance commit one coherent financial outcome',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'credence-accept-'));const path=join(dir,'db.sqlite');
 const f=setupRuntime('repo.architecture',path);const job=claim(f.db,100)!;
 const children=['accept','cancel'].map(operation=>fork(new URL('../scripts/delivery-contender.ts',import.meta.url),[],{
  execArgv:['--import','tsx'],stdio:['ignore','ignore','inherit','ipc'],env:{...process.env,CREDIT_TEST_PATH:path,
   CREDIT_TEST_REQUEST:JSON.stringify({operation,job,context:f.context,result:analysisResult(f.snapshot)})},
 }));
 try{
  await Promise.all(children.map(child=>once(child,'message')));
  const results=children.map(child=>once(child,'message'));const exits=children.map(child=>once(child,'exit'));
  children.forEach(child=>child.send('go'));assert.ok((await Promise.all(results)).every(([value])=>value!=='ERROR'));await Promise.all(exits);
  reconcile(f.db);const purchase=f.db.prepare('SELECT status FROM purchases').get() as {status:string};
  const charges=(f.db.prepare('SELECT count(*) n FROM charges').get() as {n:number}).n;
  assert.ok(['ACCEPTED','CANCELLED'].includes(purchase.status));assert.equal(charges,purchase.status==='ACCEPTED'?1:0);
  assert.equal((f.db.prepare("SELECT count(*) n FROM ledger_events WHERE type IN ('SERVICE_CHARGED','CREDIT_RELEASED')").get() as {n:number}).n,1);
  const reopened=openDatabase(path);try{reconcile(reopened);assert.equal((reopened.prepare('SELECT count(*) n FROM charges').get() as {n:number}).n,charges);}finally{reopened.close();}
 }finally{children.forEach(child=>child.kill());f.db.close();rmSync(dir,{recursive:true,force:true});}
});
