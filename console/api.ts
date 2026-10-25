export class ApiError extends Error {constructor(public status:number){super(status===401?'Your session expired. Sign in again.':status===403?'This action was blocked by the security check. Refresh and sign in again.':status===409?'The command conflicts with current state. Refresh and reconcile the existing batch before retrying.':status===429?'Too many requests. Wait before trying again.':'Request failed. Retry to refresh the current state.');}}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
 const prefix=location.pathname.startsWith('/judge')?'/judge':'';
 const response=await fetch(prefix+path,{...options,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new ApiError(response.status);
 return response.json() as Promise<T>;
}
export function usd(minor:number):string{
 if(!Number.isSafeInteger(minor)||minor<0)throw new Error('Invalid amount');
 return `USD ${Math.floor(minor/100)}.${String(minor%100).padStart(2,'0')}`;
}
