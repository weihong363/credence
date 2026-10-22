import {test} from 'node:test';
import assert from 'node:assert/strict';
import {source,analysisResult} from './runtime-fixture.js';
import {verifyResult} from '../src/providers/verify.js';
test('wrong source identity, unknown claim indexes and extra output fields are rejected',()=>{
 const snapshot=source();
 const wrongCommit=analysisResult(snapshot);(wrongCommit.output as any).commitSha='b'.repeat(40);
 assert.equal(verifyResult('repo.architecture',wrongCommit,snapshot).pass,false);
 const missingAnchor=analysisResult(snapshot);(missingAnchor.output as any).components[0].evidenceIndexes=[99];
 assert.equal(verifyResult('repo.architecture',missingAnchor,snapshot).pass,false);
 const extra=analysisResult(snapshot);(extra.output as any).verified=true;
 assert.equal(verifyResult('repo.architecture',extra,snapshot).pass,false);
 const corruptSource=source();corruptSource.files[0].content='mutated';
 assert.equal(verifyResult('repo.architecture',analysisResult(corruptSource),corruptSource).pass,false);
});

test('analysis selects numbered source lines; server extracts exact anchors without trusting model text',async()=>{
 const {analyze}=await import('../src/providers/analysis.js');const snapshot=source();
 const result=await analyze({async complete(_,input){
  assert.match((input as any).source.files[1].numberedLines,/L2:  return JSON.parse/);
  return {output:analysisResult(snapshot).output,evidenceLines:[{path:'package.json',line:1},{path:'index.ts',line:2}]};
 }},'repo.architecture',snapshot,new AbortController().signal);
 assert.equal(result.evidence[1].anchor,' return JSON.parse(input);');
 assert.equal(verifyResult('repo.architecture',result,snapshot).pass,true);
 await assert.rejects(()=>analyze({async complete(){return {output:{},evidenceLines:[{path:'index.ts',line:999}]};}},'repo.architecture',snapshot,new AbortController().signal),/EVIDENCE_RANGE/);
});
