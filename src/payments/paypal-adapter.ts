import {ApiError,type Gateway} from '../paypal.js';
import {usd,formatUsd} from '../domain/money.js';
import {PaymentError,type PaymentInput,type PaymentObservation,type PaymentPort,type PaymentStatus} from './port.js';
const record=(value:unknown):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new PaymentError('INVALID_RESPONSE');
 return value as Record<string,unknown>;
};
function identifier(value:unknown):string{
 if(typeof value!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(value))throw new PaymentError('INVALID_RESPONSE');return value;
}
export function parseAmount(value:unknown):number{
 const amount=record(value);
 if(amount.currency_code!=='USD'||typeof amount.value!=='string'||!/^(0|[1-9]\d{0,7})\.\d{2}$/.test(amount.value))throw new PaymentError('INVALID_RESPONSE');
 const [whole,fraction]=amount.value.split('.');return usd(Number(whole)*100+Number(fraction)).minor;
}
function approval(links:unknown):string|undefined{
 if(links===undefined)return;
 if(!Array.isArray(links))throw new PaymentError('INVALID_RESPONSE');
 const link=links.map(record).find(link=>link.rel==='payer-action'||link.rel==='approve');if(!link)return;
 if(typeof link.href!=='string')throw new PaymentError('INVALID_RESPONSE');
 const url=new URL(link.href);
 if(url.origin!=='https://www.sandbox.paypal.com'||url.username||url.password)throw new PaymentError('INVALID_RESPONSE');
 return url.href;
}
function normalize(value:unknown):PaymentObservation{
 const order=record(value),units=order.purchase_units;
 if(!Array.isArray(units)||units.length!==1)throw new PaymentError('INVALID_RESPONSE');
 const unit=record(units[0]);const payments=unit.payments===undefined?{}:record(unit.payments);
 const captures=payments.captures??[];
 if(!Array.isArray(captures)||captures.length>1||(payments.authorizations!==undefined&&(!Array.isArray(payments.authorizations)||payments.authorizations.length>0)))throw new PaymentError('INVALID_RESPONSE');
 const raw=captures.length?record(captures[0]):undefined;
 const capture=raw?{id:identifier(raw.id),status:identifier(raw.status),minor:parseAmount(raw.amount),currency:'USD' as const}:undefined;
 const orderStatus=identifier(order.status);
 let status:PaymentStatus='UNKNOWN';
 if(orderStatus==='COMPLETED'&&capture?.status==='COMPLETED')status='COMPLETED';
 else if(orderStatus==='VOIDED'||['DECLINED','FAILED','DENIED'].includes(capture?.status??''))status='FAILED';
 else if(capture||orderStatus==='COMPLETED')status='PENDING';
 else if(orderStatus==='APPROVED')status='APPROVED';
 else if(['CREATED','SAVED','PAYER_ACTION_REQUIRED'].includes(orderStatus))status='CREATED';
 return {orderId:identifier(order.id),status,orderStatus,batchId:identifier(unit.custom_id),invoiceId:identifier(unit.invoice_id),
  merchantId:identifier(record(unit.payee).merchant_id),minor:parseAmount(unit.amount),currency:'USD',capture,approvalUrl:approval(order.links)};
}
async function invoke<T>(operation:()=>Promise<T>):Promise<T>{
 try{return await operation();}catch(error){
  if(error instanceof PaymentError)throw error;
  if(error instanceof ApiError){
   if(error.retryAfterMs>30000)throw new PaymentError('RETRY_LATER',error.retryAfterMs);
   if(error.status>=400&&error.status<500&&![401,408,409,429].includes(error.status))throw new PaymentError('DECLINED');
  }
  throw new PaymentError('UNAVAILABLE');
 }
}
export class PayPalAdapter implements PaymentPort{
 constructor(private gateway:Gateway){}
 async create(input:PaymentInput,key:string):Promise<PaymentObservation>{
  const body={intent:'CAPTURE',purchase_units:[{custom_id:input.batchId,invoice_id:input.batchId,payee:{merchant_id:input.merchantId},
   amount:{currency_code:input.currency,value:formatUsd(usd(input.minor,input.currency))}}],
   payment_source:{paypal:{experience_context:{user_action:'PAY_NOW',shipping_preference:'NO_SHIPPING',return_url:input.returnUrl,cancel_url:input.cancelUrl}}}};
  return invoke(async()=>normalize(await this.gateway.create(key,body)));
 }
 inspect(id:string):Promise<PaymentObservation>{return invoke(async()=>normalize(await this.gateway.get(id)));}
 async capture(id:string,key:string):Promise<void>{await invoke(()=>this.gateway.capture(id,key));}
}
