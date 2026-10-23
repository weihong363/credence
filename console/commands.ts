export interface OwnerCommand {path:string;body:Record<string,unknown>}
/** Reproducible across reloads; PayPal's own operation keys stay on the server. */
export async function commandKey(command:OwnerCommand):Promise<string>{
 const data=JSON.stringify([command.path,command.body]);
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));
 return 'console:'+Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
}
export function freezeCommand(accountId:string,chargeIds:string[]):OwnerCommand{
 return {path:'/api/batches',body:{accountId,chargeIds:[...chargeIds].sort()}};
}
export function paymentCommand(id:string,action:string,version:number):OwnerCommand{
 if(!['order','capture','reconcile','cancel','resume'].includes(action))throw new Error('Invalid action');
 return {path:`/api/batches/${id}/${action}`,body:['capture','cancel','resume'].includes(action)?{expectedVersion:version}:{}};
}
