import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {readConfig} from '../src/config.js';
import {openDatabase} from '../src/persistence/database.js';
import {PayPal} from '../src/paypal.js';
import {PayPalAdapter} from '../src/payments/paypal-adapter.js';
import {Payments} from '../src/application/payments.js';
import {reverseCharge} from '../src/application/payment-finalization.js';
import {reconcile} from '../src/application/lifecycle.js';
import type {PaymentAction} from '../src/application/payment-records.js';
const config=readConfig(),path=process.env.CREDENCE_DB_PATH??join(config.dataDir,'credence.sqlite');
if(!existsSync(path))throw new Error('DATABASE_NOT_CREATED');
const db=openDatabase(path);
try{
 const [action='status',id,key]=process.argv.slice(2).filter(value=>value!=='--');
 const payments=new Payments(db,new PayPalAdapter(new PayPal(config.clientId,config.clientSecret)),config.merchantId,config.publicUrl.origin);
 const owner=(db.prepare('SELECT DISTINCT owner_id FROM accounts').all() as {owner_id:string}[]);
 if(owner.length!==1)throw new Error('SINGLE_OWNER_REQUIRED');
 if(action==='recover')await payments.recover();
 else if(action==='reverse')reverseCharge(db,owner[0].owner_id,id,key);
 else if(['order','capture','cancel','resume','reconcile'].includes(action)){
  if(!key)throw new Error('OWNER_REQUEST_KEY_REQUIRED');
  console.log(JSON.stringify(await payments.run(owner[0].owner_id,id,action as PaymentAction,key),null,2));
 }else if(action==='status'){
  const ids=db.prepare('SELECT id FROM batches WHERE owner_id=?').all(owner[0].owner_id) as {id:string}[];
  console.log(JSON.stringify(ids.map(row=>payments.view(owner[0].owner_id,row.id)),null,2));
 }else throw new Error('UNKNOWN_COMMAND');
 reconcile(db);
}finally{db.close();}
