import type {JsonModel} from '../llm/client.js';
import type {Snapshot} from './source.js';
import {object} from '../domain/json.js';
import {anchor,type ProviderResult} from './contracts.js';

export async function analyze(model:JsonModel,capabilityId:string,snapshot:Snapshot,signal:AbortSignal,correction?:string[]):Promise<ProviderResult>{
 const architecture=capabilityId==='repo.architecture';
 const schema=architecture
  ? '{repository,commitSha,components:[{name,responsibility,evidenceIndexes:[0]}],dependencies:[{from,to,evidenceIndexes:[0]}],limitations:[string]}'
  : '{repository,commitSha,risks:[{category:SECURITY|RELIABILITY|MAINTAINABILITY|ADOPTION,severity:LOW|MEDIUM|HIGH,claim,mitigation,evidenceIndexes:[0]}],limitations:[string]}';
 const source={id:snapshot.id,repository:snapshot.repository,files:snapshot.files.map(file=>({path:file.path,
  numberedLines:file.content.split('\n').map((line,index)=>`L${index+1}: ${line}`).join('\n')}))};
 const result=await model.complete(`Perform ${architecture?'architecture analysis with 2-3 components':'independent risk review with exactly three supported risks across two files'}. Return exactly {"output":${schema},"evidenceLines":[{"path":"source path","line":1}]}. evidenceLines must be a TOP LEVEL sibling of output. Every claim evidenceIndexes indexes this evidenceLines array. Select the exact L-number from numberedLines; each selection identifies one complete source line. Do not copy or paraphrase anchor text. Use at most six evidence lines. For risks, assess deployment assumptions, dependency/maintenance policy and documented usage caveats; distinguish conditional adoption risks from proven vulnerabilities. Do not criticize secure SHA pinning or invent exploitability. Cite at least two distinct source paths. No invented claims; reject insufficient evidence with empty claims and a limitation. Copy source.repository exactly including owner,name,commitSha; top-level commitSha must match. No extra fields.`,{source,correction:correction??[]},signal);
 const envelope=object(result,['output','evidenceLines']);
 if(!Array.isArray(envelope.evidenceLines)||envelope.evidenceLines.length>100)throw new Error('INVALID_SCHEMA');
 const evidence=envelope.evidenceLines.map(value=>{
  const selection=object(value,['path','line']);
  const file=snapshot.files.find(item=>item.path===selection.path);const line=selection.line as number;
  if(!file||!Number.isInteger(line)||line<1||line>file.content.split('\n').length)throw new Error('EVIDENCE_RANGE');
  return anchor(snapshot,file.path,line,line);
 });
 return {output:envelope.output,evidence};
}
