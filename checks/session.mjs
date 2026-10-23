import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {handleApi} from '../server/api.js';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const user={id:A,email:'runner@example.com',email_confirmed_at:'2026-01-01'};
const env={SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'publishable',APP_ORIGIN:'https://app.example'};
const req=(path,cookie='',body={},extra={})=>new Request(env.APP_ORIGIN+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{origin:env.APP_ORIGIN,'content-type':'application/json',cookie,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
const original=globalThis.fetch;let providerCalls=[];
globalThis.fetch=async(url,options)=>{providerCalls.push({url,options});if(url.endsWith('/user'))return Response.json(user);if(url.includes('grant_type=refresh_token'))return Response.json({access_token:'rotated-access',refresh_token:'rotated-refresh',expires_in:3600,user});if(url.endsWith('/logout?scope=local'))return new Response(null,{status:204});throw Error(url);};
let r=await handleApi(req('auth/refresh','__Host-dv-refresh=old-refresh'),env);assert.equal(r.status,200);const payload=await r.json();assert.equal(payload.user.id,A);assert.equal(payload.session.canRefresh,true);assert.ok(payload.session.expiresAt>Date.now()+3500000);assert.ok(!JSON.stringify(payload).includes('rotated-'));
let cookies=r.headers.get('set-cookie');assert.match(cookies,/__Host-dv-access=rotated-access/);assert.match(cookies,/__Host-dv-refresh=rotated-refresh; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax/);assert.deepEqual(JSON.parse(providerCalls[0].options.body),{refresh_token:'old-refresh'});
const jwt='e30.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.sig';
r=await handleApi(new Request(env.APP_ORIGIN+'/api/auth/me',{headers:{cookie:'__Host-dv-access='+jwt+'; __Host-dv-refresh=old-refresh'}}),env);const info=await r.json();assert.equal(info.session.canRefresh,true);assert.ok(info.session.expiresAt>Date.now());assert.ok(!JSON.stringify(info).includes(jwt));
r=await handleApi(new Request(env.APP_ORIGIN+'/api/auth/me',{headers:{cookie:'__Host-dv-refresh=old-refresh'}}),env);assert.deepEqual(await r.json(),{user:null,session:{expiresAt:null,canRefresh:true}});
r=await handleApi(req('account/sync','__Host-dv-access='+jwt,{}, {'x-account-id':B}),env);assert.equal(r.status,409);assert.equal((await r.json()).code,'ACCOUNT_CHANGED');
const before=providerCalls.length;r=await handleApi(new Request(env.APP_ORIGIN+'/api/auth/refresh',{method:'POST',headers:{origin:'https://other.example','content-type':'application/json'},body:'{}'}),env);assert.equal(r.status,403);assert.equal(providerCalls.length,before);
r=await handleApi(req('auth/logout','__Host-dv-refresh=old-refresh'),env);assert.equal(r.status,200);assert.ok(providerCalls.some(c=>c.url.endsWith('/logout?scope=local')&&c.options.headers.Authorization==='Bearer rotated-access'));assert.match(r.headers.get('set-cookie'),/__Host-dv-refresh=; Path=\/; Max-Age=0/);
globalThis.fetch=async()=>Response.json({error:'private provider detail'},{status:400});r=await handleApi(req('auth/refresh','__Host-dv-refresh=revoked'),env);assert.equal(r.status,401);assert.equal((await r.json()).code,'SESSION_EXPIRED');assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
globalThis.fetch=async()=>Response.json({error:'private provider detail'},{status:503});r=await handleApi(req('auth/refresh','__Host-dv-refresh=valid'),env);assert.equal(r.status,502);assert.equal(r.headers.get('set-cookie'),null);assert.ok(!(await r.text()).includes('private provider detail'));
globalThis.fetch=original;

function browser(fetcher,shared={tail:Promise.resolve()},channels=null){
 const events=[],timers=new Map();let next=0;
 class CustomEvent extends Event{constructor(name,{detail}={}){super(name);this.detail=detail;}}
 class Channel{constructor(){channels?.push(this)}postMessage(data){for(const c of channels||[])if(c!==this)c.onmessage?.({data})}}
 const context=vm.createContext({URL,Date,Event,CustomEvent,AbortSignal,Promise,Map,fetch:fetcher,location:{origin:env.APP_ORIGIN,href:env.APP_ORIGIN+'/#plano'},navigator:{locks:{request(name,fn){assert.equal(name,'dez-voltas-session');const task=shared.tail.then(fn);shared.tail=task.catch(()=>{});return task}}},window:{dispatchEvent:e=>events.push(e),addEventListener(){}},document:{addEventListener(){},hidden:false},setTimeout:(fn,delay)=>{timers.set(++next,{fn,delay});return next},clearTimeout:id=>timers.delete(id),...(channels?{BroadcastChannel:Channel}:{})});
 vm.runInContext(fs.readFileSync('dist/session-client.js','utf8').replace(/export /g,''),context);
 return {context,events,timers};
}
let fresh=false,refreshes=0,attempts=0,networkDown=false,alwaysReject=false;
const fetcher=async(path,options)=>{assert.equal(options.credentials,'same-origin');
 if(path==='/api/auth/me')return fresh?Response.json({user,session:{expiresAt:Date.now()+3600000,canRefresh:true}}):Response.json({error:'expired'},{status:401});
 if(path==='/api/auth/refresh'){refreshes++;if(networkDown)throw Error('offline');fresh=true;return Response.json({user,session:{expiresAt:Date.now()+3600000,canRefresh:true}});}
 attempts++;return fresh&&!alwaysReject?Response.json({ok:true}):Response.json({error:'expired'},{status:401});
};
const one=browser(fetcher);const results=await Promise.all([one.context.sessionFetch('/api/account/sync'),one.context.sessionFetch('/api/training/check',{method:'POST',body:'{}'})]);assert.ok(results.every(r=>r.ok));assert.equal(refreshes,1);assert.equal(attempts,4);
fresh=false;refreshes=0;const lock={tail:Promise.resolve()},two=browser(fetcher,lock),three=browser(fetcher,lock);await Promise.all([two.context.sessionFetch('/api/account/sync'),three.context.sessionFetch('/api/account/sync')]);assert.equal(refreshes,1);
fresh=false;networkDown=true;const offline=browser(fetcher);await assert.rejects(()=>offline.context.sessionFetch('/api/account/sync'));assert.ok(!offline.events.some(e=>e.type==='session-expired'));networkDown=false;
fresh=false;alwaysReject=true;attempts=0;const noLoop=browser(fetcher);assert.equal((await noLoop.context.sessionFetch('/api/account/sync')).status,401);assert.equal(attempts,2);alwaysReject=false;
// Proactive renewal is scheduled before expiry, rather than extending JWT lifetime.
const proactive=browser(async path=>path==='/api/auth/me'?Response.json({user,session:{expiresAt:Date.now()+60000,canRefresh:true}}):Response.json({user,session:{expiresAt:Date.now()+3600000,canRefresh:true}}));await proactive.context.sessionFetch('/api/auth/me');assert.ok([...proactive.timers.values()].some(t=>t.delay===30000));await proactive.context.renewSession();assert.ok([...proactive.timers.values()].some(t=>t.delay>30000));
const expired=browser(async path=>Response.json({error:'expired'},{status:401}));await expired.context.sessionFetch('/api/account/sync');assert.ok(expired.events.some(e=>e.type==='session-expired'));
// Same-origin tabs react to sign-out; no credentials are broadcast.
const channels=[];const tab1=browser(async()=>Response.json({ok:true}),{tail:Promise.resolve()},channels),tab2=browser(fetcher,{tail:Promise.resolve()},channels);await tab1.context.sessionFetch('/api/auth/logout',{method:'POST',body:'{}'});assert.ok(tab2.events.some(e=>e.type==='session-ended'));
console.log('PASS: cookies/rotação de sessão, metadados sem tokens, origem, falha temporária, revogação, logout local, renovação em paralelo/abas, agendamento, offline e repetição limitada da requisição.');

// Logout waits for an in-flight rotation and prevents its metadata from restoring the session.
let release,startedResolve,logoutCalls=0;const started=new Promise(r=>startedResolve=r);let rotated=false;
const logoutRace=browser(async path=>{
 if(path==='/api/auth/me')return Response.json({error:'expired'},{status:401});
 if(path==='/api/auth/refresh'){startedResolve();await new Promise(r=>release=r);rotated=true;return Response.json({user,session:{expiresAt:Date.now()+3600000,canRefresh:true}});}
 if(path==='/api/auth/logout'){assert.equal(rotated,true);logoutCalls++;return Response.json({ok:true});}
 return Response.json({error:'expired'},{status:401});
});
const rotating=logoutRace.context.sessionFetch('/api/account/sync');await started;const leaving=logoutRace.context.sessionFetch('/api/auth/logout',{method:'POST',body:'{}'});assert.equal(logoutCalls,0);release();await Promise.all([rotating,leaving]);assert.equal(logoutCalls,1);await assert.rejects(()=>logoutRace.context.renewSession());
let currentUser=user;
const switched=browser(async path=>path==='/api/auth/me'?Response.json({user:currentUser,session:{expiresAt:Date.now()+3600000,canRefresh:true}}):Response.json({code:'ACCOUNT_CHANGED'},{status:409}));
await switched.context.sessionFetch('/api/auth/me');currentUser={...user,id:B};await switched.context.sessionFetch('/api/account/sync');assert.equal(switched.events.find(e=>e.type==='session-account-change').detail.id,B);
console.log('PASS: logout concorrente com renovação não restaura a sessão; troca de conta em outra aba é identificada.');
