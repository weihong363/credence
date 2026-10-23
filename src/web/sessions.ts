import {randomBytes,createHash} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import {RequestError,sameBytes} from './http.js';
export const SESSION_LIFETIME_MS=3600000;
interface OwnerSession {ownerId:string;csrfToken:string;expiresAt:number}
export interface SessionGrant {cookie:string;csrfToken:string;expiresAt:number}
const digest=(value:string):string=>createHash('sha256').update(value).digest('hex');
/** Process-local sessions intentionally expire on restart; payment state remains in SQLite. */
export class OwnerSessions {
 private readonly sessions=new Map<string,OwnerSession>();
 private failures=0;private blockedUntil=0;
 constructor(private ownerToken:string,private secure:boolean,private clock:()=>number=Date.now){}
 get cookieName():string{return this.secure?'__Host-credence_session':'credence_session';}
 login(ownerId:string,credential:string,cookies?:string):SessionGrant{
  const now=this.clock();this.prune(now);
  if(this.blockedUntil>now)throw new RequestError(429,'LOGIN_THROTTLED');
  if(!sameBytes(credential,this.ownerToken)){
   if(++this.failures>=20){this.blockedUntil=now+60000;this.failures=0;}
   throw new RequestError(401,'OWNER_AUTH_REQUIRED');
  }
  this.failures=0;this.revoke(cookies);
  if(this.sessions.size>=100)throw new RequestError(429,'SESSION_CAPACITY_REACHED');
  const token=randomBytes(32).toString('hex'),csrfToken=randomBytes(32).toString('hex'),expiresAt=now+SESSION_LIFETIME_MS;
  this.sessions.set(digest(token),{ownerId,csrfToken,expiresAt});
  return {cookie:this.cookie(token,3600),csrfToken,expiresAt};
 }
 require(req:IncomingMessage,origin:string):OwnerSession{
  const key=this.key(req.headers.cookie),session=key?this.sessions.get(key):undefined;
  if(!session||session.expiresAt<=this.clock()){
   if(key)this.sessions.delete(key);throw new RequestError(401,'OWNER_AUTH_REQUIRED');
  }
  if(!['GET','HEAD'].includes(req.method??'')){
   if(req.headers.origin!==origin||typeof req.headers['x-csrf-token']!=='string'||!sameBytes(req.headers['x-csrf-token'],session.csrfToken))throw new RequestError(403,'CSRF_FORBIDDEN');
  }
  return session;
 }
 logout(req:IncomingMessage,origin:string):string{
  this.require(req,origin);this.revoke(req.headers.cookie);return this.cookie('',0);
 }
 private key(cookies?:string):string|undefined{
  const values=(cookies??'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(`${this.cookieName}=`));
  if(values.length!==1)return;
  const token=values[0].slice(this.cookieName.length+1);return /^[a-f0-9]{64}$/.test(token)?digest(token):undefined;
 }
 private revoke(cookies?:string):void{const key=this.key(cookies);if(key)this.sessions.delete(key);}
 private cookie(token:string,seconds:number):string{return `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${this.secure?'; Secure':''}`;}
 private prune(now:number):void{for(const [key,session] of this.sessions)if(session.expiresAt<=now)this.sessions.delete(key);}
}
