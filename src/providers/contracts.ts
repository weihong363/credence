import type { Repository, Snapshot } from './source.js';
export interface Evidence {artifactId:string;path:string;startLine:number;endLine:number;anchor:string}
export interface ProviderResult {output:unknown;evidence:Evidence[]}
export interface InventoryOutput {repository:Repository;commitSha:string;files:{path:string;language:string;sha256:string}[];entryPoints:string[];buildCommands:string[];testCommands:string[];exclusions:{path:string;reason:string}[]}
export function anchor(snapshot:Snapshot,path:string,startLine:number,endLine:number):Evidence{
 const file=snapshot.files.find(item=>item.path===path);
 if(!file)throw new Error('MISSING_SOURCE');
 return {artifactId:snapshot.id,path,startLine,endLine,anchor:file.content.split('\n').slice(startLine-1,endLine).join('\n')};
}
export function inventory(snapshot:Snapshot):ProviderResult{
 const evidence:Evidence[]=[];const commands:{build:string[];test:string[]}={build:[],test:[]};const entries:string[]=[];
 const manifest=snapshot.files.find(file=>file.path==='package.json');
 if(manifest){
  try{const data=JSON.parse(manifest.content);
   for(const key of ['main','module'])if(typeof data[key]==='string' && snapshot.files.some(file=>file.path===data[key]))entries.push(data[key]);
   for(const kind of ['build','test'] as const)if(typeof data.scripts?.[kind]==='string')commands[kind].push(data.scripts[kind]);
   if(manifest.content.length<=4000)evidence.push(anchor(snapshot,manifest.path,1,manifest.content.split('\n').length));
   else {commands.build=[];commands.test=[];entries.length=0;}
  }catch{/* Invalid manifests provide no command evidence. */}
 }
 const output:InventoryOutput={repository:snapshot.repository,commitSha:snapshot.repository.commitSha,
  files:snapshot.files.map(({path,language,sha256})=>({path,language,sha256})),entryPoints:entries,
  buildCommands:commands.build,testCommands:commands.test,exclusions:snapshot.exclusions};
 return {output,evidence};
}
