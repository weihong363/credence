import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import type {Purchase} from './procurement.js';
import {release} from './lifecycle.js';
export function setAccountStatus(db:Database.Database,ownerId:string,accountId:string,status:'OPEN'|'SUSPENDED'|'REVOKED',now=Date.now()):void{
 if(!['OPEN','SUSPENDED','REVOKED'].includes(status))throw new Error('INVALID_POLICY_STATUS');
 db.transaction(()=>{
  const account=db.prepare('SELECT owner_id FROM accounts WHERE id=?').get(accountId) as {owner_id:string}|undefined;
  if(account?.owner_id!==ownerId)throw new Error('ACCOUNT_FORBIDDEN');
  db.prepare('UPDATE accounts SET status=?,version=version+1 WHERE id=?').run(status,accountId);
  db.prepare('INSERT INTO economic_audit(id,account_id,reservation_id,actor_id,action,created_at) VALUES(?,?,NULL,?,?,?)').run(randomUUID(),accountId,ownerId,`POLICY:${status}`,now);
  if(status==='OPEN')return;
  const purchases=db.prepare("SELECT * FROM purchases WHERE account_id=? AND status NOT IN('ACCEPTED','FAILED','CANCELLED','REJECTED')").all(accountId) as Purchase[];
  purchases.forEach(purchase=>release(db,purchase,'CANCELLED',now));
 }).immediate();
}
