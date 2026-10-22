import {randomUUID,createHash} from 'node:crypto';
import {openDatabase} from '../src/persistence/database.js';
import {seedDemo,createTask} from '../src/registry/catalog.js';
import type {Snapshot} from '../src/providers/source.js';
import {persistSnapshot} from '../src/application/snapshots.js';
import {requestQuote,proposePurchase} from '../src/application/procurement.js';
import {anchor,type ProviderResult} from '../src/providers/contracts.js';
export function source():Snapshot{
 const files=[{path:'package.json',content:'{"scripts":{"test":"node --test"}}',language:'JSON'},
 {path:'index.ts',content:'export function run(input: string) {\n return JSON.parse(input);\n}\n',language:'TypeScript'}];
 return {id:randomUUID(),repository:{owner:'example',name:'repo',commitSha:'a'.repeat(40)},files:files.map(file=>({...file,sha256:createHash('sha256').update(file.content).digest('hex')})),exclusions:[]};
}
export function setupRuntime(capabilityId='repo.architecture',path=':memory:'){
 const db=openDatabase(path);const identity=seedDemo(db,100);const snapshot=source();
 const taskId=createTask(db,identity,'review source',{repository:snapshot.repository},100);
 persistSnapshot(db,taskId,snapshot,100);const context={...identity,taskId};
 const quote=requestQuote(db,context,capabilityId,1,100);const purchase=proposePurchase(db,context,quote.id,'first',100);
 return {db,snapshot,context,purchase};
}
export function analysisResult(snapshot:Snapshot):ProviderResult{
 return {output:{repository:snapshot.repository,commitSha:snapshot.repository.commitSha,components:[
  {name:'Build',responsibility:'Defines test command',evidenceIndexes:[0]},
  {name:'Runtime',responsibility:'Parses JSON input',evidenceIndexes:[1]},
 ],dependencies:[],limitations:['Objective evidence does not prove semantic quality.']},
 evidence:[anchor(snapshot,'package.json',1,1),anchor(snapshot,'index.ts',1,3)]};
}
