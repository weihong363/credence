import type {TaskResultView} from '../src/application/task-result.js';
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text:string):HTMLElementTagNameMap[K]{const element=document.createElement(tag);element.textContent=text;return element;}
export function resultPanel(result:TaskResultView):HTMLElement{
 const section=node('section','');section.append(node('h3','Mission result'));
 if(result.state==='NOT_READY'){section.append(node('p','No final result yet. Current status and accepted charges are shown separately. After interruption, resume the same OPEN task with owner CLI tooling; keep its original deadline and budget.'));return section;}
 if(result.state==='ACTION_REQUIRED'){section.append(node('p',`Action required · ${result.reason}`),node('p','This task ended without a complete report. Accepted services may still be payable; inspect their deliveries and ledger. Terminal tasks cannot be resumed. Review the cause and remaining allowance before explicitly starting another task.'));return section;}
 if(result.state==='UNAVAILABLE'||!result.report){section.append(node('p','A verified result cannot be displayed. Refresh or investigate the saved task; do not treat this as success or rerun purchases automatically.'));return section;}
 const report=result.report;
 section.append(node('h4',report.recommendation.replaceAll('_',' ')),node('p',`${report.repository.owner}/${report.repository.name} · ${report.repository.commitSha}`),node('p',report.summary));
 const list=node('ul','');for(const finding of report.findings){const item=node('li',finding.claim);item.append(node('p',`Accepted delivery citations: ${finding.acceptedDeliveryIds.join(', ')}`));list.append(item);}section.append(list,node('h4','Limitations'));
 for(const limitation of report.limitations)section.append(node('p',limitation));
 section.append(node('p','A completed mission is not payment confirmation. Review settlement separately. Model recommendations and objective evidence checks do not guarantee semantic correctness.'));
 return section;
}
