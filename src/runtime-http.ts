import {MissionControl} from './application/mission-control.js';
import {missionRoute} from './web/mission-routes.js';
import {consoleRoute} from './web/static.js';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {RequestError,readJson as body,sendJson as send} from './web/http.js';
import {OwnerSessions} from './web/sessions.js';
import {sessionRoute,authenticatedOwner} from './web/session-routes.js';
import {readRoute} from './web/read-routes.js';
import type Database from 'better-sqlite3';
import type {Config} from './config.js';
import {object,text} from './domain/json.js';
import {freezeBatch} from './application/batches.js';
import {Payments} from './application/payments.js';
import {paymentHint} from './application/payment-callbacks.js';
import type {PaymentAction} from './application/payment-records.js';
function owner(db:Database.Database):string{
 const rows=db.prepare('SELECT DISTINCT owner_id FROM accounts').all() as {owner_id:string}[];
 if(rows.length!==1)throw new Error('SINGLE_OWNER_REQUIRED');return rows[0].owner_id;
}
function economy(db:Database.Database){
 return {accounts:db.prepare('SELECT id,limit_minor,reserved_minor,outstanding_minor,limit_minor-reserved_minor-outstanding_minor available_minor,status FROM accounts').all(),
 charges:db.prepare(`SELECT c.id,c.account_id,c.task_id,c.purchase_id,c.delivery_id,c.amount_minor,c.currency,
 EXISTS(SELECT 1 FROM ledger_events WHERE charge_id=c.id AND type='CHARGE_REVERSED') reversed FROM charges c`).all()};
}
export function createRuntimeApp(config:Config,db:Database.Database,payments:Payments,sessions=new OwnerSessions(config.ownerToken,config.publicUrl.protocol==='https:'),missions=new MissionControl(db,undefined),publicRoute?:(req:IncomingMessage,res:ServerResponse,url:URL)=>Promise<boolean>){
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; form-action 'self'");
  try{
   const url=new URL(req.url??'/',config.publicUrl);
   if(req.method==='GET'&&url.pathname==='/health'){send(res,{status:'ok',paymentEnvironment:'sandbox'});return;}
   if(req.headers.host!==config.publicUrl.host||url.origin!==config.publicUrl.origin||(req.headers.origin!==undefined&&req.headers.origin!==config.publicUrl.origin)){send(res,{error:'ORIGIN_FORBIDDEN'},403);return;}
   if(publicRoute&&await publicRoute(req,res,url))return;
   if(consoleRoute(req,res,url))return;
   if(req.method==='GET'&&['/payments/return','/payments/cancel'].includes(url.pathname)){
    paymentHint(db,url.searchParams.get('batch')??'',url.searchParams.get('state')??'',url.searchParams.get('token')??'',url.pathname.endsWith('cancel')?'cancel':'return');
    res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'}).end('Buyer return recorded. Payment is not proven by this redirect. The owner must request capture or reconciliation.');return;
   }
   if(await sessionRoute(req,res,url,config,sessions,()=>owner(db)))return;
   const ownerId=authenticatedOwner(req,config,sessions,()=>owner(db));
   if(['/api/create','/api/capture','/api/settlement','/api/cancel','/api/resume','/api/verify','/return','/cancel'].includes(url.pathname)){send(res,{error:'P0_ARCHIVED_USE_BATCH_API'},410);return;}
   if(await missionRoute(req,res,url,ownerId,missions))return;
   await route(req,res,url,config,db,payments,ownerId);
  }catch(error){
   const code=error instanceof Error&&/^[A-Z_]{1,80}$/.test(error.message)?error.message:'OPERATION_INCOMPLETE';
   if(!res.headersSent)send(res,{error:code},error instanceof RequestError?error.status:code.endsWith('FORBIDDEN')?403:code.endsWith('NOT_FOUND')?404:409);else res.end();
  }
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 return server;
}
async function route(req:IncomingMessage,res:ServerResponse,url:URL,config:Config,db:Database.Database,payments:Payments,ownerId:string):Promise<void>{
 if(req.method==='GET'&&url.pathname==='/api/economy'){send(res,economy(db));return;}
 if(req.method==='GET'&&readRoute(res,url,db,ownerId))return;
 if(req.method==='GET'&&url.pathname==='/api/batches'){
  const ids=db.prepare('SELECT id FROM batches WHERE owner_id=? ORDER BY frozen_at').all(ownerId) as {id:string}[];
  send(res,ids.map(({id})=>payments.view(ownerId,id)));return;
 }
 if(req.method==='POST'&&url.pathname==='/api/batches'){
  const input=object(await body(req),['accountId','chargeIds']);
  if(!Array.isArray(input.chargeIds)||input.chargeIds.some(id=>typeof id!=='string'))throw new Error('INVALID_CHARGE_SELECTION');
  const batch=freezeBatch(db,config.merchantId,{ownerId,accountId:text(input.accountId,128),chargeIds:input.chargeIds,key:text(req.headers['idempotency-key'],128)});
  send(res,payments.view(ownerId,batch.id));return;
 }
 const match=/^\/api\/batches\/([a-f0-9-]{36})(?:\/(order|capture|cancel|resume|reconcile))?$/.exec(url.pathname);
 if(!match){send(res,{error:'NOT_FOUND'},404);return;}
 const [,id,action]=match;
 if(req.method==='GET'&&!action){send(res,payments.view(ownerId,id));return;}
 if(req.method!=='POST'||!action){send(res,{error:'METHOD_NOT_ALLOWED'},405);return;}
 const versioned=['capture','cancel','resume'].includes(action),input=object(await body(req),versioned?['expectedVersion']:[]);
 if(versioned&&(!Number.isSafeInteger(input.expectedVersion)||(input.expectedVersion as number)<0))throw new Error('INVALID_VERSION');
 const result=await payments.run(ownerId,id,action as PaymentAction,text(req.headers['idempotency-key'],128),versioned?input.expectedVersion as number:undefined);
 send(res,result,['UNKNOWN','PAYMENT_PENDING','CAPTURING'].includes(result.batch.state)?202:200);
}
