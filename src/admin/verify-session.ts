import assert from 'node:assert/strict';
const origin=process.env.PUBLIC_URL??process.env.RENDER_EXTERNAL_URL;
const token=process.env.OWNER_TOKEN;
if(!origin||new URL(origin).protocol!=='https:'||!token)throw new Error('HTTPS_ORIGIN_AND_OWNER_TOKEN_REQUIRED');
const base=new URL(origin).origin;
async function request(path:string,options:RequestInit={}):Promise<Response>{
 return fetch(base+path,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
}
let cookie:string|undefined,csrfToken:string|undefined;
try{
 const login=await request('/api/session',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({ownerToken:token})});
 assert.equal(login.status,200,'LOGIN_FAILED');
 cookie=login.headers.get('set-cookie')?.split(';')[0];
 const grant=await login.json() as {csrfToken:string};csrfToken=grant.csrfToken;
 assert.ok(cookie&&csrfToken,'SESSION_GRANT_MISSING');
 assert.equal((await request('/api/session',{headers:{Cookie:cookie}})).status,200,'SESSION_READ_FAILED');
 assert.equal((await request('/api/economy',{headers:{Cookie:cookie}})).status,200,'ECONOMY_READ_FAILED');
 assert.equal((await request('/api/session/logout',{method:'POST',headers:{Cookie:cookie,Origin:base}})).status,403,'CSRF_REJECTION_FAILED');
 const logout=await request('/api/session/logout',{method:'POST',headers:{Cookie:cookie,Origin:base,'X-CSRF-Token':csrfToken}});
 assert.equal(logout.status,200,'LOGOUT_FAILED');
 assert.equal((await request('/api/session',{headers:{Cookie:cookie}})).status,401,'REVOCATION_FAILED');
 cookie=undefined;console.log('SESSION_LOGIN_READ_CSRF_LOGOUT_PASS');
}catch{
 console.error('SESSION_VERIFICATION_FAILED_CHECK_INITIALIZATION_OR_SERVER_CONFIGURATION');process.exitCode=1;
}finally{
 if(cookie&&csrfToken)await request('/api/session/logout',{method:'POST',headers:{Cookie:cookie,Origin:base,'X-CSRF-Token':csrfToken}}).catch(()=>undefined);
}
