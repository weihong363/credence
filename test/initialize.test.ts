import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/persistence/database.js';
import {initializeDemo} from '../src/application/initialize.js';

test('explicit initialization is replay safe, creates no obligations and never resets policy',()=>{
 const db=openDatabase(':memory:');
 try{
  const identity=initializeDemo(db,1500);
  const before=db.prepare('SELECT * FROM economic_audit').all();
  assert.deepEqual(initializeDemo(db,1500),identity);
  assert.deepEqual(db.prepare('SELECT * FROM economic_audit').all(),before);
  assert.throws(()=>initializeDemo(db,1000),/INITIALIZATION_CONFLICT/);
  assert.deepEqual(db.prepare('SELECT limit_minor,reserved_minor,outstanding_minor,per_purchase_minor FROM accounts').get(),{limit_minor:1500,reserved_minor:0,outstanding_minor:0,per_purchase_minor:400});
  for(const table of ['tasks','purchases','charges','batches','ledger_events'])assert.equal((db.prepare(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n,0);
 }finally{db.close();}
});
test('initialization rolls back completely on audit failure',()=>{
 const db=openDatabase(':memory:');
 try{
  db.exec("CREATE TRIGGER fail_init BEFORE INSERT ON economic_audit BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.throws(()=>initializeDemo(db,1500),/injected/);
  for(const table of ['owners','agents','accounts','capabilities'])assert.equal((db.prepare(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n,0);
 }finally{db.close();}
});
test('initialization rejects partial existing state and invalid allowance without mutation',()=>{
 const db=openDatabase(':memory:');
 try{
  for(const amount of [-1,1.5,NaN,399,Number.MAX_SAFE_INTEGER])assert.throws(()=>initializeDemo(db,amount));
  db.prepare('INSERT INTO owners VALUES(?,?)').run('existing-owner',1);
  assert.throws(()=>initializeDemo(db,1500),/INITIALIZATION_REQUIRES_EMPTY_DATABASE/);
  assert.equal((db.prepare('SELECT count(*) n FROM accounts').get() as {n:number}).n,0);
 }finally{db.close();}
});
