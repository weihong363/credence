import {api,ApiError} from './api.js';
import type {TaskSummary} from '../src/application/read-model.js';
interface Draft {key:string;accountId:string;repository:{owner:string;name:string;commitSha:string}}
const journal=typeof location!=='undefined'&&location.pathname.startsWith('/judge')?'credence.judge.pendingMission':'credence.pendingMission';
export class MissionForm {
 private epoch=0;private busy=false;private checked=false;private loaded=false;
 constructor(private csrf:()=>string,private selected:(task:TaskSummary)=>void,private notice:(text:string)=>void,private error:(error:unknown)=>void){
  document.getElementById('mission-form')!.onsubmit=event=>{event.preventDefault();void this.start();};
 }
 clear():void{this.epoch++;this.loaded=false;this.checked=false;(document.getElementById('authorize-model') as HTMLInputElement).checked=false;}
 async refresh():Promise<void>{
  const epoch=this.epoch;
  const [config,finance]=await Promise.all([api<{enabled:boolean}>('/api/missions/config'),api<{accounts:{id:string;status:string}[]}>('/api/finance')]);
  if(epoch!==this.epoch||!this.csrf())return;
  const button=document.getElementById('start-mission') as HTMLButtonElement;
  button.disabled=this.busy||!config.enabled;document.getElementById('mission-config')!.textContent=config.enabled?'Model endpoint configured. Starting requires your explicit authorization below.':'Mission execution disabled: configure the server LLM endpoint/model/key and deploy first.';
  const select=document.getElementById('mission-account') as HTMLSelectElement;
  if(!this.loaded){select.replaceChildren();for(const account of finance.accounts.filter(a=>a.status==='OPEN')){const option=document.createElement('option');option.value=account.id;option.textContent=account.id;select.append(option);}this.loaded=true;}
  if(!this.checked){this.checked=true;await this.recover();}
 }
 private pending():Draft|null{
  const raw=sessionStorage.getItem(journal);if(!raw)return null;
  const draft=JSON.parse(raw) as Draft;
  if(!/^[a-f0-9-]{36}$/.test(draft.key)||typeof draft.accountId!=='string'||typeof draft.repository?.owner!=='string'||typeof draft.repository.name!=='string'||!/^([a-f0-9]{40})$/.test(draft.repository.commitSha))throw new Error('INVALID_PENDING_MISSION');
  return draft;
 }
 private async recover():Promise<void>{
  const epoch=this.epoch;const draft=this.pending();if(!draft)return;
  for(const [id,value] of [['repo-owner',draft.repository.owner],['repo-name',draft.repository.name],['repo-commit',draft.repository.commitSha]]){const input=document.getElementById(id) as HTMLInputElement;input.value=value;input.readOnly=true;}
  (document.getElementById('mission-account') as HTMLSelectElement).value=draft.accountId;
  try{const task=await api<TaskSummary>(`/api/mission-requests/${draft.key}`);if(epoch===this.epoch){this.complete(task);this.notice('Recovered the original task request. No new model execution was started.');}}
  catch(error){if(error instanceof ApiError&&error.status===404)this.notice('A start request is unresolved. Retry the same request; do not create a replacement task.');else throw error;}
 }
 private complete(task:TaskSummary):void{
  sessionStorage.removeItem(journal);
  for(const id of ['repo-owner','repo-name','repo-commit'])(document.getElementById(id) as HTMLInputElement).readOnly=false;
  (document.getElementById('authorize-model') as HTMLInputElement).checked=false;this.selected(task);
 }
 private async start():Promise<void>{
  if(this.busy||!this.csrf())return;
  if(!(document.getElementById('authorize-model') as HTMLInputElement).checked)return;
  this.busy=true;const epoch=this.epoch;(document.getElementById('start-mission') as HTMLButtonElement).disabled=true;
  try{
   const value=(id:string)=>(document.getElementById(id) as HTMLInputElement).value;
   const draft=this.pending()??{key:crypto.randomUUID(),accountId:value('mission-account'),repository:{owner:value('repo-owner'),name:value('repo-name'),commitSha:value('repo-commit')}};
   if(['.','..'].includes(draft.repository.name))throw new Error('INVALID_PUBLIC_REPOSITORY');
   sessionStorage.setItem(journal,JSON.stringify(draft));
   this.notice('Starting one bounded task. Keep this request if the response is interrupted.');
   const task=await api<TaskSummary>('/api/missions',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':this.csrf(),'Idempotency-Key':draft.key},body:JSON.stringify({accountId:draft.accountId,repository:draft.repository})});
   if(epoch===this.epoch){this.complete(task);this.notice('Task accepted. Follow its persisted activity; settlement remains a separate owner action.');}
  }catch(error){if(epoch===this.epoch)this.error(error);}
  finally{this.busy=false;this.checked=false;if(epoch===this.epoch&&this.csrf())await this.refresh().catch(this.error);}
 }
 async resume(taskId:string):Promise<void>{
  if(this.busy||!this.csrf())return;this.busy=true;const epoch=this.epoch;
  try{
   const task=await api<TaskSummary>(`/api/tasks/${taskId}/resume`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':this.csrf(),'Idempotency-Key':crypto.randomUUID()},body:'{}'});
   if(epoch===this.epoch){this.selected(task);this.notice('Resume requested for the original task, within its existing deadline and model budget.');}
  }catch(error){if(epoch===this.epoch)this.error(error);}finally{this.busy=false;}
 }
}
