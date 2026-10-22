import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LlmClient,llmConfig} from '../src/llm/client.js';
import type {Fetcher} from '../src/providers/source.js';
test('server-only config fails closed; native transport bounds/retries and excludes reasoning',async()=>{
 assert.throws(()=>llmConfig({}),/REQUIRED/);assert.throws(()=>llmConfig({LLM_BASE_URL:'http://bad',LLM_MODEL:'x',LLM_API_KEY:'secret'}),/URL/);
 let requests=0;const client=new LlmClient({baseUrl:'https://model.example',model:'test',apiKey:'secret'},(async(url,options)=>{
 assert.equal(url,'https://model.example/chat/completions');assert.equal(options?.redirect,'error');
 const body=JSON.parse(options?.body as string);assert.equal(body.max_tokens,2000);assert.equal(body.stream,false);assert.ok(!JSON.stringify(body.messages).includes('secret'));
 return ++requests===1?new Response('',{status:503}):Response.json({choices:[{message:{content:'{"ok":true}',reasoning_content:'private reasoning'}}]});
 }) as Fetcher);
 assert.deepEqual(await client.complete('Return JSON',{}),{ok:true});assert.equal(client.callCount,2);
 for(let i=0;i<6;i++)await client.complete('Return JSON',{});
 await assert.rejects(()=>client.complete('Return JSON',{}),/BUDGET/);
});
test('malformed content and API errors do not expose raw response or key',async()=>{
 const config={baseUrl:'https://model.example',model:'test',apiKey:'private-secret'};
 const client=new LlmClient(config,(async()=>new Response('private-secret',{status:401})) as Fetcher);
 await assert.rejects(()=>client.complete('test',{}),error=>error instanceof Error&&error.message==='MODEL_HTTP_401');
 const invalid=new LlmClient(config,(async()=>Response.json({choices:[{message:{content:'bad-json'}}]})) as Fetcher);
 await assert.rejects(()=>invalid.complete('test',{}),/MODEL_JSON_INVALID/);
});

test('DeepSeek uses explicit non-thinking JSON mode; truncated responses fail closed',async()=>{
 const client=new LlmClient({baseUrl:'https://api.deepseek.com',model:'configured-model',apiKey:'fake-test-key'},(async(_,options)=>{
  const body=JSON.parse(options?.body as string);
  assert.deepEqual(body.thinking,{type:'disabled'});assert.deepEqual(body.response_format,{type:'json_object'});
  return Response.json({choices:[{finish_reason:'length',message:{content:'{"partial":'}}]});
 }) as Fetcher);
 await assert.rejects(()=>client.complete('test',{}),/MODEL_OUTPUT_LIMIT/);
});
