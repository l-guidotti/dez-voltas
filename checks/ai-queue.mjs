import {easyWorkouts} from './workout-fixtures.mjs';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {handleApi,phaseCalendar,trainingCalendar} from '../server/api.js';
import {validateProfile,localToday,addDate} from '../dist/training-contract.js';
globalThis.crypto??=webcrypto;
const env={APP_ORIGIN:'https://example.com',SUPABASE_URL:'https://auth.example.com',SUPABASE_ANON_KEY:'publishable',GEMINI_API_KEY:'secret-key',GEMINI_MODEL:'gemini-3.5-flash-lite'};
const profile=validateProfile({goal:'distance',target:10,startDate:localToday(),targetDate:addDate(localToday(),90),weeklyKm:10,longestKm:6,weeksConsistent:4,days:[0,2,4],maxMinutes:60,longMinutes:90,pain:'none',consent:true});
const id=crypto.randomUUID(),lease=crypto.randomUUID(),runnerKey='a'.repeat(64),requestId=crypto.randomUUID();
let calls=[],providerStatus=200,finish='STOP',claim=true,failAck=false,finishBody,quota=false;
const plan={summary:'Preparação gradual',feasibility:'Revisar conforme recuperação',warnings:[],phases:phaseCalendar(profile).map(()=>({title:'Base e recuperação',focus:'Reavaliar com o treino realizado'})),weeks:trainingCalendar(profile).map(w=>({start:w.start,totalKm:3,focus:'Corrida confortável',sessions:[{date:w.availableDates[0],title:'Rodagem',km:3,minutes:30,rpe:3,long:false,instructions:'Caminhe quando precisar.'}]}))};
globalThis.fetch=async(url,options={})=>{
 calls.push({url,options});const body=options.body?JSON.parse(options.body):null;
 if(url.endsWith('/auth/v1/user'))return Response.json({id:'owner-a',email:'runner@example.com',email_confirmed_at:'2026-01-01'});
 if(url.includes('/rpc/enqueue_ai_generation')){
  assert.equal(options.headers.Authorization,'Bearer access');assert.equal(body.client_request_id,requestId);assert.deepEqual(body.job_profile,profile);
  return quota?Response.json({message:'USER_DAILY_LIMIT'},{status:400}):Response.json({id,status:'queued',attempts:0});
 }
 if(url.includes('/rpc/claim_ai_generation')){
  if(body.runner_key!==runnerKey)return Response.json({code:'42501'},{status:403});
  return Response.json(claim?{id,lease,profile,attempts:1}:null);
 }
 if(url.includes('/rpc/finish_ai_generation')){finishBody=body;return failAck?Response.json({message:'private database details'},{status:503}):Response.json(true);}
 if(url.includes('/rest/v1/ai_generation_jobs')){assert.equal(options.headers.Authorization,'Bearer access');return Response.json([{id,status:'completed',attempts:1,...(url.includes(',result')?{result:{profile,plan:easyWorkouts(plan)}}:{})}]);}
 if(url.includes(':generateContent')){
  assert.ok(!options.body.includes('runner@example.com'));assert.ok(!options.body.includes(runnerKey));
  const payload=JSON.parse(options.body);assert.equal(payload.generationConfig.maxOutputTokens,12000);assert.ok(Buffer.byteLength(options.body)<=60000);
  if(providerStatus!==200)return Response.json({error:{message:'private provider details',status:'INTERNAL'}},{status:providerStatus});
  return Response.json({usageMetadata:{promptTokenCount:1200,candidatesTokenCount:2500,thoughtsTokenCount:100},candidates:[{finishReason:finish,content:{parts:[{text:JSON.stringify(easyWorkouts(plan))}]}}]});
 }
 throw Error('Unexpected endpoint '+url);
};
const req=(path,body,headers={})=>new Request(env.APP_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{'x-dv-training-format':'2',origin:env.APP_ORIGIN,cookie:'__Host-dv-access=access','content-type':'application/json','x-account-id':'owner-a',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
let r=await handleApi(req('/api/training/suggest',profile,{'idempotency-key':requestId}),env);assert.equal(r.status,202);assert.equal((await r.json()).job.id,id);
assert.equal(calls.filter(c=>c.url.includes(':generateContent')).length,0,'Enqueue must not call Gemini');
assert.equal((await handleApi(req('/api/training/suggest',profile,{'x-dv-training-format':''}),env)).status,426);
quota=true;r=await handleApi(req('/api/training/suggest',profile,{'idempotency-key':requestId}),env);assert.equal(r.status,429);assert.match((await r.json()).error,/5 solicitações/);quota=false;
r=await handleApi(req('/api/training/jobs'),env);assert.equal(r.status,200);assert.equal((await r.json()).job.result,undefined,'Status polling does not transfer the full plan');
r=await handleApi(req('/api/training/jobs?id='+id),env);assert.ok((await r.json()).job.result);
assert.equal((await handleApi(req('/api/training/jobs?id='+id,undefined,{'x-dv-training-format':''}),env)).status,426);
r=await handleApi(req('/api/training/jobs',undefined,{'x-account-id':'owner-b'}),env);assert.equal(r.status,409);
const run=key=>new Request(env.APP_ORIGIN+'/api/internal/ai-runner',{method:'POST',headers:key?{'x-dv-runner-key':key}:{}});
let before=calls.length;r=await handleApi(run(),env);assert.equal(r.status,403);assert.equal(calls.length,before);
r=await handleApi(run('b'.repeat(64)),env);assert.equal(r.status,403);assert.equal(calls.filter(c=>c.url.includes(':generateContent')).length,0);
r=await handleApi(run(runnerKey),env);assert.equal(r.status,200);assert.equal((await r.json()).saved,true);assert.equal(finishBody.job_id,id);assert.equal(finishBody.job_lease,lease);assert.equal(finishBody.job_result.plan.weeks.length,4);assert.equal(finishBody.tokens_in,1200);assert.equal(finishBody.tokens_out,2600);assert.equal(finishBody.retryable,false);assert.equal(finishBody.job_error,null);
assert.ok(!(await (await handleApi(run(runnerKey),env)).text()).includes('Preparação gradual'),'Runner response does not expose the result');
for(const [http,retry] of [[429,true],[503,true],[404,false],[400,false]]){providerStatus=http;r=await handleApi(run(runnerKey),env);assert.equal(r.status,200);assert.equal(finishBody.retryable,retry);assert.equal(finishBody.job_result,null);assert.ok(!finishBody.job_error.includes('private provider details'));}
providerStatus=200;finish='MAX_TOKENS';await handleApi(run(runnerKey),env);assert.equal(finishBody.retryable,false);assert.equal(finishBody.tokens_out,2600,'Usage is counted even when the response is invalid');
finish='STOP';failAck=true;r=await handleApi(run(runnerKey),env);assert.equal(r.status,503);assert.ok(!(await r.text()).includes('private database details'));failAck=false;
claim=false;before=calls.filter(c=>c.url.includes(':generateContent')).length;r=await handleApi(run(runnerKey),env);assert.equal((await r.json()).processed,false);assert.equal(calls.filter(c=>c.url.includes(':generateContent')).length,before);
console.log('PASS: fila autenticada sem geração síncrona, idempotência, limite, status leve, resultado posterior, isolamento, runner privado, tokens, falhas transitórias/permanentes e confirmação perdida (provedores simulados).');
