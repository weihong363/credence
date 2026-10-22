import type Database from 'better-sqlite3';
import {hash} from '../domain/json.js';
import type {Snapshot} from '../providers/source.js';

export function persistSnapshot(db:Database.Database,taskId:string,snapshot:Snapshot,now=Date.now()):void{
 db.transaction(()=>{
  const input={repository:snapshot.repository,snapshotId:snapshot.id};
  db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?)').run(snapshot.id,taskId,JSON.stringify(snapshot),hash(snapshot),now);
  db.prepare('UPDATE tasks SET input_json=? WHERE id=?').run(JSON.stringify(input),taskId);
 }).immediate();
}
export function loadSnapshot(db:Database.Database,taskId:string):Snapshot{
 const row=db.prepare('SELECT payload_json,payload_hash FROM snapshots WHERE task_id=?').get(taskId) as {payload_json:string;payload_hash:string}|undefined;
 if(!row)throw new Error('SNAPSHOT_REQUIRED');
 const snapshot=JSON.parse(row.payload_json) as Snapshot;
 if(hash(snapshot)!==row.payload_hash)throw new Error('SNAPSHOT_HASH_MISMATCH');
 return snapshot;
}
