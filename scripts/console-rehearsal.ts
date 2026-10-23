import {MissionControl} from '../src/application/mission-control.js';
import {pathToFileURL} from 'node:url';
import {openDatabase} from '../src/persistence/database.js';
import {initializeDemo} from '../src/application/initialize.js';
import {runMission} from '../src/application/missions.js';
import {freezeBatch} from '../src/application/batches.js';
import {Payments} from '../src/application/payments.js';
import {createRuntimeApp} from '../src/runtime-http.js';
import {readConfig} from '../src/config.js';
import {PaymentError,type PaymentInput,type PaymentObservation,type PaymentPort} from '../src/payments/port.js';
import {missionHarness,repositoryInput,sourceFetcher} from '../test/mission-harness.js';
export const scenarios=['empty','ready','settled','declined','unknown','action-required'] as const;
export type Scenario=typeof scenarios[number];
export const rehearsalToken='mock-rehearsal-only-owner-token-1234567890';
function mockPort(scenario:Scenario):PaymentPort{
 const orders=new Map<string,PaymentObservation>();let sequence=0,lost=false;
 return {
  async create(input:PaymentInput){const id=`MOCK_ORDER_${++sequence}`;
   const observation:PaymentObservation={orderId:id,status:'APPROVED',orderStatus:'APPROVED',batchId:input.batchId,invoiceId:input.batchId,merchantId:input.merchantId,minor:input.minor,currency:'USD'};
   orders.set(id,observation);return structuredClone(observation);},
  async inspect(id){const observation=orders.get(id);if(!observation)throw new PaymentError('INVALID_RESPONSE');return structuredClone(observation);},
  async capture(id){const observation=orders.get(id);if(!observation)throw new PaymentError('INVALID_RESPONSE');
   if(scenario==='declined')throw new PaymentError('DECLINED');
   observation.status='COMPLETED';observation.orderStatus='COMPLETED';observation.capture={id:`MOCK_CAPTURE_${id}`,status:'COMPLETED',minor:observation.minor,currency:'USD'};
   if(scenario==='unknown'&&!lost){lost=true;throw new PaymentError('UNAVAILABLE');}
  },
 };
}
export async function createRehearsal(scenario:Scenario){
 if(!scenarios.includes(scenario))throw new Error('INVALID_REHEARSAL_SCENARIO');
 const db=openDatabase(':memory:');const identity=initializeDemo(db,1500);
 try{
  const payments=new Payments(db,mockPort(scenario),'MOCK_MERCHANT','http://localhost:3198');
  if(scenario!=='empty'){
   const harness=missionHarness(db,{rejectRisk:scenario==='action-required'});
   await runMission(db,harness.factory,'Simulated full repository review',repositoryInput,sourceFetcher,undefined,{profile:'full-review'});
   if(scenario!=='action-required'){
    const ids=(db.prepare('SELECT id FROM charges').all() as {id:string}[]).map(c=>c.id);
    const batch=freezeBatch(db,'MOCK_MERCHANT',{ownerId:identity.ownerId,accountId:identity.accountId,chargeIds:ids,key:'rehearsal-freeze'});
    await payments.run(identity.ownerId,batch.id,'order','rehearsal-order');
    if(['settled','declined','unknown'].includes(scenario))await payments.run(identity.ownerId,batch.id,'capture','rehearsal-capture',payments.view(identity.ownerId,batch.id).batch.version);
   }
  }
  const config=readConfig({PAYPAL_CLIENT_ID:'mock',PAYPAL_CLIENT_SECRET:'mock',PAYPAL_MERCHANT_ID:'MOCK_MERCHANT',OWNER_TOKEN:rehearsalToken,PORT:'3198'});
  const server=createRuntimeApp(config,db,payments,undefined,new MissionControl(db,id=>missionHarness(db).factory(id),sourceFetcher));
  server.prependListener('request',(_req,res)=>{
   // Test harness only: label the public shell without adding a production mock switch.
   const end=res.end.bind(res);
   res.end=((chunk:unknown,...args:unknown[])=>{
    if(typeof chunk==='string'||Buffer.isBuffer(chunk)){
     const type=res.getHeader('Content-Type');
     if(typeof type==='string'&&type.includes('text/html'))chunk=String(chunk).replace('PAYPAL SANDBOX','SIMULATED REHEARSAL · NO REAL PAYMENTS');
    }
    return (end as (...args:unknown[])=>typeof res)(chunk,...args);
   }) as typeof res.end;
  });
  return {db,server,identity};
 }catch(error){db.close();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const scenario=process.argv[2]??'empty';
 if(!scenarios.includes(scenario as Scenario)||process.argv.length>3)throw new Error(`Usage: pnpm rehearse:console ${scenarios.join('|')}`);
 const fixture=await createRehearsal(scenario as Scenario);
 fixture.server.listen(3198,'127.0.0.1',()=>console.log(`MOCK-ONLY ${scenario}: http://localhost:3198\nLogin token (fake, local only): ${rehearsalToken}`));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{fixture.server.closeAllConnections();fixture.server.close(()=>{fixture.db.close();process.exit(0);});});
}
