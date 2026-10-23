import {readFinance} from '../application/finance.js';
import {readActivity} from '../application/activity.js';
import type {ServerResponse} from 'node:http';
import type Database from 'better-sqlite3';
import {readEvents,readLedger,readTask,readTasks,type PageRequest} from '../application/read-model.js';
import {RequestError,sendJson} from './http.js';
function page(url:URL):PageRequest{
 for(const key of url.searchParams.keys())if(!['afterSeq','limit'].includes(key)||url.searchParams.getAll(key).length!==1)throw new RequestError(400,'INVALID_PAGE');
 const after=url.searchParams.get('afterSeq')??'0',limit=url.searchParams.get('limit')??'50';
 if(!/^(0|[1-9]\d{0,15})$/.test(after)||!/^\d{1,3}$/.test(limit))throw new RequestError(400,'INVALID_PAGE');
 const result={afterSeq:Number(after),limit:Number(limit)};
 if(!Number.isSafeInteger(result.afterSeq)||result.limit<1||result.limit>100)throw new RequestError(400,'INVALID_PAGE');return result;
}
export function readRoute(res:ServerResponse,url:URL,db:Database.Database,ownerId:string):boolean{
 if(url.pathname==='/api/finance'){if(url.search)throw new RequestError(400,'INVALID_QUERY');sendJson(res,readFinance(db,ownerId));return true;}
 if(url.pathname==='/api/tasks'){sendJson(res,readTasks(db,ownerId,page(url)));return true;}
 if(url.pathname==='/api/events'){sendJson(res,readEvents(db,ownerId,page(url)));return true;}
 const task=/^\/api\/tasks\/([a-f0-9-]{36})(\/(?:events|activity))?$/.exec(url.pathname);
 if(task){
  if(task[2]==='/activity'){if(url.search)throw new RequestError(400,'INVALID_QUERY');sendJson(res,readActivity(db,ownerId,task[1]));}
  else if(task[2])sendJson(res,readEvents(db,ownerId,page(url),task[1]));
  else {if(url.search)throw new RequestError(400,'INVALID_QUERY');sendJson(res,readTask(db,ownerId,task[1]));}
  return true;
 }
 const ledger=/^\/api\/accounts\/([a-f0-9-]{36})\/ledger$/.exec(url.pathname);
 if(ledger){sendJson(res,readLedger(db,ownerId,ledger[1],page(url)));return true;}
 return false;
}
