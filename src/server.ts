import {MissionControl} from './application/mission-control.js';
import {LlmClient,llmConfig,type LlmConfig} from './llm/client.js';
import {claimModelCall} from './application/model-budget.js';
import {githubFetcher} from './providers/source.js';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {readConfig} from './config.js';
import {PayPal} from './paypal.js';
import {PayPalAdapter} from './payments/paypal-adapter.js';
import {Payments} from './application/payments.js';
import {reconcile} from './application/lifecycle.js';
import {openDatabase} from './persistence/database.js';
import {createRuntimeApp} from './runtime-http.js';
import {JudgeDemo} from './web/judge-demo.js';
const config=readConfig();mkdirSync(config.dataDir,{recursive:true,mode:0o700});
const db=openDatabase(process.env.CREDENCE_DB_PATH??join(config.dataDir,'credence.sqlite'));reconcile(db);
const payments=new Payments(db,new PayPalAdapter(new PayPal(config.clientId,config.clientSecret,fetch,config.paypalBaseUrl)),config.merchantId,config.publicUrl.origin);
let modelConfig:LlmConfig|undefined;try{modelConfig=llmConfig();}catch{/* Mission start stays disabled until server credentials are configured. */}
const missions=new MissionControl(db,modelConfig?(id,guard)=>new LlmClient(modelConfig!,fetch,()=>{guard();claimModelCall(db,id,modelConfig!.model);}):undefined,githubFetcher(process.env.GITHUB_TOKEN));
if(process.env.JUDGE_MAX_MODEL_CALLS&&!modelConfig)throw new Error('JUDGE_REQUIRES_LLM_CONFIGURATION');
const judge=process.env.JUDGE_MAX_MODEL_CALLS?new JudgeDemo(config,{directory:join(config.dataDir,'judge'),maxCalls:Number(process.env.JUDGE_MAX_MODEL_CALLS),port:()=>new PayPalAdapter(new PayPal(config.clientId,config.clientSecret,fetch,config.paypalBaseUrl)),
 model:guestDb=>(id,guard)=>{if(!modelConfig)throw new Error('LLM_CONFIGURATION_REQUIRED');return new LlmClient(modelConfig,fetch,()=>{guard();claimModelCall(guestDb,id,modelConfig!.model);});},source:githubFetcher(process.env.GITHUB_TOKEN)}):undefined;
const server=createRuntimeApp(config,db,payments,undefined,missions,judge?(req,res,url)=>judge.route(req,res,url):undefined);
let stopping=false;
const polling=setInterval(()=>{if(!stopping){void payments.recover().catch(()=>console.error('Payment reconciliation delayed.'));void judge?.recover().catch(()=>console.error('Judge reconciliation delayed.'));}},30000);polling.unref();
function stop():void{
 if(stopping)return;stopping=true;clearInterval(polling);missions.stop();judge?.stop();
 server.close(()=>{void Promise.all([missions.drained(),judge?.close()]).then(()=>{db.close();process.exit(0);});});setTimeout(()=>process.exit(1),25000).unref();
}
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,stop);
server.on('error',()=>{console.error('Server could not listen; check host, port and process ownership.');db.close();process.exit(1);});
server.listen(config.port,config.host,()=>{console.log('Credence Sandbox server ready');void payments.recover().catch(()=>console.error('Payment reconciliation delayed.'));});
