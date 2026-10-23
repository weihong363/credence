import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Config} from '../config.js';
import {object,text} from '../domain/json.js';
import {RequestError,readJson,sameBytes,sendJson} from './http.js';
import {OwnerSessions} from './sessions.js';
export async function sessionRoute(req:IncomingMessage,res:ServerResponse,url:URL,config:Config,sessions:OwnerSessions,owner:()=>string):Promise<boolean>{
 if(url.pathname==='/api/session'&&req.method==='POST'){
  if(req.headers.origin!==config.publicUrl.origin)throw new RequestError(403,'ORIGIN_FORBIDDEN');
  const input=object(await readJson(req),['ownerToken']);
  const grant=sessions.login(owner(),text(input.ownerToken,1024),req.headers.cookie);
  res.setHeader('Set-Cookie',grant.cookie);sendJson(res,{authenticated:true,csrfToken:grant.csrfToken,expiresAt:grant.expiresAt});return true;
 }
 if(url.pathname==='/api/session'&&req.method==='GET'){
  const session=sessions.require(req,config.publicUrl.origin);
  if(session.ownerId!==owner())throw new RequestError(403,'OWNER_CHANGED');
  sendJson(res,{authenticated:true,csrfToken:session.csrfToken,expiresAt:session.expiresAt});return true;
 }
 if(url.pathname==='/api/session/logout'&&req.method==='POST'){
  const session=sessions.require(req,config.publicUrl.origin);
  if(session.ownerId!==owner())throw new RequestError(403,'OWNER_CHANGED');
  res.setHeader('Set-Cookie',sessions.logout(req,config.publicUrl.origin));sendJson(res,{authenticated:false});return true;
 }
 if(['/api/session','/api/session/logout'].includes(url.pathname))throw new RequestError(405,'METHOD_NOT_ALLOWED');
 return false;
}
export function authenticatedOwner(req:IncomingMessage,config:Config,sessions:OwnerSessions,owner:()=>string):string{
 if(req.headers.authorization!==undefined){
  if(!sameBytes(req.headers.authorization,`Bearer ${config.ownerToken}`))throw new RequestError(401,'OWNER_AUTH_REQUIRED');
  return owner();
 }
 const session=sessions.require(req,config.publicUrl.origin);
 if(session.ownerId!==owner())throw new RequestError(403,'OWNER_CHANGED');return session.ownerId;
}
