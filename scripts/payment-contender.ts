import {openDatabase} from '../src/persistence/database.js';
import {Payments} from '../src/application/payments.js';
import type {PaymentObservation,PaymentPort} from '../src/payments/port.js';
const db=openDatabase(process.env.CREDIT_TEST_PATH!);
const input=JSON.parse(process.env.CREDIT_TEST_REQUEST!) as {ownerId:string;batchId:string;key:string;observation:PaymentObservation};
const port:PaymentPort={inspect:async()=>input.observation,create:async()=>{throw new Error('UNEXPECTED_CREATE');},capture:async()=>{throw new Error('UNEXPECTED_CAPTURE');}};
process.once('message',async()=>{
 let result:string;
 try{result=(await new Payments(db,port,'MERCHANT','http://localhost:3001').run(input.ownerId,input.batchId,'reconcile',input.key)).batch.state;}catch(error){result=error instanceof Error?error.message:'ERROR';}
 db.close();process.send!(result,()=>process.disconnect());
});
process.send!('ready');
