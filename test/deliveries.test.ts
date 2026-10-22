import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupRuntime,analysisResult} from './runtime-fixture.js';
import {claim,cancelPurchase,recover,reconcile} from '../src/application/lifecycle.js';
import {completeDelivery} from '../src/application/deliveries.js';
import {runNext} from '../src/application/runner.js';
function count(db:ReturnType<typeof setupRuntime>['db'],table:string):number{return (db.prepare(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n;}

test('verified delivery consumes hold once, creates immutable charge, cancel cannot reverse acceptance',()=>{
 const f=setupRuntime();try{
 const job=claim(f.db,100)!;const result=analysisResult(f.snapshot);
 assert.equal(completeDelivery(f.db,job,result,101),'ACCEPTED');
 assert.equal(completeDelivery(f.db,job,result,102),'IGNORED');cancelPurchase(f.db,f.context,f.purchase.id,103);
 assert.equal(count(f.db,'charges'),1);assert.equal(count(f.db,'deliveries'),1);reconcile(f.db);
 assert.deepEqual(f.db.prepare('SELECT reserved_minor,outstanding_minor FROM accounts').get(),{reserved_minor:0,outstanding_minor:250});
 assert.throws(()=>f.db.exec("UPDATE charges SET amount_minor=1"),/APPEND_ONLY/);
 }finally{f.db.close();}
});
test('one evidence correction reuses purchase and hold; final invalid attempt releases',()=>{
 for(const repair of [true,false]){
 const f=setupRuntime();try{
 const result=analysisResult(f.snapshot);result.evidence[0].anchor='fabricated';
 assert.equal(completeDelivery(f.db,claim(f.db,100)!,result,101),'CORRECTION_REQUIRED');assert.equal(count(f.db,'charges'),0);
 const next=claim(f.db,102)!;assert.equal(next.delivery_attempt,2);
 assert.equal(completeDelivery(f.db,next,repair?analysisResult(f.snapshot):result,103),repair?'ACCEPTED':'REJECTED');
 assert.equal(count(f.db,'reservations'),1);assert.equal(count(f.db,'deliveries'),2);assert.equal(count(f.db,'charges'),repair?1:0);reconcile(f.db);
 }finally{f.db.close();}}
});
test('cancel, deadline and account revocation prevent late delivery charging',()=>{
 for(const action of ['cancel','deadline','revoke']){
 const f=setupRuntime();try{const job=claim(f.db,100)!;
 if(action==='cancel')cancelPurchase(f.db,f.context,f.purchase.id,101);
 if(action==='revoke')f.db.exec("UPDATE accounts SET status='REVOKED'");
 if(action==='deadline')recover(f.db,90101);
 assert.notEqual(completeDelivery(f.db,job,analysisResult(f.snapshot),102),'ACCEPTED');assert.equal(count(f.db,'charges'),0);reconcile(f.db);
 }finally{f.db.close();}}
});
test('accept transaction rollback retains hold with no delivery or charge',()=>{
 const f=setupRuntime();try{const job=claim(f.db,100)!;
 f.db.exec("CREATE TRIGGER fail_accept BEFORE INSERT ON economic_audit WHEN NEW.action='ACCEPTED' BEGIN SELECT RAISE(ABORT,'injected'); END");
 assert.throws(()=>completeDelivery(f.db,job,analysisResult(f.snapshot),101),/injected/);
 assert.equal(count(f.db,'deliveries'),0);assert.equal(count(f.db,'charges'),0);reconcile(f.db);
 f.db.exec('DROP TRIGGER fail_accept');assert.equal(completeDelivery(f.db,job,analysisResult(f.snapshot),102),'ACCEPTED');reconcile(f.db);
 }finally{f.db.close();}
});
test('provider exception and timeout release reservations without charge',async()=>{
 for(const timeout of [false,true]){const f=setupRuntime();try{
 const provider=async()=>{if(timeout)return await new Promise<never>(()=>{});throw new Error('service failure');};
 assert.equal(await runNext(f.db,provider,()=>100,5),'FAILED');assert.equal(count(f.db,'charges'),0);reconcile(f.db);
 }finally{f.db.close();}}
});
test('projection corruption is detected by independent reconciliation',()=>{
 const f=setupRuntime();try{f.db.exec('UPDATE accounts SET reserved_minor=0');assert.throws(()=>reconcile(f.db),/MISMATCH/);}finally{f.db.close();}
});
