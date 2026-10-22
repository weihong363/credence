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
