import type Database from 'better-sqlite3';
import {seedDemo,type DemoIdentity} from '../registry/catalog.js';
import {setAccountLimit} from './policy.js';
import {usd} from '../domain/money.js';

/** Explicit operator action only; never run automatically at server startup. */
export function initializeDemo(db:Database.Database,limitMinor:number):DemoIdentity{
 usd(limitMinor);
 if(limitMinor<400)throw new Error('LIMIT_BELOW_PURCHASE_CAP');
 return db.transaction(()=>{
  const accounts=db.prepare('SELECT id accountId,owner_id ownerId,buyer_id buyerId,limit_minor FROM accounts').all() as (DemoIdentity&{limit_minor:number})[];
  if(accounts.length){
   if(accounts.length!==1)throw new Error('INITIALIZATION_CONFLICT');
   const account=accounts[0];
   const buyer=db.prepare("SELECT 1 FROM agents WHERE id=? AND owner_id=? AND name='Coordinator A' AND role='BUYER'").get(account.buyerId,account.ownerId);
   if(!buyer||account.limit_minor!==limitMinor)throw new Error('INITIALIZATION_CONFLICT');
   return {ownerId:account.ownerId,buyerId:account.buyerId,accountId:account.accountId};
  }
  for(const table of ['owners','agents','capabilities','tasks','purchases','charges','batches','ledger_events','economic_audit']){
   if(db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())throw new Error('INITIALIZATION_REQUIRES_EMPTY_DATABASE');
  }
  const identity=seedDemo(db);
  setAccountLimit(db,identity.ownerId,identity.accountId,limitMinor);
  return identity;
 }).immediate();
}
