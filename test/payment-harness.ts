import {openDatabase} from '../src/persistence/database.js';
import {runMission} from '../src/application/missions.js';
import {freezeBatch} from '../src/application/batches.js';
import {Payments} from '../src/application/payments.js';
import {PaymentError,type PaymentObservation,type PaymentPort} from '../src/payments/port.js';
import {missionHarness,repositoryInput,sourceFetcher} from './mission-harness.js';
export async function paymentFixture(path=':memory:'){
 const db=openDatabase(path),h=missionHarness(db);
 await runMission(db,h.factory,'review repository',repositoryInput,sourceFetcher,undefined,{profile:'full-review'});
 const account=db.prepare('SELECT id,owner_id FROM accounts').get() as {id:string;owner_id:string};
 const chargeIds=(db.prepare('SELECT id FROM charges ORDER BY id').all() as {id:string}[]).map(row=>row.id);
 const request={ownerId:account.owner_id,accountId:account.id,key:'freeze',chargeIds};const batch=freezeBatch(db,'MERCHANT',request);
 let status:PaymentObservation['status']='CREATED',now=Date.now();
 const calls={create:0,capture:0,inspect:0,createKeys:[] as string[],captureKeys:[] as string[]};
 const state={lostCreate:false,lostCapture:false,decline:false,pending:false,invalid:false};
 const observation=():PaymentObservation=>({orderId:'ORDER1',status,orderStatus:status==='PENDING'?'COMPLETED':status,batchId:batch.id,invoiceId:batch.id,merchantId:state.invalid?'WRONG':'MERCHANT',minor:750,currency:'USD',approvalUrl:'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1',
  ...(['COMPLETED','PENDING'].includes(status)?{capture:{id:'CAPTURE1',status:status==='PENDING'?'PENDING':'COMPLETED',minor:750,currency:'USD' as const}}:{})});
 const port:PaymentPort={create:async(_input,key)=>{calls.create++;calls.createKeys.push(key);if(state.lostCreate)throw new PaymentError('UNAVAILABLE');return observation();},
 inspect:async()=>{calls.inspect++;return observation();},capture:async(_id,key)=>{calls.capture++;calls.captureKeys.push(key);if(state.decline)throw new PaymentError('DECLINED');status=state.pending?'PENDING':'COMPLETED';if(state.lostCapture)throw new PaymentError('UNAVAILABLE');}};
 const service=()=>new Payments(db,port,'MERCHANT','http://localhost:3001',()=>now);
 return {db,account,request,batch,chargeIds,port,calls,state,observation,service,approve:()=>{status='APPROVED';},status:(value:PaymentObservation['status'])=>{status=value;},advance:(ms:number)=>{now+=ms;},clock:()=>now,
 run:(action:'order'|'capture'|'cancel'|'resume'|'reconcile',key:string=action)=>service().run(account.owner_id,batch.id,action,key)};
}
