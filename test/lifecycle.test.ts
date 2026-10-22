import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/persistence/database.js';
import { seedDemo,createTask } from '../src/registry/catalog.js';
import { requestQuote,proposePurchase } from '../src/application/procurement.js';
import { claim,heartbeat,recover,cancelPurchase,reconcile } from '../src/application/lifecycle.js';

function setup(){
 const db=openDatabase(':memory:');const identity=seedDemo(db,100);
 const taskId=createTask(db,identity,'review',{repository:{owner:'example',name:'repo'}},100);
 db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?)').run(randomUUID(),taskId,'{}','fixture',100);
 const context={...identity,taskId};const quote=requestQuote(db,context,'repo.inventory',1,100);
 const purchase=proposePurchase(db,context,quote.id,'first',100);
 return {db,context,purchase};
}
test('durable lease is exclusive; recovery reuses identity and bounded attempts release hold',()=>{
 const {db,purchase}=setup();try{
 const first=claim(db,100)!;assert.ok(first);assert.equal(claim(db,101),undefined);
 assert.equal(heartbeat(db,first,200),true);recover(db,30200);
 const second=claim(db,30200)!;assert.equal(second.id,first.id);assert.notEqual(second.lease_token,first.lease_token);
 assert.equal(heartbeat(db,first,30201),false);recover(db,60200);
 assert.equal((db.prepare('SELECT status FROM purchases WHERE id=?').get(purchase.id) as {status:string}).status,'FAILED');
 reconcile(db);assert.equal((db.prepare('SELECT reserved_minor FROM accounts').get() as {reserved_minor:number}).reserved_minor,0);
 }finally{db.close();}
});
test('cancel and deadline release exactly once; revoked accounts fail recovery',()=>{
 const {db,context,purchase}=setup();try{
 cancelPurchase(db,context,purchase.id,101);cancelPurchase(db,context,purchase.id,102);recover(db,1000000);
 assert.equal((db.prepare("SELECT count(*) n FROM ledger_events WHERE type='CREDIT_RELEASED'").get() as {n:number}).n,1);reconcile(db);
 }finally{db.close();}
 const next=setup();try{next.db.exec("UPDATE accounts SET status='REVOKED'");recover(next.db,101);reconcile(next.db);
 assert.equal(claim(next.db,102),undefined);}finally{next.db.close();}
});
