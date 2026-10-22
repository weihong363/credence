import {createHash} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchSnapshot,repositoryInput,readBounded,type Fetcher} from '../src/providers/source.js';
import {inventory} from '../src/providers/contracts.js';
const sha='a'.repeat(40);
const blobSha=createHash('sha1').update('blob 2\0{}').digest('hex');
function fake(extra:unknown[]=[]):Fetcher{
 return (async(input)=>{
 const url=String(input);assert.ok(url.startsWith('https://api.github.com/repos/example/repo'));
 let result:unknown={private:false,default_branch:'main'};
 if(url.includes('/commits/'))result={sha};
 if(url.includes('/git/trees/'))result={tree:[{path:'package.json',type:'blob',mode:'100644',sha:blobSha,size:2},{path:'index.ts',type:'blob',mode:'100644',sha:blobSha,size:2},...extra]};
 if(url.includes('/git/blobs/'))result={encoding:'base64',content:Buffer.from('{}').toString('base64')};
 return Response.json(result);
 }) as Fetcher;
}
test('pinned real-content snapshot, hashes and source inventory; rejects malicious paths/symlinks',async()=>{
 const source=await fetchSnapshot({repository:{owner:'example',name:'repo',commitSha:sha}},fake([
 {path:'../evil.ts',type:'blob',mode:'100644',sha:blobSha,size:2},
 {path:'link.ts',type:'blob',mode:'120000',sha,size:2},
 {path:'big.ts',type:'blob',mode:'100644',sha,size:300000},
 ]));
 assert.equal(source.files.length,2);assert.equal(source.exclusions.length,3);
 assert.equal(source.repository.commitSha,sha);assert.match(source.files[0].sha256,/^[a-f0-9]{64}$/);
 const result=inventory(source);assert.ok(result.output);assert.equal(result.evidence.length,1);
});
test('repository input and transport enforce fixed public host and response bounds',async()=>{
 for(const value of [{repository:{owner:'https://evil',name:'repo'}},{repository:{owner:'x',name:'../repo'}},{repository:{owner:'x',name:'y',commitSha:'main'}}])assert.throws(()=>repositoryInput(value));
 await assert.rejects(()=>fetchSnapshot({repository:{owner:'example',name:'repo'}},(async()=>Response.json({private:true})) as Fetcher),/PUBLIC_REPOSITORY/);
 await assert.rejects(()=>readBounded(new Response('12345'),4),/TOO_LARGE/);
});

test('optional GitHub credential stays on fixed API host and cannot follow redirects',async()=>{
 const {githubFetcher}=await import('../src/providers/source.js');
 const secure=githubFetcher('test-only-token',(async(_,options)=>{
  assert.equal(new Headers(options?.headers).get('Authorization'),'Bearer test-only-token');
  assert.equal(options?.redirect,'error');return Response.json({ok:true});
 }) as Fetcher);
 await secure('https://api.github.com/repos/example/repo');
 await assert.rejects(()=>secure('https://example.com/private'),/HOST_DENIED/);
});
