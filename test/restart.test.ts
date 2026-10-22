import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setupRuntime,analysisResult} from './runtime-fixture.js';
import {openDatabase} from '../src/persistence/database.js';
import {claim,reconcile} from '../src/application/lifecycle.js';
import {completeDelivery} from '../src/application/deliveries.js';
test('reopened database recovers expired invocation with same ID and accepts once',()=>{
 const directory=mkdtempSync(join(tmpdir(),'credence-restart-'));const path=join(directory,'db.sqlite');
 const f=setupRuntime('repo.architecture',path);const first=claim(f.db,100)!;f.db.close();
 const reopened=openDatabase(path);try{
 const second=claim(reopened,30100)!;assert.equal(second.id,first.id);assert.notEqual(second.lease_token,first.lease_token);
 assert.equal(completeDelivery(reopened,first,analysisResult(f.snapshot),30101),'IGNORED');
 assert.equal(completeDelivery(reopened,second,analysisResult(f.snapshot),30102),'ACCEPTED');reconcile(reopened);
 assert.equal((reopened.prepare('SELECT count(*) n FROM charges').get() as {n:number}).n,1);
 }finally{reopened.close();rmSync(directory,{recursive:true,force:true});}
});

test('model request budget survives connection restart and rejects the ninth request',async()=>{
 const {claimModelCall}=await import('../src/application/model-budget.js');
 const directory=mkdtempSync(join(tmpdir(),'credence-model-budget-'));const path=join(directory,'db.sqlite');
 const f=setupRuntime('repo.architecture',path);
 for(let i=0;i<4;i++)claimModelCall(f.db,f.context.taskId,'test-model',101);
 f.db.close();const db=openDatabase(path);
 try{for(let i=0;i<4;i++)claimModelCall(db,f.context.taskId,'test-model',102);
 assert.throws(()=>claimModelCall(db,f.context.taskId,'test-model',103),/MODEL_CALL_BUDGET/);
 assert.equal((db.prepare('SELECT count(*) n FROM model_calls').get() as {n:number}).n,8);
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});
