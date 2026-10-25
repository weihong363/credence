import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import type {IncomingMessage,ServerResponse,Server} from 'node:http';
import type {Config} from '../config.js';
import type {PaymentPort} from '../payments/port.js';
import type {ControlledModelFactory} from '../application/mission-control.js';
import {MissionControl} from '../application/mission-control.js';
import {Payments} from '../application/payments.js';
import {initializeDemo} from '../application/initialize.js';
import {openDatabase} from '../persistence/database.js';
import {createRuntimeApp} from '../runtime-http.js';
import {consoleRoute} from './static.js';
import {RequestError,readJson,sameBytes,sendJson} from './http.js';
import type {Fetcher} from '../providers/source.js';

const repo={owner:'expressjs',name:'cors',commitSha:'5317ebe670db2aaebc1d496eb5d33493deefb3ed'};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
interface Guest {id:string;csrf:string;expires:number;request_key:string|null;fingerprint:string|null}
interface Context {db:Database.Database;server:Server;missions:MissionControl;payments:Payments}
export interface JudgeOptions {
 directory:string;maxCalls:number;
 model:(db:Database.Database)=>ControlledModelFactory;
 port:()=>PaymentPort;source?:Fetcher;clock?:()=>number;
}
/** Isolated databases and HTTP dispatchers, never extra listening services. Disabled unless explicitly configured. */
export class JudgeDemo {
 private registry:Database.Database;private contexts=new Map<string,Context>();private nextAdmission=0;
 private rates=new Map<string,{until:number;count:number}>();
 private clock:()=>number;private cookieName:string;private stopping=false;
 constructor(private config:Config,private options:JudgeOptions){
  if(!Number.isSafeInteger(options.maxCalls)||options.maxCalls<8||options.maxCalls>80)throw new Error('INVALID_JUDGE_CALL_LIMIT');
  mkdirSync(options.directory,{recursive:true,mode:0o700});this.clock=options.clock??Date.now;
  this.cookieName=config.publicUrl.protocol==='https:'?'__Secure-credence_judge':'credence_judge';
  this.registry=new Database(join(options.directory,'admission.sqlite'));
  this.registry.pragma('journal_mode=WAL');this.registry.pragma('synchronous=FULL');this.registry.pragma('busy_timeout=5000');
  this.registry.exec(`CREATE TABLE IF NOT EXISTS policy(id INTEGER PRIMARY KEY CHECK(id=1),max_calls INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS guests(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,csrf TEXT NOT NULL,expires INTEGER NOT NULL,request_key TEXT,fingerprint TEXT,deadline INTEGER);
   CREATE UNIQUE INDEX IF NOT EXISTS one_judge_request ON guests(request_key) WHERE request_key IS NOT NULL;`);
  this.registry.prepare('INSERT OR IGNORE INTO policy VALUES(1,?)').run(options.maxCalls);
  const policy=this.registry.prepare('SELECT max_calls FROM policy').get() as {max_calls:number};
  if(policy.max_calls!==options.maxCalls){this.registry.close();throw new Error('JUDGE_LIMIT_CHANGE_REQUIRES_REVIEW');}
 }
 private cookie(token:string,age=86400):string{return `${this.cookieName}=${token}; Path=/judge; HttpOnly; SameSite=Strict; Max-Age=${age}${this.config.publicUrl.protocol==='https:'?'; Secure':''}`;}
 private guest(req:IncomingMessage):Guest|undefined{
  const values=(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(`${this.cookieName}=`));
  if(values.length!==1)return;const token=values[0].slice(this.cookieName.length+1);if(!/^[a-f0-9]{64}$/.test(token))return;
  const row=this.registry.prepare('SELECT id,csrf,expires,request_key,fingerprint FROM guests WHERE token_hash=?').get(digest(token)) as Guest|undefined;
  return row&&row.expires>this.clock()?row:undefined;
 }
 private context(id:string):Context{
  const existing=this.contexts.get(id);if(existing)return existing;
  const db=openDatabase(join(this.options.directory,`${id}.sqlite`));initializeDemo(db,1500);
  const missions=new MissionControl(db,this.options.model(db),this.options.source);
  const payments=new Payments(db,this.options.port(),this.config.merchantId,`${this.config.publicUrl.origin}/judge`);
  const context={db,missions,payments,server:createRuntimeApp(this.config,db,payments,undefined,missions)};
  this.contexts.set(id,context);return context;
 }
 private admit(req:IncomingMessage,res:ServerResponse):void{
  const existing=this.guest(req);if(existing){sendJson(res,{csrfToken:existing.csrf,expiresAt:existing.expires});return;}
  if(this.stopping||this.clock()<this.nextAdmission)throw new RequestError(429,'JUDGE_ADMISSION_THROTTLED');
  const token=randomBytes(32).toString('hex'),id=randomUUID(),csrf=randomBytes(32).toString('hex'),expires=this.clock()+86400000;
  this.registry.transaction(()=>{
   const count=(this.registry.prepare('SELECT count(*) n FROM guests').get() as {n:number}).n;
   if(count>=Math.floor(this.options.maxCalls/8))throw new RequestError(429,'JUDGE_CAPACITY_REACHED');
   this.registry.prepare('INSERT INTO guests(id,token_hash,csrf,expires) VALUES(?,?,?,?)').run(id,digest(token),csrf,expires);
  }).immediate();
  this.nextAdmission=this.clock()+10000;this.context(id);
  res.setHeader('Set-Cookie',this.cookie(token));sendJson(res,{csrfToken:csrf,expiresAt:expires});
 }
 private reserve(guest:Guest,key:string,input:unknown):void{
  if(!/^[A-Za-z0-9-]{1,128}$/.test(key))throw new RequestError(400,'INVALID_REQUEST_KEY');
  const value=input as {accountId?:unknown;repository?:unknown};
  if(!value||typeof value!=='object'||JSON.stringify(value.repository)!==JSON.stringify(repo))throw new RequestError(400,'JUDGE_FIXED_REPOSITORY_REQUIRED');
  const fingerprint=digest(JSON.stringify(value));
  this.registry.transaction(()=>{
   const current=this.registry.prepare('SELECT request_key,fingerprint FROM guests WHERE id=?').get(guest.id) as Guest;
   if(current.request_key){if(current.request_key!==key||current.fingerprint!==fingerprint)throw new RequestError(409,'JUDGE_ONE_TASK_PER_SESSION');return;}
   if(this.registry.prepare('SELECT 1 FROM guests WHERE deadline>?').get(this.clock()))throw new RequestError(429,'JUDGE_EXECUTION_BUSY');
   this.registry.prepare('UPDATE guests SET request_key=?,fingerprint=?,deadline=? WHERE id=?').run(key,fingerprint,this.clock()+390000,guest.id);
  }).immediate();
 }
 async route(req:IncomingMessage,res:ServerResponse,url:URL):Promise<boolean>{
  if(url.pathname!=='/judge'&&!url.pathname.startsWith('/judge/'))return false;
  const path=url.pathname.slice(6)||'/';
  if(path==='/'&&['GET','HEAD'].includes(req.method??'')){const page=new URL('/',url);return consoleRoute(req,res,page);}
  if(path.startsWith('/payments/')&&req.method==='GET'){
   const rows=this.registry.prepare('SELECT id FROM guests').all() as {id:string}[];
   const context=rows.map(row=>this.context(row.id)).find(c=>c.db.prepare('SELECT 1 FROM batches WHERE id=?').get(url.searchParams.get('batch')));
   if(!context)throw new RequestError(404,'BATCH_NOT_FOUND');this.dispatch(context,req,res,path+url.search);return true;
  }
  if(!path.startsWith('/api/')||req.headers.authorization!==undefined)throw new RequestError(403,'JUDGE_ROUTE_FORBIDDEN');
  if(!['GET','HEAD'].includes(req.method??'')&&req.headers.origin!==this.config.publicUrl.origin)throw new RequestError(403,'ORIGIN_FORBIDDEN');
  if(path==='/api/session'&&req.method==='POST'){const input=await readJson(req);if(JSON.stringify(input)!=='{}')throw new RequestError(400,'INVALID_GUEST_LOGIN');this.admit(req,res);return true;}
  const guest=this.guest(req);if(!guest)throw new RequestError(401,'JUDGE_SESSION_REQUIRED');
  const rate=this.rates.get(guest.id);if(!rate||rate.until<=this.clock())this.rates.set(guest.id,{until:this.clock()+60000,count:1});
  else if(++rate.count>240)throw new RequestError(429,'JUDGE_RATE_LIMIT');
  if(!['GET','HEAD'].includes(req.method??'')&&(typeof req.headers['x-csrf-token']!=='string'||!sameBytes(req.headers['x-csrf-token'],guest.csrf)))throw new RequestError(403,'CSRF_FORBIDDEN');
  if(path==='/api/session'&&req.method==='GET'){sendJson(res,{csrfToken:guest.csrf,expiresAt:guest.expires});return true;}
  if(path==='/api/session/logout'&&req.method==='POST'){this.registry.prepare('UPDATE guests SET expires=0 WHERE id=?').run(guest.id);res.setHeader('Set-Cookie',this.cookie('',0));sendJson(res,{authenticated:false});return true;}
  if(path==='/api/economy')throw new RequestError(403,'JUDGE_ROUTE_FORBIDDEN');
  if(path==='/api/missions'&&req.method==='POST'){
   const input=await readJson(req);this.reserve(guest,String(req.headers['idempotency-key']??''),input);
   const c=this.context(guest.id),account=c.db.prepare('SELECT owner_id FROM accounts WHERE id=?').get((input as {accountId:string}).accountId) as {owner_id:string}|undefined;
   if(!account)throw new RequestError(403,'ACCOUNT_FORBIDDEN');
   sendJson(res,c.missions.start(account.owner_id,String(req.headers['idempotency-key']),input as never),202);return true;
  }
  this.dispatch(this.context(guest.id),req,res,path+url.search);return true;
 }
 private dispatch(context:Context,req:IncomingMessage,res:ServerResponse,path:string):void{
  req.url=path;req.headers.authorization=`Bearer ${this.config.ownerToken}`;
  context.server.emit('request',req,res);
 }
 async recover():Promise<void>{for(const row of this.registry.prepare('SELECT id FROM guests').all() as {id:string}[])await this.context(row.id).payments.recover();}
 stop():void{this.stopping=true;for(const c of this.contexts.values())c.missions.stop();}
 async close():Promise<void>{this.stop();for(const c of this.contexts.values()){await c.missions.drained();c.db.close();}this.registry.close();}
}
