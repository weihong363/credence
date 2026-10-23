import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PayPalAdapter,parseAmount} from '../src/payments/paypal-adapter.js';
import {PayPal,retryAfter,type Gateway} from '../src/paypal.js';
const order=()=>({id:'ORDER1',status:'APPROVED',purchase_units:[{custom_id:'batch-1',invoice_id:'batch-1',payee:{merchant_id:'MERCHANT'},amount:{currency_code:'USD',value:'7.50'}}]});
test('neutral adapter preserves Orders v2 payload and normalizes independent observations',async()=>{
 let body:unknown;let key='';const api:Gateway={create:async(k,b)=>{key=k;body=b;return order();},get:async()=>order(),capture:async()=>order()};
 const adapter=new PayPalAdapter(api);const result=await adapter.create({batchId:'batch-1',minor:750,currency:'USD',merchantId:'MERCHANT',returnUrl:'http://localhost:3001/payments/return',cancelUrl:'http://localhost:3001/payments/cancel'},'stable');
 assert.equal(key,'stable');assert.equal(result.status,'APPROVED');assert.equal(result.minor,750);
 assert.equal((body as {purchase_units:{amount:{value:string};invoice_id:string}[]}).purchase_units[0].amount.value,'7.50');
 assert.deepEqual(await adapter.inspect('ORDER1'),result);
});
test('untrusted provider JSON, partial/multiple captures and non-Sandbox approval links fail closed',async()=>{
 for(const mutate of [(o:any)=>o.purchase_units=[],(o:any)=>o.purchase_units[0].amount.value='7.5',
 (o:any)=>o.links=[{rel:'approve',href:'https://evil.example/'}],(o:any)=>o.purchase_units[0].payments={captures:[{},{}]}]){
  const value=order();mutate(value);const adapter=new PayPalAdapter({get:async()=>value,create:async()=>value,capture:async()=>value});
  await assert.rejects(adapter.inspect('ORDER1'));
 }
 for(const value of ['1e2','7.5','-1.00','7.500','07.50','NaN'])assert.throws(()=>parseAmount({currency_code:'USD',value}));
 assert.equal(parseAmount({currency_code:'USD',value:'7.50'}),750);
});
test('long Retry-After yields without sleeping or another POST, short HTTP-date parsing is bounded',async()=>{
 let posts=0;const api=new PayPal('client','secret',async url=>{
  if(String(url).endsWith('/token'))return Response.json({access_token:'fake',expires_in:3600});posts++;
  return Response.json({},{status:429,headers:{'Retry-After':'120'}});
 });
 await assert.rejects(new PayPalAdapter(api).create({batchId:'batch',minor:750,currency:'USD',merchantId:'MERCHANT',returnUrl:'http://localhost',cancelUrl:'http://localhost'},'same'),/RETRY_LATER/);
 assert.equal(posts,1);assert.equal(retryAfter('2'),2000);assert.equal(retryAfter('bad'),0);
});
