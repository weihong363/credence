export interface PaymentInput {
 batchId:string;minor:number;currency:'USD';merchantId:string;returnUrl:string;cancelUrl:string;
}
export type PaymentStatus='CREATED'|'APPROVED'|'COMPLETED'|'PENDING'|'FAILED'|'UNKNOWN';
export interface PaymentObservation {
 orderId:string;status:PaymentStatus;orderStatus:string;batchId:string;invoiceId:string;
 merchantId:string;minor:number;currency:'USD';
 capture?:{id:string;status:string;minor:number;currency:'USD'};
 approvalUrl?:string;
}
export interface PaymentPort {
 create(input:PaymentInput,key:string):Promise<PaymentObservation>;
 inspect(orderId:string):Promise<PaymentObservation>;
 capture(orderId:string,key:string):Promise<void>;
}
export class PaymentError extends Error {
 constructor(public code:'DECLINED'|'RETRY_LATER'|'UNAVAILABLE'|'INVALID_RESPONSE',public retryAfterMs=0){super(code);}
}
