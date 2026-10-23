import {FinanceConsole} from './finance.js';
import './style.css';
import {api,ApiError,usd} from './api.js';
import type {TaskSummary,Page,AuditEvent} from '../src/application/read-model.js';
import type {TaskActivity} from '../src/application/activity.js';
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
let csrf='',generation=0,selected='',taskCursor=0,eventCursor=0,timer:ReturnType<typeof setTimeout>|undefined;
let tasks:TaskSummary[]=[],events:AuditEvent[]=[];
let refreshing=false,listFingerprint='',detailFingerprint='',eventFingerprint='';
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''):HTMLElementTagNameMap[K]{
 const element=document.createElement(tag);element.textContent=text;element.className=className;return element;
}
function notice(text:string):void{el('notice').textContent=text;}
const finance=new FinanceConsole(()=>csrf,notice,error);
function signedOut():void{
 finance.clear();
 generation++;csrf='';selected='';listFingerprint='';detailFingerprint='';eventFingerprint='';tasks=[];events=[];taskCursor=0;eventCursor=0;clearTimeout(timer);
 el('workspace').hidden=true;el('login-panel').hidden=false;el('tasks').replaceChildren();el('detail').replaceChildren();el('events').replaceChildren();
}
function error(error:unknown):void{
 if(error instanceof ApiError&&error.status===401)signedOut();
 notice(error instanceof ApiError?error.message:'Could not refresh activity. Retry when the connection is available.');
}
function taskList():void{
 const fingerprint=JSON.stringify({tasks,selected});if(fingerprint===listFingerprint)return;listFingerprint=fingerprint;
 el('tasks').replaceChildren(...tasks.map(task=>{
  const button=node('button','','mission');button.append(node('strong',task.objective||'Repository review'),node('span',`${task.status} · ${task.acceptedCount}/${task.purchaseCount} accepted`));
  button.setAttribute('aria-pressed',String(task.id===selected));button.onclick=()=>{selected=task.id;taskList();void details().catch(error);};return button;
 }));
 if(!tasks.length)el('tasks').append(node('p','No missions yet. Existing CLI missions appear here; this view does not start purchases.'));
}
async function details():Promise<void>{
 const id=selected,epoch=generation;if(!id)return;
 const [task,activity]=await Promise.all([api<TaskSummary>(`/api/tasks/${id}`),api<TaskActivity>(`/api/tasks/${id}/activity`)]);
 if(id!==selected||epoch!==generation||!csrf)return;
 const fingerprint=JSON.stringify({task,activity});if(fingerprint===detailFingerprint)return;detailFingerprint=fingerprint;
 const root=el('detail');root.replaceChildren(node('p',task.profile.toUpperCase(),'eyebrow'),node('h2',task.objective||'Repository review'),node('p',`${task.status} · Task ${task.id}`),node('p',`Budget ${usd(task.budgetMinor)} · Accepted spend ${usd(task.spentMinor)}`));
 root.append(node('h3','Purchase plan'));
 if(!activity.plan.length)root.append(node('p','No persisted purchase plan.'));
 for(const item of activity.plan)root.append(node('p',`${item.capabilityId} v${item.version} — ${item.reason}`));
 root.append(node('h3','Agent services'));
 if(!activity.purchases.length)root.append(node('p','No purchases recorded.'));
 for(const purchase of activity.purchases){
  const card=node('article','','purchase');card.append(node('h4',purchase.capabilityId),node('p',`${purchase.providerName} · v${purchase.version} · ${usd(purchase.amountMinor)}`),node('p',`${purchase.status} · Reservation ${purchase.reservationState}`));
  for(const delivery of activity.deliveries.filter(d=>d.purchaseId===purchase.id)){
   const section=node('details');section.append(node('summary',`Delivery ${delivery.attempt}: ${delivery.result} · ${delivery.evidence.length} evidence anchors`));
   section.append(node('p',`Delivery ${delivery.id}. Objective checks are limited evidence, not a guarantee of semantic correctness.`));
   for(const evidence of delivery.evidence){section.append(node('p',`${evidence.path}:${evidence.startLine}–${evidence.endLine}`),node('pre',evidence.anchor));}
   if(!delivery.evidence.length)section.append(node('p','No validated source anchors available for display.'));
   card.append(section);
  }
  root.append(card);
 }
}
async function loadTasks(more=false):Promise<void>{
 const epoch=generation;
 const page=await api<Page<TaskSummary>>(`/api/tasks?afterSeq=${more?taskCursor:0}&limit=100`);
 if(epoch!==generation||!csrf)return;
 const merged=new Map(tasks.map(task=>[task.id,task]));for(const task of page.items)merged.set(task.id,task);
 tasks=[...merged.values()].sort((a,b)=>a.sequence-b.sequence);
 if(page.nextSeq>=taskCursor){taskCursor=page.nextSeq;el('more').hidden=!page.hasMore;}
 taskList();
}
async function loadEvents():Promise<void>{
 const epoch=generation;let hasMore=true,pages=0;
 while(hasMore&&pages++<10){
  const page=await api<Page<AuditEvent>>(`/api/events?afterSeq=${eventCursor}&limit=100`);
  if(epoch!==generation||!csrf)return;
  events=[...events,...page.items].slice(-300);eventCursor=page.nextSeq;hasMore=page.hasMore;
 }
 const fingerprint=JSON.stringify(events);if(fingerprint===eventFingerprint)return;eventFingerprint=fingerprint;
 el('events').replaceChildren(...events.map(event=>node('li',`#${event.seq} · ${new Date(event.createdAt).toLocaleString()} · ${event.actor} · ${event.type}${event.reasonCodes.length?' · '+event.reasonCodes.join(', '):''}`)));
 if(!events.length)el('events').append(node('li','No committed activity yet.'));
}
async function refresh():Promise<void>{
 if(refreshing||!csrf)return;refreshing=true;clearTimeout(timer);const epoch=generation;
 try{
  await Promise.all([loadTasks(),loadEvents(),details(),finance.refresh()]);
  if(epoch===generation&&csrf)notice('Connected · Updates every 2 seconds · Up to 300 loaded committed events');
 }catch(e){if(epoch===generation)error(e);}
 finally{refreshing=false;if(csrf)timer=setTimeout(()=>void refresh(),2000);}
}
async function signedIn():Promise<void>{
 generation++;el('login-panel').hidden=true;el('workspace').hidden=false;notice('Loading activity…');await refresh();
}
el<HTMLFormElement>('login').onsubmit=async event=>{
 event.preventDefault();const input=el<HTMLInputElement>('token');const submit=el<HTMLButtonElement>('login').querySelector('button')!;submit.disabled=true;
 try{const grant=await api<{csrfToken:string}>('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ownerToken:input.value})});input.value='';csrf=grant.csrfToken;await signedIn();}
 catch(e){if(e instanceof ApiError&&e.status===401)notice('Sign-in failed. Check this deployment’s owner token.');else error(e);}
 finally{input.value='';submit.disabled=false;}
};
el('logout').onclick=async()=>{
 try{await api('/api/session/logout',{method:'POST',headers:{'X-CSRF-Token':csrf}});signedOut();notice('Signed out.');}
 catch(e){error(e);}
};
el('refresh').onclick=()=>void refresh();
el('more').onclick=()=>void loadTasks(true).catch(error);
async function restore():Promise<void>{
 try{const session=await api<{csrfToken:string}>('/api/session');csrf=session.csrfToken;await signedIn();}
 catch(e){if(e instanceof ApiError&&e.status===401)notice('Sign in to inspect your missions.');else error(e);}
}
void restore();
