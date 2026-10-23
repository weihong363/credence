import type {IncomingMessage,ServerResponse} from 'node:http';
import type {MissionControl,StartMission} from '../application/mission-control.js';
import {object,text} from '../domain/json.js';
import {readJson,sendJson,RequestError} from './http.js';
export async function missionRoute(req:IncomingMessage,res:ServerResponse,url:URL,owner:string,control:MissionControl):Promise<boolean>{
 if(req.method==='GET'&&url.pathname==='/api/missions/config'){sendJson(res,{enabled:control.enabled,profile:'full-review',budgetMinor:1000,maxModelCalls:8,deadlineMs:300000});return true;}
 const lookup=/^\/api\/mission-requests\/([A-Za-z0-9-]{1,128})$/.exec(url.pathname);
 if(req.method==='GET'&&lookup){if(url.search)throw new RequestError(400,'INVALID_QUERY');sendJson(res,control.lookup(owner,lookup[1]));return true;}
 if(req.method==='POST'&&url.pathname==='/api/missions'){
  const input=object(await readJson(req),['accountId','repository']);
  const repository=object(input.repository,['owner','name','commitSha']);
  const request:StartMission={accountId:text(input.accountId,128),repository:{owner:text(repository.owner,100),name:text(repository.name,100),commitSha:text(repository.commitSha,40)}};
  sendJson(res,control.start(owner,text(req.headers['idempotency-key'],128),request),202);return true;
 }
 const resume=/^\/api\/tasks\/([a-f0-9-]{36})\/resume$/.exec(url.pathname);
 if(req.method==='POST'&&resume){object(await readJson(req),[]);sendJson(res,control.resume(owner,resume[1],text(req.headers['idempotency-key'],128)),202);return true;}
 return false;
}
