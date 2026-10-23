import type {IncomingMessage,ServerResponse} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
export class RequestError extends Error {
 constructor(public status:number,code:string){super(code);}
}
export function sameBytes(left:string,right:string):boolean{
 const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);
}
export async function readJson(req:IncomingMessage):Promise<unknown>{
 if(req.headers['content-type']!=='application/json')throw new RequestError(415,'JSON_REQUIRED');
 let bytes=0;const chunks:Buffer[]=[];
 for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>8192)throw new RequestError(413,'BODY_TOO_LARGE');chunks.push(Buffer.from(chunk));}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new RequestError(400,'INVALID_JSON');}
}
export function sendJson(res:ServerResponse,data:unknown,status=200):void{
 res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));
}
