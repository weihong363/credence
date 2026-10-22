import {createHash} from 'node:crypto';
import {object,text,canonical} from '../domain/json.js';
import type {Snapshot} from './source.js';
import type {Evidence,ProviderResult} from './contracts.js';
export interface Verification {pass:boolean;reasons:string[]}
function list(value:unknown,min:number,max:number):unknown[]{
 if(!Array.isArray(value)||value.length<min||value.length>max)throw new Error('INVALID_SCHEMA');return value;
}
function evidence(snapshot:Snapshot,value:unknown):Evidence[]{
 return list(value,0,100).map(item=>{
  const anchor=object(item,['artifactId','path','startLine','endLine','anchor']);
  const file=snapshot.files.find(file=>file.path===anchor.path);
  const start=anchor.startLine as number,end=anchor.endLine as number;
  if(anchor.artifactId!==snapshot.id||!file||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start||end>file.content.split('\n').length)throw new Error('EVIDENCE_RANGE');
  if(createHash('sha256').update(file.content).digest('hex')!==file.sha256)throw new Error('SOURCE_HASH');
  if(text(anchor.anchor)!==file.content.split('\n').slice(start-1,end).join('\n'))throw new Error('EVIDENCE_ANCHOR');
  return anchor as unknown as Evidence;
 });
}
function indexes(value:unknown,anchors:Evidence[]):number[]{
 return list(value,1,100).map(index=>{if(!Number.isInteger(index)||(index as number)<0||(index as number)>=anchors.length)throw new Error('EVIDENCE_REFERENCE');return index as number;});
}
function narrative(value:unknown):void{list(value,0,20).forEach(item=>text(item));}
function architecture(value:Record<string,unknown>,anchors:Evidence[]):void{
 const names=new Set<string>();
 for(const item of list(value.components,2,20)){
  const component=object(item,['name','responsibility','evidenceIndexes']);const name=text(component.name,120);
  if(names.has(name))throw new Error('DUPLICATE_COMPONENT');names.add(name);text(component.responsibility);indexes(component.evidenceIndexes,anchors);
 }
 for(const item of list(value.dependencies,0,50)){
  const edge=object(item,['from','to','evidenceIndexes']);
  if(!names.has(edge.from as string)||!names.has(edge.to as string))throw new Error('UNKNOWN_COMPONENT');indexes(edge.evidenceIndexes,anchors);
 }
 narrative(value.limitations);
}
function risks(value:Record<string,unknown>,anchors:Evidence[]):void{
 const paths=new Set<string>();const claims=new Set<string>();
 for(const item of list(value.risks,3,20)){
  const risk=object(item,['category','severity','claim','mitigation','evidenceIndexes']);
  if(!['SECURITY','RELIABILITY','MAINTAINABILITY','ADOPTION'].includes(risk.category as string)||!['LOW','MEDIUM','HIGH'].includes(risk.severity as string))throw new Error('INVALID_SCHEMA');
  const claim=text(risk.claim);if(claims.has(claim))throw new Error('DUPLICATE_RISK');claims.add(claim);text(risk.mitigation);indexes(risk.evidenceIndexes,anchors).forEach(index=>paths.add(anchors[index].path));
 }
 if(paths.size<2)throw new Error('INSUFFICIENT_EVIDENCE');narrative(value.limitations);
}
function inventory(value:Record<string,unknown>,anchors:Evidence[],snapshot:Snapshot):void{
 const paths=new Set<string>();
 for(const item of list(value.files,1,100)){
  const file=object(item,['path','language','sha256']);const source=snapshot.files.find(source=>source.path===file.path);
  if(!source||source.sha256!==file.sha256||source.language!==file.language||paths.has(source.path))throw new Error('INVENTORY_MISMATCH');paths.add(source.path);
 }
 if(paths.size!==snapshot.files.length)throw new Error('INVENTORY_MISMATCH');
 let manifest:Record<string,any>={};
 try{manifest=JSON.parse(snapshot.files.find(file=>file.path==='package.json')?.content??'{}');}catch{}
 list(value.entryPoints,0,20).forEach(path=>{if(!paths.has(path as string)||![manifest?.main,manifest?.module].includes(path))throw new Error('ENTRY_POINT');});
 for(const key of ['buildCommands','testCommands'])list(value[key],0,20).forEach(command=>{
  text(command);const kind=key==='buildCommands'?'build':'test';
  if(manifest?.scripts?.[kind]!==command||!anchors.some(anchor=>anchor.path==='package.json'&&anchor.anchor.includes(command as string)))throw new Error('COMMAND_EVIDENCE');
 });
 if(canonical(value.exclusions)!==canonical(snapshot.exclusions))throw new Error('EXCLUSIONS_MISMATCH');
}
export function verifyResult(capabilityId:string,result:ProviderResult,snapshot:Snapshot):Verification{
 try{
  object(result,['output','evidence']);if(Buffer.byteLength(JSON.stringify(result))>65536)throw new Error('DELIVERY_SIZE_LIMIT');
  const anchors=evidence(snapshot,result.evidence);
  const fields=capabilityId==='repo.inventory'?['files','entryPoints','buildCommands','testCommands','exclusions']:capabilityId==='repo.architecture'?['components','dependencies','limitations']:['risks','limitations'];
  const output=object(result.output,['repository','commitSha',...fields]);
  if(canonical(output.repository)!==canonical(snapshot.repository)||output.commitSha!==snapshot.repository.commitSha)throw new Error('REVISION_MISMATCH');
  if(capabilityId==='repo.inventory')inventory(output,anchors,snapshot);
  else if(capabilityId==='repo.architecture')architecture(output,anchors);
  else if(capabilityId==='repo.risk-review')risks(output,anchors);
  else throw new Error('UNKNOWN_CAPABILITY');
  return {pass:true,reasons:[]};
 }catch(error){return {pass:false,reasons:[(error as Error).message]};}
}
