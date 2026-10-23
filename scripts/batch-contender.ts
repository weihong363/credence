import {openDatabase} from '../src/persistence/database.js';
import {freezeBatch,type BatchRequest} from '../src/application/batches.js';
const db=openDatabase(process.env.CREDIT_TEST_PATH!);
const request=JSON.parse(process.env.CREDIT_TEST_REQUEST!) as BatchRequest;
process.once('message',()=>{
 let result='OK';
 try{freezeBatch(db,'merchant',request);}catch(error){result=error instanceof Error?error.message:'ERROR';}
 db.close();process.send!(result,()=>process.disconnect());
});
process.send!('ready');
