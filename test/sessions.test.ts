import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {IncomingMessage} from 'node:http';
import {OwnerSessions,SESSION_LIFETIME_MS} from '../src/web/sessions.js';
import {RequestError} from '../src/web/http.js';
const token='session-owner-token-'.repeat(3),origin='https://credence.example';
const request=(cookie:string,method='GET',extra:Record<string,string|undefined>={}):IncomingMessage=>({method,headers:{cookie,...extra}} as IncomingMessage);
const cookieOf=(cookie:string)=>cookie.split(';')[0];
test('session uses a random HttpOnly strict cookie, HTTPS host prefix, and fixed one-hour expiry',()=>{
 let now=100;const sessions=new OwnerSessions(token,true,()=>now);const grant=sessions.login('owner',token),cookie=cookieOf(grant.cookie);
 assert.match(grant.cookie,/^__Host-credence_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=3600; Secure$/);
 assert.ok(!grant.cookie.includes(token));assert.equal(grant.expiresAt,100+SESSION_LIFETIME_MS);
 now+=SESSION_LIFETIME_MS-1;assert.equal(sessions.require(request(cookie),origin).ownerId,'owner');
 now++;assert.throws(()=>sessions.require(request(cookie),origin),(error:unknown)=>error instanceof RequestError&&error.status===401);
});
test('all cookie mutations need exact Origin and the session-specific CSRF token',()=>{
 const sessions=new OwnerSessions(token,false),grant=sessions.login('owner',token),cookie=cookieOf(grant.cookie);
 for(const headers of [{},{origin},{origin,'x-csrf-token':'wrong'},{origin:'https://other.example','x-csrf-token':grant.csrfToken}]){
  assert.throws(()=>sessions.require(request(cookie,'POST',headers),origin),(error:unknown)=>error instanceof RequestError&&error.status===403);
 }
 assert.equal(sessions.require(request(cookie,'POST',{origin,'x-csrf-token':grant.csrfToken}),origin).ownerId,'owner');
 assert.throws(()=>sessions.require(request(`${cookie}; ${cookie}`),origin));
 assert.throws(()=>sessions.require(request('credence_session=forged'),origin));
});
test('login rotates prior session, logout revokes immediately, and process restart revokes all sessions',()=>{
 const sessions=new OwnerSessions(token,false),first=sessions.login('owner',token),firstCookie=cookieOf(first.cookie);
 const next=sessions.login('owner',token,firstCookie),cookie=cookieOf(next.cookie);
 assert.throws(()=>sessions.require(request(firstCookie),origin));
 assert.throws(()=>new OwnerSessions(token,false).require(request(cookie),origin));
 assert.throws(()=>sessions.logout(request(cookie,'POST'),origin));
 assert.equal(sessions.require(request(cookie),origin).ownerId,'owner');
 assert.match(sessions.logout(request(cookie,'POST',{origin,'x-csrf-token':next.csrfToken}),origin),/Max-Age=0/);
 assert.throws(()=>sessions.require(request(cookie),origin));
});
test('invalid UTF-8 credential comparison fails safely, and failed-login throttling expires',()=>{
 let now=0;const sessions=new OwnerSessions(token,false,()=>now);
 for(let attempt=0;attempt<20;attempt++)assert.throws(()=>sessions.login('owner','é'.repeat(token.length)),/OWNER_AUTH_REQUIRED/);
 assert.throws(()=>sessions.login('owner',token),/LOGIN_THROTTLED/);
 now=60000;assert.ok(sessions.login('owner',token).cookie);
});
