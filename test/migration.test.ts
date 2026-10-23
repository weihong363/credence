import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {migrations} from '../src/persistence/migrations.js';
import {openDatabase} from '../src/persistence/database.js';
import {reserve} from '../src/application/reserve.js';
test('version-one history survives migration exactly, replay and integrity triggers remain',()=>{
 const directory=mkdtempSync(join(tmpdir(),'credence-migration-'));const path=join(directory,'db.sqlite');
 const old=new Database(path);old.exec(migrations[0].sql);old.pragma('user_version=1');
 const request={ownerId:randomUUID(),accountId:randomUUID(),taskId:randomUUID(),purchaseId:randomUUID(),key:'original',amountMinor:70};
 old.prepare("INSERT INTO accounts(id,owner_id,buyer_id,currency,limit_minor,per_purchase_minor) VALUES(?,?,?,'USD',100,100)").run(request.accountId,request.ownerId,randomUUID());
 old.prepare('INSERT INTO tasks(id,account_id,budget_minor,deadline_at) VALUES(?,?,100,9999999999999)').run(request.taskId,request.accountId);
 const reservation={id:randomUUID(),purchase_id:request.purchaseId,account_id:request.accountId,task_id:request.taskId,amount_minor:70,state:'HELD',expires_at:9999999999999};
 old.prepare('INSERT INTO reservations VALUES(@id,@purchase_id,@account_id,@task_id,@amount_minor,@state,@expires_at)').run(reservation);
 const digest=createHash('sha256').update(JSON.stringify([request.accountId,70,request.ownerId,request.purchaseId,request.taskId])).digest('hex');
 old.prepare("INSERT INTO ledger_events(id,account_id,task_id,purchase_id,reservation_id,type,amount_minor,currency,dedupe_key,payload_hash,created_at) VALUES(?,?,?,?,?,'CREDIT_RESERVED',70,'USD','original',?,100)").run(randomUUID(),request.accountId,request.taskId,request.purchaseId,reservation.id,digest);
 old.prepare("INSERT INTO economic_audit(id,account_id,reservation_id,actor_id,action,created_at) VALUES(?,?,?,?,'CREDIT_RESERVED',100)").run(randomUUID(),request.accountId,reservation.id,request.ownerId);
 old.exec('UPDATE accounts SET reserved_minor=70; UPDATE tasks SET spent_minor=70');
 const history=old.prepare('SELECT * FROM ledger_events').all();old.close();
 const db=openDatabase(path);try{
 assert.deepEqual(db.prepare('SELECT seq,id,account_id,task_id,purchase_id,reservation_id,type,amount_minor,currency,dedupe_key,payload_hash,created_at FROM ledger_events').all(),history);
 assert.deepEqual(reserve(db,request),reservation);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 assert.throws(()=>db.exec('DELETE FROM ledger_events'),/APPEND_ONLY/);
 assert.equal(db.pragma('user_version',{simple:true}),7);
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

test('version-four completed tasks and model-call history retain their identity during planning migration',()=>{
 const directory=mkdtempSync(join(tmpdir(),'credence-v4-'));const path=join(directory,'db.sqlite');
 const old=new Database(path);old.pragma('foreign_keys=ON');
 for(const migration of migrations.filter(item=>item.version<=4))old.exec(migration.sql);
 old.pragma('user_version=4');
 const owner=randomUUID(),buyer=randomUUID(),account=randomUUID(),task=randomUUID(),call=randomUUID();
 old.prepare('INSERT INTO owners VALUES(?,0)').run(owner);
 old.prepare("INSERT INTO agents VALUES(?,?,'BUYER','Historical',1)").run(buyer,owner);
 old.prepare("INSERT INTO accounts(id,owner_id,buyer_id,currency,limit_minor,per_purchase_minor) VALUES(?,?,?,'USD',1000,400)").run(account,owner,buyer);
 old.prepare("INSERT INTO tasks(id,account_id,budget_minor,deadline_at,status,result_json) VALUES(?,?,1000,100,'COMPLETED','{\"historical\":true}')").run(task,account);
 old.prepare('INSERT INTO model_calls VALUES(?,?,?,1,50)').run(call,task,'historic-model');old.close();
 const db=openDatabase(path);
 try{
  assert.deepEqual(db.prepare('SELECT id,status,result_json,review_profile FROM tasks').get(),{id:task,status:'COMPLETED',result_json:'{"historical":true}',review_profile:'scoped'});
  assert.deepEqual(db.prepare('SELECT * FROM model_calls').get(),{id:call,task_id:task,model:'historic-model',ordinal:1,created_at:50,purpose:'LEGACY'});
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});
