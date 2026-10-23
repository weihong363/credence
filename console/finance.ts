import {api,usd} from './api.js';
import {commandKey,freezeCommand,paymentCommand,type OwnerCommand} from './commands.js';
import type {FinanceView,BatchView} from '../src/application/finance.js';
import type {LedgerEntry,Page} from '../src/application/read-model.js';
const root=()=>document.getElementById('finance')!;
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text=''):HTMLElementTagNameMap[K]{const n=document.createElement(tag);n.textContent=text;return n;}
const guidance:Record<string,string>={FROZEN:'Frozen charges are locked. Create one Sandbox order for this batch.',AWAITING_APPROVAL:'The buyer must approve in PayPal. Reconcile to verify approval before capture.',CAPTURING:'Capture is unresolved. Reconcile this batch; do not create a replacement bill.',PAYMENT_PENDING:'Payment is pending, not settled. Charges remain locked.',UNKNOWN:'Payment status is unknown. Keep charges locked and reconcile; do not pay again.',CANCELLED:'Checkout is cancelled. Obligations remain locked. Resume only after verified buyer approval.',ACTION_REQUIRED:'Payment needs attention. Reconcile and inspect the existing order; do not rebill.',SETTLED:'The server independently verified capture and settled these charges.'};
export class FinanceConsole {
 private fingerprint='';private selected=new Set<string>();private busy=false;private epoch=0;
 private ledgerAccount='';private ledgerCursor=0;private ledger:LedgerEntry[]=[];private ledgerMore=false;
 constructor(private csrf:()=>string,private notice:(text:string)=>void,private onError:(error:unknown)=>void){}
 clear():void{this.epoch++;this.fingerprint='';this.selected.clear();this.ledgerAccount='';this.ledger=[];this.ledgerCursor=0;root().replaceChildren();document.getElementById('ledger')!.replaceChildren();}
 async refresh():Promise<void>{
  const epoch=this.epoch;const data=await api<FinanceView>('/api/finance');
  if(epoch!==this.epoch||!this.csrf()||this.busy)return;
  for(const id of this.selected)if(!data.charges.some(c=>c.id===id&&c.eligible))this.selected.delete(id);
  const fingerprint=JSON.stringify({data,selected:[...this.selected],retryReady:data.batches.map(b=>Date.now()>=b.nextAttemptAt)});
  if(fingerprint!==this.fingerprint){this.fingerprint=fingerprint;this.render(data);}
  if(this.ledgerAccount)await this.loadLedger();
 }
 private button(text:string,click:()=>void):HTMLButtonElement{const button=node('button',text);button.type='button';button.disabled=this.busy;button.onclick=click;return button;}
 private async execute(command:OwnerCommand):Promise<void>{
  if(this.busy||!this.csrf())return;this.busy=true;const epoch=this.epoch;
  root().querySelectorAll('button,input').forEach(control=>(control as HTMLButtonElement).disabled=true);
  this.notice('Submitting owner command. An interrupted response does not prove failure or payment success.');
  try{await api(command.path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':this.csrf(),'Idempotency-Key':await commandKey(command)},body:JSON.stringify(command.body)});
   if(epoch===this.epoch)this.notice('Command returned. Refreshing authoritative account and batch state.');
  }catch(error){if(epoch===this.epoch){this.onError(error);this.notice('Command not confirmed. Refresh and reconcile the existing batch before retrying; no replacement payment was started.');}}
  finally{this.busy=false;this.fingerprint='';if(epoch===this.epoch&&this.csrf())await this.refresh().catch(this.onError);}
 }
 private render(data:FinanceView):void{
  root().replaceChildren(node('h2','Credit & settlement'),node('p','Internal allowance, not financing. All amounts are USD. Only accepted service charges can be settled.'));
  for(const account of data.accounts){
   const section=node('article');section.className='purchase';section.append(node('h3',`Account · ${account.status}`));
   const balances=node('div');balances.className='balances';
   for(const [label,value] of [['Limit',account.limitMinor],['Reserved',account.reservedMinor],['Outstanding',account.outstandingMinor],['Available',account.availableMinor]] as const){const tile=node('div');tile.append(node('small',label),node('strong',usd(value)));balances.append(tile);}
   section.append(balances,node('p',`Per-purchase cap ${usd(account.perPurchaseMinor)} · ${account.id}`));
   section.append(this.button('View ledger',()=>{this.ledgerAccount=account.id;this.ledgerCursor=0;this.ledger=[];void this.loadLedger().catch(this.onError);}));
   const choices=data.charges.filter(c=>c.accountId===account.id&&c.eligible);
   for(const charge of choices){const label=node('label');label.className='charge';const input=node('input');input.type='checkbox';input.checked=this.selected.has(charge.id);input.disabled=this.busy;
    input.onchange=()=>{if(input.checked)this.selected.add(charge.id);else this.selected.delete(charge.id);this.fingerprint='';this.render(data);};label.append(input,document.createTextNode(`${usd(charge.amountMinor)} · Task ${charge.taskId} · Charge ${charge.id}`));section.append(label);}
   const chosen=choices.filter(c=>this.selected.has(c.id));
   if(choices.length){const button=this.button(`Freeze selected bill · ${usd(chosen.reduce((sum,c)=>sum+c.amountMinor,0))}`,()=>void this.execute(freezeCommand(account.id,chosen.map(c=>c.id))));button.disabled=this.busy||!chosen.length;section.append(button);}
   else section.append(node('p','No unallocated accepted charges. Existing batches keep their obligations locked.'));
   root().append(section);
  }
  for(const batch of data.batches)root().append(this.batch(batch));
  if(!data.batches.length)root().append(node('p','No settlement batches yet.'));
 }
 private batch(batch:BatchView):HTMLElement{
  const section=node('article');section.className='purchase';section.append(node('h3',`${usd(batch.totalMinor)} · ${batch.state}`),node('p',`Batch ${batch.id} · Version ${batch.version}`),node('p',batch.state==='AWAITING_APPROVAL'&&batch.observedStatus==='APPROVED'?'Buyer approval verified. Review the exact amount before capture.':guidance[batch.state]),node('p',`Order ${batch.orderId??'not created'} · Last inspected status ${batch.observedStatus}`));
  const list=node('ul');for(const a of batch.allocations)list.append(node('li',`${usd(a.amountMinor)} · ${a.state} · Charge ${a.chargeId}`));section.append(list);
  if(batch.receipt){section.append(node('p',`Verified receipt · Order ${batch.receipt.orderId} · Capture ${batch.receipt.captureId} · ${new Date(batch.receipt.verifiedAt).toLocaleString()}`));return section;}
  if(batch.approvalUrl&&!batch.cancelled){const link=node('a','Open PayPal Sandbox to approve');link.href=batch.approvalUrl;link.target='_blank';link.rel='noopener noreferrer';section.append(link);}
  const action=(label:string,name:string)=>section.append(this.button(label,()=>void this.execute(paymentCommand(batch.id,name,batch.version))));
  if(batch.state==='FROZEN')action('Create Sandbox order','order');
  if(batch.state==='UNKNOWN'&&!batch.orderId)section.append(node('p','No order ID is available. Investigate the saved attempt with owner tooling; do not create a replacement order.'));
  if(batch.orderId)action('Reconcile with PayPal','reconcile');
  if(batch.state==='AWAITING_APPROVAL'&&batch.observedStatus==='APPROVED'&&Date.now()>=batch.nextAttemptAt){
   const review=node('details');review.append(node('summary',`Review capture · ${usd(batch.totalMinor)}`),node('p',`Capture this exact frozen batch ${batch.id}, using order ${batch.orderId}. PayPal status will be verified server-side.`),this.button(`Capture ${usd(batch.totalMinor)}`,()=>void this.execute(paymentCommand(batch.id,'capture',batch.version))));section.append(review);
  }
  if(batch.cancelled&&batch.orderId)action('Resume approved checkout','resume');
  if(!batch.cancelled&&!['CAPTURING','PAYMENT_PENDING','UNKNOWN'].includes(batch.state))action('Cancel checkout (no refund)','cancel');
  return section;
 }
 async loadLedger():Promise<void>{
  const account=this.ledgerAccount,epoch=this.epoch;if(!account)return;
  const page=await api<{entries:Page<LedgerEntry>}>(`/api/accounts/${account}/ledger?afterSeq=${this.ledgerCursor}&limit=100`);
  if(epoch!==this.epoch||account!==this.ledgerAccount||!this.csrf())return;
  const entries=new Map(this.ledger.map(entry=>[entry.seq,entry]));for(const entry of page.entries.items)entries.set(entry.seq,entry);
  this.ledger=[...entries.values()].sort((a,b)=>a.seq-b.seq).slice(-500);this.ledgerCursor=Math.max(this.ledgerCursor,page.entries.nextSeq);this.ledgerMore=page.entries.hasMore;
  const target=document.getElementById('ledger')!;target.replaceChildren(node('h3','Append-only ledger'),node('p',`Account ${account} · Up to 500 loaded entries; events are not balance deltas to sum blindly.`));
  const list=node('ol');for(const event of this.ledger)list.append(node('li',`#${event.seq} · ${event.type} · ${usd(event.amountMinor)} · Task ${event.taskId} · Batch ${event.batchId??'—'}`));target.append(list);
  if(this.ledgerMore)target.append(this.button('Load more ledger entries',()=>void this.loadLedger().catch(this.onError)));
 }
}
