import {openDatabase} from '../src/persistence/database.js';
import {Payments} from '../src/application/payments.js';
import type {PaymentObservation,PaymentPort} from '../src/payments/port.js';
const db=openDatabase(process.env.CREDIT_TEST_PATH!);
const input=JSON.parse(process.env.CREDIT_TEST_REQUEST!) as {ownerId:string;batchId:string;observation:PaymentObservation};
const port:PaymentPort={create:async()=>{throw new Error('UNEXPECTED_CREATE');},inspect:async()=>({...input.observation,status:'APPROVED',orderStatus:'APPROVED',capture:undefined}),
 capture:async()=>{process.exit(0);}};
await new Payments(db,port,'MERCHANT','http://localhost:3001').run(input.ownerId,input.batchId,'capture','crash-capture');
throw new Error('CRASH_CHECKPOINT_NOT_REACHED');
