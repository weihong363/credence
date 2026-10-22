import {openDatabase} from '../src/persistence/database.js';
import {completeDelivery} from '../src/application/deliveries.js';
import {cancelPurchase} from '../src/application/lifecycle.js';
const db=openDatabase(process.env.CREDIT_TEST_PATH!);
const input=JSON.parse(process.env.CREDIT_TEST_REQUEST!);
process.once('message',()=>{
 let result='OK';
 try{if(input.operation==='accept')result=completeDelivery(db,input.job,input.result,101);
 else cancelPurchase(db,input.context,input.job.purchase_id,101);}catch{result='ERROR';}
 db.close();process.send!(result,()=>process.disconnect());
});
process.send!('ready');
