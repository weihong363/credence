import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {openDatabase} from '../src/persistence/database.js';
import {LlmClient,llmConfig} from '../src/llm/client.js';
import {claimModelCall} from '../src/application/model-budget.js';
import {githubFetcher} from '../src/providers/source.js';
import {runMission} from '../src/application/missions.js';

const config=llmConfig(); // Fail before creating a task if credentials/model are absent.
const args=process.argv.slice(2);
if(args[0]==='--')args.shift();
const [owner,name,commitSha]=args;
if(!owner||!name)throw new Error('Usage: pnpm mission -- OWNER REPO [40-character-commit]');
const path=process.env.CREDENCE_DB_PATH??'.data/credence.sqlite';mkdirSync(dirname(path),{recursive:true});
const db=openDatabase(path);
try{
 let model:LlmClient|undefined;
 const factory=(taskId:string)=>(model=new LlmClient(config,fetch,()=>claimModelCall(db,taskId,config.model)));
 const result=await runMission(db,factory,'Assess repository architecture and adoption risks with independent source-backed review.',{repository:{owner,name,...(commitSha?{commitSha}: {})}},githubFetcher(process.env.GITHUB_TOKEN),undefined,{profile:'full-review'});
 console.log(JSON.stringify({...result,model:config.model,modelCalls:model?.callCount??0},null,2));
 if(result.status!=='COMPLETED')process.exitCode=1;
}finally{db.close();}
