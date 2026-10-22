import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/persistence/database.js';
import { seedDemo, createTask } from '../src/registry/catalog.js';
import { requestQuote, proposePurchase, listCapabilities } from '../src/application/procurement.js';

export function setup() {
 const db = openDatabase(':memory:');
 const identity = seedDemo(db,100);
 const taskId = createTask(db,identity,'Review repository',{repository:{owner:'example',name:'repo'}},100);
 db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?)').run(randomUUID(),taskId,'{}','fixture',100);
 return {db,context:{...identity,taskId}};
}
test('registry quotes authoritative price, consumes once and replays', () => {
 const {db,context}=setup();
 try {
  assert.equal(listCapabilities(db,context,100).length,3);
  const quote=requestQuote(db,context,'repo.inventory',1,100);
  assert.equal(quote.amount_minor,125);
  const purchase=proposePurchase(db,context,quote.id,'request',100);
  assert.deepEqual(proposePurchase(db,context,quote.id,'request',101),purchase);
  assert.throws(()=>proposePurchase(db,context,quote.id,'other',101),/UNIQUE/);
  assert.equal((db.prepare('SELECT reserved_minor FROM accounts').get() as {reserved_minor:number}).reserved_minor,125);
 } finally {db.close();}
});
test('unknown version, expiry, wrong owner, policy limit and allowlist deny without holds',()=>{
 const {db,context}=setup();
 try {
  assert.throws(()=>requestQuote(db,context,'unknown',1,100),/UNAVAILABLE/);
  assert.throws(()=>requestQuote(db,context,'repo.inventory',2,100),/UNAVAILABLE/);
  assert.throws(()=>requestQuote(db,{...context,ownerId:randomUUID()},'repo.inventory',1,100),/FORBIDDEN/);
  const quote=requestQuote(db,context,'repo.architecture',1,100);
  assert.throws(()=>proposePurchase(db,context,quote.id,'expired',120100),/EXPIRED/);
  db.exec('UPDATE accounts SET per_purchase_minor=200');
  assert.throws(()=>proposePurchase(db,context,quote.id,'limit',101),/CREDIT_LIMIT/);
  db.prepare('UPDATE accounts SET allowlist_json=?').run(JSON.stringify(['repo.inventory']));
  assert.throws(()=>requestQuote(db,context,'repo.risk-review',1,101),/DENIED/);
  assert.throws(()=>proposePurchase(db,context,quote.id,'denied',101),/DENIED/);
  assert.equal((db.prepare('SELECT count(*) n FROM purchases').get() as {n:number}).n,0);
  assert.equal((db.prepare('SELECT reserved_minor FROM accounts').get() as {reserved_minor:number}).reserved_minor,0);
 } finally {db.close();}
});
