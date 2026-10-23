import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {readConfig} from '../src/config.js';
import {openDatabase} from '../src/persistence/database.js';
import {PayPal} from '../src/paypal.js';
import {PayPalAdapter} from '../src/payments/paypal-adapter.js';
import {Payments} from '../src/application/payments.js';
import {matches} from '../src/application/payment-records.js';
import {reconcile} from '../src/application/lifecycle.js';
const path=process.env.CREDENCE_DB_PATH;if(!path)throw new Error('EXPLICIT_CREDENCE_DB_PATH_REQUIRED');
const args=process.argv.slice(2);const id=args.find(arg=>!arg.startsWith('--'));if(!id)throw new Error('BATCH_ID_REQUIRED');
const config=readConfig(),db=openDatabase(path);
async function verify(id:string):Promise<void>{
 const batch=db.prepare('SELECT owner_id FROM batches WHERE id=?').get(id) as {owner_id:string}|undefined;if(!batch)throw new Error('BATCH_NOT_FOUND');
 const adapter=new PayPalAdapter(new PayPal(config.clientId,config.clientSecret));
 const payments=new Payments(db,adapter,config.merchantId,config.publicUrl.origin);
 const before=payments.view(batch.owner_id,id);if(!before.payment?.orderId)throw new Error('ORDER_REQUIRED');
 const flags=process.argv.slice(2);
 if(flags.includes('--checkpoint-restart')){
  assert.ok(before.receipt,'Settle before checkpointing a restart');
  writeFileSync('.data/p2-restart-before.json',JSON.stringify({receipt:before.receipt,financialEvents:db.prepare("SELECT type,count(*) count FROM ledger_events WHERE type IN('PAYMENT_CONFIRMED','CHARGE_SETTLED') GROUP BY type ORDER BY type").all()}),{mode:0o600});
  console.log('Restart checkpoint saved. Restart the same server/database, then run --after-restart.');return;
 }
 if(flags.includes('--after-restart')){
  assert.ok(before.receipt,'Restart verification never pays an unpaid batch');
  const checkpoint=JSON.parse(readFileSync('.data/p2-restart-before.json','utf8'));assert.deepEqual(checkpoint.receipt,before.receipt);
  const base=`${config.publicUrl.origin}/api/batches/${id}`,headers={Authorization:`Bearer ${config.ownerToken}`,'Content-Type':'application/json'};
  const current=await(await fetch(base,{headers,signal:AbortSignal.timeout(10000)})).json();assert.deepEqual(current.receipt,before.receipt);
  for(const action of ['order','capture','reconcile']){
   const response=await fetch(`${base}/${action}`,{method:'POST',headers:{...headers,'Idempotency-Key':`restart-${action}:${randomUUID()}`},
    body:JSON.stringify(action==='capture'?{expectedVersion:current.batch.version}:{}),signal:AbortSignal.timeout(60000)});
   assert.equal(response.status,200);assert.deepEqual((await response.json()).receipt,before.receipt);
  }
  writeFileSync('.data/p2-restart-verified.json',JSON.stringify({verifiedAt:new Date().toISOString(),receiptUnchanged:true,ownerApiReplays:['order','capture','reconcile']}),{mode:0o600});
 }
 const observation=await adapter.inspect(before.payment.orderId);matches(before.batch,observation,before.payment.orderId);
 const counts=()=>db.prepare("SELECT type,count(*) count FROM ledger_events WHERE type IN('PAYMENT_CONFIRMED','CHARGE_SETTLED') GROUP BY type ORDER BY type").all();
 const originalCounts=counts();let repeated=false;
 if(before.receipt){
  for(const action of ['order','capture','reconcile'] as const){const result=await payments.run(batch.owner_id,id,action,`verify-${action}:${randomUUID()}`);assert.deepEqual(result.receipt,before.receipt);}
  assert.deepEqual(counts(),originalCounts);repeated=true;
 }
 reconcile(db);const view=payments.view(batch.owner_id,id);
 const preservedPath='.data/p2-preserved-fingerprints.json';
 let preserved:boolean|null=null;
 if(existsSync(preservedPath))preserved=(JSON.parse(readFileSync(preservedPath,'utf8')) as {path:string;sha256:string}[]).every(item=>existsSync(item.path)&&createHash('sha256').update(readFileSync(item.path)).digest('hex')===item.sha256);
 const charges=db.prepare(`SELECT c.id,c.task_id,c.purchase_id,c.delivery_id,c.amount_minor,p.capability_id,v.result verification
 FROM allocations a JOIN charges c ON c.id=a.charge_id JOIN purchases p ON p.id=c.purchase_id JOIN verifications v ON v.delivery_id=c.delivery_id WHERE a.batch_id=? ORDER BY c.amount_minor`).all(id);
 const account=db.prepare('SELECT id,limit_minor,reserved_minor,outstanding_minor,limit_minor-reserved_minor-outstanding_minor available_minor FROM accounts WHERE id=?').get(view.batch.account_id);
 let restartVerified=false;
 if(existsSync('.data/p2-restart-verified.json')&&existsSync('.data/p2-restart-before.json')){
  const snapshot=JSON.parse(readFileSync('.data/p2-restart-before.json','utf8'));
  const proof=JSON.parse(readFileSync('.data/p2-restart-verified.json','utf8'));
  restartVerified=proof.receiptUnchanged===true&&JSON.stringify(snapshot.receipt)===JSON.stringify(view.receipt)&&JSON.stringify(snapshot.financialEvents)===JSON.stringify(counts());
 }
 const complete=view.batch.state==='SETTLED'&&observation.status==='COMPLETED'&&view.receipt!==null&&repeated&&charges.length===3&&preserved!==false&&restartVerified;
 const evidence={recordedAt:new Date().toISOString(),phase:'P2',status:complete?'LIVE_VERIFIED':'AWAITING_BUYER_APPROVAL_OR_CAPTURE',database:path,
 batch:view.batch,charges,allocations:view.allocations,receipt:view.receipt,authoritativeObservation:observation,account,
 modelRequests:db.prepare('SELECT task_id,count(*) count FROM model_calls GROUP BY task_id').all(),
 checks:{independentAuthenticatedGet:true,reconciliation:'PASS',repeatedReceiptUnchanged:repeated,financialEventCountsUnchanged:repeated,serverRestartReceiptAndEventsUnchanged:restartVerified,originalLedgerAndP0BytesUnchanged:preserved},
 financialEventCounts:counts(),remaining:complete?[]:['Human Personal-buyer approval','Owner server-side capture','Fresh GET and immutable receipt/restart verification']};
 writeFileSync('docs/p2-live-evidence.json',JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({status:evidence.status,batchId:id,orderId:observation.orderId,captureId:view.receipt?.capture_id,totalMinor:view.batch.total_minor},null,2));
 if(!complete)process.exitCode=1;
}
try{await verify(id);}finally{db.close();}
