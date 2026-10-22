import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LlmClient} from '../src/llm/client.js';
import {claimModelCall} from '../src/application/model-budget.js';
import {runMission} from '../src/application/missions.js';
import {openDatabase} from '../src/persistence/database.js';
import {reconcile} from '../src/application/lifecycle.js';
import {inventory,anchor} from '../src/providers/contracts.js';
import type {Fetcher} from '../src/providers/source.js';
import type {JsonModel} from '../src/llm/client.js';
import {analysisResult} from './runtime-fixture.js';
const content=['{"scripts":{"test":"node --test"}}','export function run(input: string) {\n return JSON.parse(input);\n}\n'];
const blobs=content.map(text=>createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex'));
const sha='a'.repeat(40);
const fetcher=(async(input)=>{
 const url=String(input);let value:unknown={private:false,default_branch:'main'};
 if(url.includes('/commits/'))value={sha};
 if(url.includes('/git/trees/'))value={tree:content.map((text,index)=>({path:['package.json','index.ts'][index],mode:'100644',type:'blob',sha:blobs[index],size:Buffer.byteLength(text)}))};
 if(url.includes('/git/blobs/'))value={encoding:'base64',content:Buffer.from(content[blobs.indexOf(url.split('/').at(-1)!)]).toString('base64')};
 return Response.json(value);
}) as Fetcher;
test('offline full mission: model-selected registry purchases -> verified charges -> cited synthesis',async()=>{
 const db=openDatabase(':memory:');let step=0;
 const model:JsonModel={async complete(system,input){
  if(system.startsWith('Choose')){
   assert.equal((input as any).taskInput.repository.commitSha,sha);
   const capabilityId=['repo.inventory','repo.architecture','repo.risk-review'][step++];
   return capabilityId?{action:'purchase',capabilityId,version:1,reason:'Needed for source-based adoption review'}:{action:'finish',reason:'Review complete'};
  }
  const data=input as any;
  return {repository:data.repository,commitSha:sha,recommendation:'ADOPT_WITH_CONDITIONS',summary:'Review uses purchased evidence.',findings:data.deliveries.map((d:any)=>({claim:'Purchased service completed with source evidence.',acceptedDeliveryIds:[d.id]})),limitations:['Mock model; not a live AI acceptance run.']};
 }};
 try{
 const result=await runMission(db,model,'Review source',{repository:{owner:'example',name:'repo',commitSha:sha}},fetcher,async(purchase,snapshot)=>{
  if(purchase.capability_id==='repo.inventory')return inventory(snapshot);
  if(purchase.capability_id==='repo.architecture')return analysisResult(snapshot);
  const evidence=[anchor(snapshot,'package.json',1,1),anchor(snapshot,'index.ts',1,1)];
  return {output:{repository:snapshot.repository,commitSha:sha,risks:[0,1,2].map(i=>({category:'RELIABILITY',severity:'LOW',claim:`Mock test claim ${i}`,mitigation:'Review input validation',evidenceIndexes:[i%2]})),limitations:['Mock risk content for plumbing test only']},evidence};
 });
 assert.equal(result.status,'COMPLETED');assert.equal(result.acceptedDeliveryIds.length,3);
 assert.deepEqual(db.prepare('SELECT reserved_minor,outstanding_minor FROM accounts').get(),{reserved_minor:0,outstanding_minor:750});
 assert.equal((db.prepare('SELECT spent_minor FROM tasks').get() as {spent_minor:number}).spent_minor,750);reconcile(db);
 }finally{db.close();}
});
test('hallucinated capabilities cannot spend; final cannot cite unaccepted deliveries',async()=>{
 for(const hallucination of [true,false]){
 const db=openDatabase(':memory:');let step=0;
 const model:JsonModel={async complete(system,input){
  if(system.startsWith('Choose'))return step++===0?{action:'purchase',capabilityId:hallucination?'fake.service':'repo.inventory',version:1,reason:'test'}:{action:'finish',reason:'done'};
  const data=input as any;return {repository:data.repository,commitSha:sha,recommendation:'ADOPT',summary:'test',findings:[{claim:'unverified',acceptedDeliveryIds:['not-accepted']}],limitations:[]};
 }};
 try{const result=await runMission(db,model,'Review',{repository:{owner:'example',name:'repo'}},fetcher,async(_,snapshot)=>inventory(snapshot));
 assert.equal(result.status,'ACTION_REQUIRED');assert.equal(result.acceptedDeliveryIds.length,hallucination?0:1);reconcile(db);
 }finally{db.close();}}
});

test('separate missions on one account do not collide on coordinator idempotency keys',async()=>{
 const db=openDatabase(':memory:');
 try{for(let run=0;run<2;run++){
  let choice=0;
  const model:JsonModel={async complete(system,input){
   if(system.startsWith('Choose'))return choice++===0?{action:'purchase',capabilityId:'repo.inventory',version:1,reason:'Inspect source'}:{action:'finish',reason:'Inventory complete'};
   const data=input as any;return {repository:data.repository,commitSha:sha,recommendation:'INSUFFICIENT_EVIDENCE',summary:'Inventory only',findings:[{claim:'Inventory available',acceptedDeliveryIds:[data.deliveries[0].id]}],limitations:['No architecture/risk review']};
  }};
  const result=await runMission(db,model,'Inspect',{repository:{owner:'example',name:'repo'}},fetcher,async(_,snapshot)=>inventory(snapshot));
  assert.equal(result.status,'COMPLETED');
 }
 assert.equal((db.prepare('SELECT outstanding_minor FROM accounts').get() as {outstanding_minor:number}).outstanding_minor,250);reconcile(db);
 }finally{db.close();}
});

test('production adapters with mocked HTTP: correction headroom under the durable eight-call budget',async()=>{
 for(const corrections of [0,1,2]){
  const db=openDatabase(':memory:');let decisionIndex=0;const attempts=new Map<string,number>();let taskId='';
  const transport=(async(_url,options)=>{
   const body=JSON.parse(options?.body as string);
   const system=body.messages[0].content as string;const input=JSON.parse(body.messages[1].content);
   let response:unknown;
   if(system.startsWith('Choose')){
    const capabilityId=['repo.inventory','repo.architecture','repo.risk-review'][decisionIndex++];
    response=capabilityId?{action:'purchase',capabilityId,version:1,reason:'Required review'}:{action:'finish',reason:'All services accepted'};
   }else if(system.startsWith('Perform')){
    const architecture=system.includes('architecture analysis');const key=architecture?'architecture':'risk';
    const attempt=(attempts.get(key)??0)+1;attempts.set(key,attempt);
    const shouldCorrect=attempt===1&&(architecture?corrections>=1:corrections>=2);
    const common={repository:input.source.repository,commitSha:input.source.repository.commitSha};
    const output=architecture?{...common,components:[{name:'Manifest',responsibility:'Declares tests',evidenceIndexes:[0]},{name:'Parser',responsibility:'Parses input',evidenceIndexes:[1]}],dependencies:[],limitations:[]}
     :{...common,risks:[0,1,2].map(index=>({category:'RELIABILITY',severity:'LOW',claim:`Mock claim ${index}`,mitigation:'Review source',evidenceIndexes:[index%2]})),limitations:['Mock output, not live risk evidence']};
    response={output,evidenceLines:shouldCorrect?[]:[{path:'package.json',line:1},{path:'index.ts',line:2}]};
   }else{
    response={repository:input.repository,commitSha:input.commitSha,recommendation:'ADOPT_WITH_CONDITIONS',summary:'Mock three-service report',findings:input.deliveries.map((delivery:{id:string})=>({claim:'Accepted mock service',acceptedDeliveryIds:[delivery.id]})),limitations:['Offline transport fixture']};
   }
   return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(response)}}]});
  }) as Fetcher;
  try{
   const result=await runMission(db,id=>{taskId=id;return new LlmClient({baseUrl:'https://model.example',model:'fixture',apiKey:'fake-key'},transport,()=>claimModelCall(db,id,'fixture'));},'Review all three capabilities',{repository:{owner:'example',name:'repo'}},fetcher);
   assert.equal(result.acceptedDeliveryIds.length,3);
   assert.equal(result.status,corrections<2?'COMPLETED':'ACTION_REQUIRED');
   if(corrections===2)assert.deepEqual(result.result,{reason:'MODEL_CALL_BUDGET'});
   assert.equal((db.prepare('SELECT count(*) n FROM model_calls WHERE task_id=?').get(taskId) as {n:number}).n,corrections===0?7:8);
   assert.equal((db.prepare('SELECT outstanding_minor FROM accounts').get() as {outstanding_minor:number}).outstanding_minor,750);
   reconcile(db);
  }finally{db.close();}
 }
});
