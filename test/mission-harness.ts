import {createHash} from 'node:crypto';
import type Database from 'better-sqlite3';
import {LlmClient} from '../src/llm/client.js';
import {claimModelCall} from '../src/application/model-budget.js';
import type {Fetcher} from '../src/providers/source.js';
export const revision='a'.repeat(40);
const content=['{"scripts":{"test":"node --test"}}','export function run(input: string) {\n return JSON.parse(input);\n}\n'];
const blobs=content.map(text=>createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex'));
export const repositoryInput={repository:{owner:'example',name:'repo',commitSha:revision}};
export const sourceFetcher=(async(input)=>{
 const url=String(input);let value:unknown={private:false,default_branch:'main'};
 if(url.includes('/commits/'))value={sha:revision};
 if(url.includes('/git/trees/'))value={tree:content.map((text,index)=>({path:['package.json','index.ts'][index],mode:'100644',type:'blob',sha:blobs[index],size:Buffer.byteLength(text)}))};
 if(url.includes('/git/blobs/'))value={encoding:'base64',content:Buffer.from(content[blobs.indexOf(url.split('/').at(-1)!)]).toString('base64')};
 return Response.json(value);
}) as Fetcher;
export interface HarnessOptions {
 capabilities?:string[]; corrections?:number; retryProviders?:boolean;
 protocolErrors?:boolean; missingCoverage?:boolean; unknownFinding?:boolean; rejectRisk?:boolean;
}
interface ModelInput {
 profile?:string;source?:{repository:unknown};repository?:unknown;commitSha?:string;
 deliveries?:{id:string}[];
}
function providerResult(input:ModelInput,architecture:boolean,invalid:boolean):unknown{
 const common={repository:input.source!.repository,commitSha:revision};
 const output=architecture?{...common,components:[{name:'Manifest',responsibility:'Declares tests',evidenceIndexes:[0]},{name:'Parser',responsibility:'Parses input',evidenceIndexes:[1]}],dependencies:[],limitations:[]}
  :{...common,risks:[0,1,2].map(index=>({category:'RELIABILITY',severity:'LOW',claim:`Mock claim ${index}`,mitigation:'Review source',evidenceIndexes:[index%2]})),limitations:['Offline mock content, not real risks']};
 return {output,evidenceLines:invalid?[]:[{path:'package.json',line:1},{path:'index.ts',line:2}]};
}
function finalResult(input:ModelInput,options:HarnessOptions):unknown{
 const deliveries=options.missingCoverage?input.deliveries!.slice(0,1):input.deliveries!;
 return {repository:input.repository,commitSha:input.commitSha,recommendation:'ADOPT_WITH_CONDITIONS',summary:'Offline mock report',
  findings:deliveries.map(delivery=>({claim:'Accepted mock delivery',acceptedDeliveryIds:[options.unknownFinding?'not-accepted':delivery.id]})),limitations:['Offline transport fixture']};
}
export function missionHarness(db:Database.Database,options:HarnessOptions={}){
 let planningRequests=0;
 const requests=new Map<string,number>(),attempts=new Map<string,number>();
 const transport=(async(_url,init)=>{
  const body=JSON.parse(init?.body as string);
  const system=body.messages[0].content as string,input=JSON.parse(body.messages[1].content) as ModelInput;
  let result:unknown;
  if(system.startsWith('Plan')){
   planningRequests++;
   const ids=options.capabilities??['repo.inventory','repo.architecture','repo.risk-review'];
   result={purchases:ids.map(capabilityId=>({capabilityId,version:1,reason:'Needed for requested scope'}))};
  }else if(system.startsWith('Perform')){
   const architecture=system.includes('architecture analysis'),key=architecture?'architecture':'risk';
   const request=(requests.get(key)??0)+1;requests.set(key,request);
   if(options.retryProviders&&request===1)return new Response('',{status:503});
   const attempt=(attempts.get(key)??0)+1;attempts.set(key,attempt);
   const invalid=(!architecture&&options.rejectRisk)||attempt===1&&(architecture?(options.corrections??0)>=1:(options.corrections??0)>=2);
   if(options.protocolErrors&&attempt===1){
    if(!architecture)return Response.json({choices:[{message:{content:'not-json'}}]});
    result={output:{}};
   }else result=providerResult(input,architecture,!!invalid);
  }else result=finalResult(input,options);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});
 }) as Fetcher;
 return {factory:(id:string)=>new LlmClient({baseUrl:'https://model.example',model:'fixture',apiKey:'fake-key'},transport,()=>claimModelCall(db,id,'fixture')),
  planningRequests:()=>planningRequests};
}
