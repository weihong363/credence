import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setupRuntime,analysisResult} from './runtime-fixture.js';
import {setAccountStatus} from '../src/application/policy.js';
import {claim,reconcile} from '../src/application/lifecycle.js';
import {completeDelivery} from '../src/application/deliveries.js';
test('owner policy suspension atomically releases unfinished work but preserves accepted charges',()=>{
 const f=setupRuntime();try{
 assert.throws(()=>setAccountStatus(f.db,randomUUID(),f.context.accountId,'REVOKED',101),/FORBIDDEN/);
 setAccountStatus(f.db,f.context.ownerId,f.context.accountId,'SUSPENDED',101);reconcile(f.db);
 assert.equal((f.db.prepare('SELECT status FROM purchases').get() as {status:string}).status,'CANCELLED');
 assert.equal((f.db.prepare('SELECT reserved_minor FROM accounts').get() as {reserved_minor:number}).reserved_minor,0);
 }finally{f.db.close();}
 const accepted=setupRuntime();try{
 completeDelivery(accepted.db,claim(accepted.db,100)!,analysisResult(accepted.snapshot),101);
 setAccountStatus(accepted.db,accepted.context.ownerId,accepted.context.accountId,'REVOKED',102);reconcile(accepted.db);
 assert.equal((accepted.db.prepare('SELECT outstanding_minor FROM accounts').get() as {outstanding_minor:number}).outstanding_minor,250);
 }finally{accepted.db.close();}
});

test('owner limit changes are audited, bounded by obligations, replay-safe and atomic',async()=>{
 const {setAccountLimit}=await import('../src/application/policy.js');
 const f=setupRuntime();try{
  assert.throws(()=>setAccountLimit(f.db,randomUUID(),f.context.accountId,1500),/FORBIDDEN/);
  assert.throws(()=>setAccountLimit(f.db,f.context.ownerId,f.context.accountId,1.5),/INVALID_MONEY/);
  assert.throws(()=>setAccountLimit(f.db,f.context.ownerId,f.context.accountId,249),/COMMITTED/);
  const previous=(f.db.prepare('SELECT count(*) n FROM economic_audit').get() as {n:number}).n;
  f.db.exec("CREATE TRIGGER fail_limit BEFORE INSERT ON economic_audit WHEN NEW.action LIKE 'POLICY:LIMIT:%' BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.throws(()=>setAccountLimit(f.db,f.context.ownerId,f.context.accountId,1500),/injected/);
  assert.equal((f.db.prepare('SELECT limit_minor FROM accounts').get() as {limit_minor:number}).limit_minor,1000);
  f.db.exec('DROP TRIGGER fail_limit');
  setAccountLimit(f.db,f.context.ownerId,f.context.accountId,1500);
  setAccountLimit(f.db,f.context.ownerId,f.context.accountId,1500);
  assert.equal((f.db.prepare('SELECT limit_minor FROM accounts').get() as {limit_minor:number}).limit_minor,1500);
  assert.equal((f.db.prepare('SELECT count(*) n FROM economic_audit').get() as {n:number}).n,previous+1);
  reconcile(f.db);
 }finally{f.db.close();}
});
