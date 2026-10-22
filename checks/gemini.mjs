import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {validateProfile,validateSuggestion,addDate,localToday,daysBetween} from '../dist/training-contract.js';
import {handleApi,trainingCalendar,schemaForCalendar,phaseCalendar,attachPhaseDates} from '../server/api.js';
globalThis.crypto ??= webcrypto;
const start=localToday();
const raw={goal:'backyard',target:10,startDate:start,targetDate:addDate(start,170),weeklyKm:10,longestKm:8,weeksConsistent:2,days:[0,2,3,5],maxMinutes:60,longMinutes:120,pain:'none',consent:true};
const p=validateProfile({...raw,email:'never-send@example.com'});assert.equal(p.email,undefined);
for(let length=14;length<=730;length++){
 const profile={...p,startDate:'2027-01-30',targetDate:addDate('2027-01-30',length),preparationDays:length},phases=phaseCalendar(profile);
 assert.ok(phases.length>=1&&phases.length<=12);assert.equal(phases[0].start,profile.startDate);assert.equal(phases.at(-1).end,profile.targetDate);
 assert.equal(phases.reduce((n,x)=>n+daysBetween(x.start,x.end)+1,0),length+1);
 for(let i=1;i<phases.length;i++)assert.equal(phases[i].start,addDate(phases[i-1].end,1));
 const model={phases:phases.map(()=>({title:'Fase',focus:'Reavaliar conforme recuperação',start:'1900-01-01',end:'1900-01-02'}))};
 const dated=attachPhaseDates(model,profile);assert.equal(dated.phases.at(-1).end,profile.targetDate);assert.equal(model.phases[0].start,'1900-01-01');
 const schema=schemaForCalendar(profile);assert.equal(schema.properties.phases.minItems,phases.length);assert.equal(schema.properties.phases.maxItems,phases.length);assert.equal(schema.properties.phases.items.properties.start,undefined);
}
assert.throws(()=>attachPhaseDates({phases:[]},p),/todas as/);
for(let dayOffset=0;dayOffset<7;dayOffset++)for(const length of [14,15,20,28,29]){
 const startDate=addDate('2026-12-28',dayOffset),profile={...p,startDate,targetDate:addDate(startDate,length),preparationDays:length,days:[0,2,3,5]};
 const slots=trainingCalendar(profile),schema=schemaForCalendar(profile),count=Math.ceil(Math.min(length,28)/7);
 assert.equal(slots.length,count);assert.equal(schema.properties.weeks.prefixItems.length,count);
 for(const [i,slot] of slots.entries()){
  assert.equal(slot.start,addDate(startDate,i*7));assert.equal(schema.properties.weeks.prefixItems[i].properties.start.enum[0],slot.start);
  assert.equal(schema.properties.weeks.prefixItems[i].properties.sessions.maxItems,slot.availableDates.length);
  for(const date of slot.availableDates){assert.ok(date>=slot.start&&date<=slot.end&&date<profile.targetDate);assert.ok(profile.days.includes(new Date(date+'T12:00:00Z').getUTCDay()));}
 }
}
const partial={...p,startDate:'2026-10-22',targetDate:'2026-11-06',preparationDays:15,days:[0,2]};
assert.equal(trainingCalendar(partial).at(-1).maxSessions,0);assert.equal(schemaForCalendar(partial).properties.weeks.prefixItems.at(-1).properties.sessions.maxItems,0);
for(const patch of [{consent:false},{days:[2,2]},{targetDate:start},{startDate:'2026-02-30'},{weeklyKm:NaN},{longestKm:-1},{days:[9]},{weeksConsistent:1.5}])assert.throws(()=>validateProfile({...raw,...patch}));
function sample(){return {summary:'Preparação gradual.',feasibility:'Meta a revisar pela recuperação.',warnings:['Ajuste se houver fadiga.'],phases:[{start,end:p.targetDate,title:'Preparação',focus:'Base, especificidade, recuperação e polimento.'}],weeks:Array.from({length:4},(_,i)=>{const from=addDate(start,i*7);const day=Array.from({length:7},(_,n)=>addDate(from,n)).find(d=>p.days.includes(new Date(d+'T12:00:00Z').getUTCDay()));return {start:from,totalKm:5,focus:'Corrida confortável.',sessions:[{date:day,title:'Rodagem',km:5,minutes:35,rpe:3,long:false,instructions:'Conversa confortável; caminhe se precisar.'}]};})};}
function modelSample(){return {...sample(),phases:phaseCalendar(p).map(()=>({title:'Preparação',focus:'Revisar progressão conforme recuperação.'}))};}
assert.equal(validateSuggestion(attachPhaseDates(modelSample(),p),p).phases.at(-1).end,p.targetDate);
assert.equal(validateSuggestion(sample(),p).weeks.length,4);
{const bad=sample();bad.weeks[0].start=addDate(start,-1);assert.throws(()=>validateSuggestion(bad,p),/o início deve ser/);}
{const bad=sample();bad.weeks[0].sessions=Array(5).fill(bad.weeks[0].sessions[0]);assert.throws(()=>validateSuggestion(bad,p),/5 sessões.*4 dias/);}
for(const mutate of [x=>x.phases[0].end=addDate(p.targetDate,-1),x=>x.weeks[0].totalKm=99,x=>x.weeks[0].sessions[0].minutes=400,x=>x.weeks[0].sessions[0].rpe=9,x=>x.weeks[0].sessions[0].date=p.targetDate,x=>x.weeks[0].sessions.push(x.weeks[0].sessions[0]),x=>{x.weeks[0].totalKm=25;x.weeks[0].sessions[0].km=25;}]){const x=sample();mutate(x);assert.throws(()=>validateSuggestion(x,p));}
const env={APP_ORIGIN:'https://example.com',SUPABASE_URL:'https://auth.example.com',SUPABASE_ANON_KEY:'publishable',GEMINI_API_KEY:'secret',GEMINI_MODEL:'gemini-2.5-flash',AI_USAGE:{data:new Map(),async get(k){return this.data.get(k)},async put(k,v){this.data.set(k,v)}}};
const user={id:'uid-a',email:'runner@example.com',email_confirmed_at:'2026-01-01'};
const calls=[];globalThis.fetch=async(url,options={})=>{calls.push({url,options});if(url.endsWith('/user'))return Response.json(user);if(url.endsWith('/settings'))return Response.json({external:{google:true}});if(url.includes('/otp?'))return Response.json({});if(url.includes('grant_type=pkce'))return Response.json({access_token:'confirmed-access',expires_in:3600,user});if(url.endsWith('/logout'))return new Response(null,{status:204});if(url.includes('generateContent'))return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(modelSample())}]}}]});throw Error('Unexpected URL');};
function request(path,body,cookie='__Host-dv-access=valid',origin=env.APP_ORIGIN){return new Request(env.APP_ORIGIN+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',cookie,'CF-Connecting-IP':'192.0.2.1'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
assert.equal((await handleApi(request('training/suggest',raw,''),env)).status,401);
assert.equal((await handleApi(request('training/suggest',raw,undefined,'https://evil.example'),env)).status,403);
assert.equal((await handleApi(request('training/suggest',{...raw,consent:false}),env)).status,400);
assert.equal((await handleApi(request('training/suggest',{...raw,pain:'current'}),env)).status,422);
assert.equal(calls.filter(x=>x.url.includes('generateContent')).length,0);
let google=await handleApi(request('auth/google',{},''),env);assert.equal(google.status,200);
const googleUrl=new URL((await google.json()).url);assert.equal(googleUrl.origin,'https://auth.example.com');assert.equal(googleUrl.pathname,'/auth/v1/authorize');assert.equal(googleUrl.searchParams.get('provider'),'google');assert.equal(googleUrl.searchParams.get('redirect_to'),'https://example.com/?auth=callback');assert.equal(googleUrl.searchParams.get('code_challenge_method'),'s256');assert.equal(googleUrl.searchParams.get('prompt'),'select_account');assert.match(google.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
const googleVerifier=decodeURIComponent(/__Host-dv-pkce=([^;]+)/.exec(google.headers.get('set-cookie'))[1]);const expectedChallenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(googleVerifier))).toString('base64url');assert.equal(googleUrl.searchParams.get('code_challenge'),expectedChallenge);assert.ok(!googleUrl.href.includes(googleVerifier));
assert.equal((await handleApi(request('auth/google',{},'','https://evil.example'),env)).status,403);
const googleCallback=await handleApi(request('auth/callback',{code:'google-code'},'__Host-dv-pkce='+encodeURIComponent(googleVerifier)),env);assert.equal(googleCallback.status,200);assert.match(googleCallback.headers.get('set-cookie'),/__Host-dv-access=confirmed-access/);
let r=await handleApi(request('auth/link',{email:user.email},''),env);assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);const pkce=/__Host-dv-pkce=([^;]+)/.exec(r.headers.get('set-cookie'))[1];const otp=calls.find(x=>x.url.includes('/otp?'));assert.equal(JSON.parse(otp.options.body).code_challenge_method,'s256');assert.ok(JSON.parse(otp.options.body).code_challenge);
assert.equal((await handleApi(request('auth/callback',{code:'x'},''),env)).status,401);
r=await handleApi(request('auth/callback',{code:'x'},'__Host-dv-pkce='+pkce),env);assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/__Host-dv-access=confirmed-access/);assert.ok(!(await r.text()).includes('confirmed-access'));
r=await handleApi(request('training/suggest',{...raw,email:'do-not-send@example.com'}),env);assert.equal(r.status,200);assert.equal((await r.json()).plan.weeks.length,4);const call=calls.find(x=>x.url.includes('generateContent'));assert.ok(!call.options.body.includes('@'));assert.equal(call.options.headers['x-goog-api-key'],'secret');
const payload=JSON.parse(call.options.body),sent=JSON.parse(payload.contents[0].parts[0].text);assert.equal(sent.calendar[0].start,p.startDate);assert.deepEqual(sent.profile.days,p.days);assert.equal(payload.generationConfig.responseJsonSchema.properties.weeks.prefixItems.length,4);
assert.deepEqual(sent.phases,phaseCalendar(p));
for(let i=0;i<4;i++)assert.equal((await handleApi(request('training/suggest',raw),env)).status,200);
assert.equal((await handleApi(request('training/suggest',raw),env)).status,429);
assert.equal((await handleApi(request('training/suggest',raw),{...env,AI_USAGE:null})).status,503);
r=await handleApi(request('auth/logout',{}),env);assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
const otherEnv={...env,AI_USAGE:{async get(){return null},async put(){}}};
globalThis.fetch=async(url)=>url.endsWith('/user')?Response.json(user):Response.json({candidates:[{finishReason:'MAX_TOKENS'}]});assert.equal((await handleApi(request('training/suggest',raw),otherEnv)).status,502);
globalThis.fetch=async(url)=>url.endsWith('/user')?Response.json(user):Response.json({error:'secret provider details'},{status:500});r=await handleApi(request('training/suggest',raw),otherEnv);assert.equal(r.status,502);assert.ok(!(await r.text()).includes('secret provider details'));
for(const [http,reason,status,expected] of [[400,'API_KEY_INVALID','INVALID_ARGUMENT','recusou a chave'],[403,'SERVICE_DISABLED','PERMISSION_DENIED','desativada'],[403,'API_KEY_HTTP_REFERRER_BLOCKED','PERMISSION_DENIED','restrições'],[404,null,'NOT_FOUND','não está disponível'],[429,null,'RESOURCE_EXHAUSTED','cota'],[400,null,'INVALID_ARGUMENT','compatibilidade']]){
 globalThis.fetch=async(url)=>url.endsWith('/user')?Response.json(user):Response.json({error:{message:'secret provider details',status,details:[{reason}]}},{status:http});
 r=await handleApi(request('training/suggest',raw),otherEnv);const text=await r.text();assert.ok(text.includes(expected));assert.ok(text.includes('HTTP '+http));assert.ok(!text.includes('secret provider details'));
}
let metadataCalls=0;
globalThis.fetch=async(url,options)=>{if(url.endsWith('/user'))return Response.json(user);metadataCalls++;assert.ok(!url.includes('generateContent'));assert.equal(options.body,undefined);return Response.json({supportedGenerationMethods:['generateContent']});};
assert.equal((await handleApi(request('training/check',{},''),otherEnv)).status,401);
r=await handleApi(request('training/check',{}),otherEnv);assert.equal(r.status,200);assert.ok((await r.text()).includes('Conexão confirmada'));assert.equal(metadataCalls,1);
globalThis.fetch=async(url)=>url.endsWith('/user')?Response.json(user):Response.json({error:{status:'PERMISSION_DENIED',message:'Your API key was reported as leaked.'}},{status:403});
r=await handleApi(request('training/check',{}),otherEnv);assert.ok((await r.text()).includes('possível exposição'));
globalThis.fetch=async()=>Response.json({external:{google:false}});
r=await handleApi(request('auth/google',{},''),otherEnv);assert.equal(r.status,503);assert.ok((await r.text()).includes('use o link por e-mail'));
console.log('PASS: perfil, datas, disponibilidade, totais, carga inicial, PKCE, cookies, autenticação, consentimento, origem, anonimização, cota e erros do Gemini (provedores simulados).');
