import assert from 'node:assert/strict';
import {prepareWeeklyReview,validateWeeklyCheckin} from '../dist/weekly-contract.js';
import {validateProfile,validateStoredProfile,validateSuggestion,addDate,daysBetween,localToday} from '../dist/training-contract.js';
import {trainingCalendar,phaseCalendar,attachPhaseDates,generateSuggestion,handleApi} from '../server/api.js';
import {checkedSuggestion,suggestionId} from '../dist/active-plan.js';
import {documentRows,rowsDocument} from '../dist/relational-contract.js';
const today=localToday(),start=addDate(today,-7),end=addDate(today,-1);
const report={fatigue:2,sleep:4,readiness:4,pain:'none',illness:false,complete:true,consent:true,days:[0,2,4],maxMinutes:60,longMinutes:100,notes:'Boa recuperação, menos tempo na quinta.'};
const old=validateProfile({goal:'distance',target:21,startDate:addDate(today,-28),targetDate:addDate(today,120),weeklyKm:20,longestKm:10,weeksConsistent:8,days:[0,2,4],maxMinutes:60,longMinutes:100,pain:'none',consent:true},addDate(today,-28));
const week=Array.from({length:3},(_,i)=>({id:'s'+i,date:addDate(start,i*2),km:5,minutes:35,rpe:3,pain:'none',notes:'Confortável'}));
const ctx={profile:old,sourcePlanId:'ai-test-123',weekStart:start,weekEnd:end,checkin:report,currentPain:'none',previousCheckin:report,planned:week.map(({pain,notes,...x})=>x),logs:[...week,...week.map(x=>({...x,id:'old-'+x.id,date:addDate(x.date,-7)}))]};
const prepared=prepareWeeklyReview(ctx,today),p=prepared.profile;assert.equal(p.review.decision,'increase');assert.equal(p.startDate,today);assert.equal(p.targetDate,old.targetDate);assert.equal(p.weeklyKm,15);assert.equal(p.review.maxWeeklyKm,15.7);assert.ok(p.review.maxLoad<=315*1.05);
assert.equal(prepareWeeklyReview({...ctx,logs:ctx.logs.map(x=>x.id.startsWith('old-')?{...x,km:1,minutes:10}:x)},today).profile.review.decision,'reduce');
assert.equal(prepareWeeklyReview({...ctx,previousCheckin:null},today).profile.review.decision,'hold');
assert.equal(prepareWeeklyReview({...ctx,checkin:{...report,complete:false}},today).profile.review.decision,'reduce');
for(const patch of [{fatigue:4},{sleep:2},{readiness:2}])assert.equal(prepareWeeklyReview({...ctx,checkin:{...report,...patch}},today).profile.review.decision,'reduce');
for(const patch of [{pain:'mild'},{illness:true},{consent:false},{days:[]}])assert.throws(()=>prepareWeeklyReview({...ctx,checkin:{...report,...patch}},today));
assert.throws(()=>prepareWeeklyReview({...ctx,currentPain:'return'},today));
assert.throws(()=>prepareWeeklyReview({...ctx,logs:ctx.logs.map(x=>x.id==='s0'?{...x,pain:'stop'}:x)},today),/diário contém dor/);
assert.throws(()=>prepareWeeklyReview({...ctx,logs:[]},today),/Não há treinos/);
assert.throws(()=>prepareWeeklyReview(ctx,end),/encerrada/);
assert.throws(()=>prepareWeeklyReview(ctx,addDate(end,8)),/recentemente/);
for(const patch of [{fatigue:0},{sleep:6},{days:[0,0]},{notes:'x'.repeat(1001)},{consent:'yes'}])assert.throws(()=>validateWeeklyCheckin({...report,...patch}));
assert.throws(()=>validateProfile(p,today),/fechamento semanal/);assert.deepEqual(validateStoredProfile(p),p);
for(const slot of trainingCalendar(p)){assert.equal(slot.weeklyKmCeiling,p.review.maxWeeklyKm);assert.equal(slot.sessionKmCeiling,p.review.maxSessionKm);}
function sample(profile){return {summary:'Manter ou progredir um pouco conforme recuperação.',feasibility:'Revisão semanal do realizado.',warnings:['Reavaliar na próxima semana.'],phases:phaseCalendar(profile).map(x=>({...x,title:'Preparação',focus:'Adaptar pela recuperação.'})),weeks:trainingCalendar(profile).map(slot=>{const sessions=slot.availableDates.slice(0,3).map(date=>({date,title:'Corrida fácil',km:5,minutes:35,rpe:3,long:false,instructions:'Interrompa com dor; não compense faltas.'}));return {start:slot.start,totalKm:sessions.length*5,focus:'Confortável',sessions};})};}
const plan=validateSuggestion(sample(p),p);assert.equal(plan.weeks.length,4);
let bad=sample(p);bad.weeks[3].sessions[0].km=6;bad.weeks[3].totalKm=16;assert.throws(()=>validateSuggestion(bad,p),/volume|longo/);
bad=sample(p);bad.weeks[0].sessions[0].minutes=40;assert.throws(()=>validateSuggestion(bad,p),/recuperação/);
bad=sample(p);bad.weeks[0].sessions.forEach(x=>x.rpe=4);assert.throws(()=>validateSuggestion(bad,p),/recuperação/);
const result={version:1,profile:p,plan,generatedAt:'2026-10-23T12:00:00Z',model:'test'};assert.deepEqual(checkedSuggestion(result).profile.review,p.review);
const owner='owner-a',entry={...result,id:suggestionId(result,owner),owner,active:true};
const doc={version:1,profile:result,draft:old,archive:{version:1,owner,plans:[entry]},state:{version:1,logs:{},checklist:{},timer:null}};
assert.deepEqual(rowsDocument(documentRows(doc,owner),owner).archive.plans[0].profile.review,p.review,'Review limits survive account synchronization');
const short=prepareWeeklyReview({...ctx,profile:{...old,targetDate:addDate(today,5)}},today).profile;assert.equal(short.preparationDays,5);assert.equal(validateStoredProfile(short).preparationDays,5);assert.equal(validateSuggestion(sample(short),short).weeks.length,1);
// A review can continue a time goal recorded with zero distance.
const timed=prepareWeeklyReview({...ctx,profile:{...old,goal:'time',target:120},planned:ctx.planned.map(x=>({...x,km:0})),logs:ctx.logs.map(x=>({...x,km:0}))},today).profile;assert.equal(timed.review.maxWeeklyKm,0);assert.ok(timed.review.maxWeeklyMinutes>0);
let sent;globalThis.fetch=async(url,options)=>{sent=JSON.parse(options.body);const model=sample(p);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...model,phases:model.phases.map(({title,focus})=>({title,focus}))})}]}}]});};
await generateSuggestion(p,{GEMINI_MODEL:'gemini-test',GEMINI_API_KEY:'private'},prepared.evidence);const input=JSON.parse(sent.contents[0].parts[0].text);assert.equal(input.weeklyReview.performed.length,6);assert.equal(input.weeklyReview.performed[0].id,undefined);assert.match(sent.systemInstruction.parts[0].text,/REVISÃO SEMANAL/);
assert.ok(!JSON.stringify(input).includes(owner));
console.log('PASS: evolução com duas semanas, manter/reduzir, dor/doença, consentimento, registros incompletos, teto sem aumentos compostos, duração/RPE/carga, meta temporal, proximidade da prova, histórico sincronizado e contexto Gemini sem IDs de conta (simulado).');

const env={APP_ORIGIN:'https://example.com',SUPABASE_URL:'https://auth.example.com',SUPABASE_ANON_KEY:'publishable',GEMINI_API_KEY:'secret',GEMINI_MODEL:'gemini-test'};
const jobId='00000000-0000-4000-8000-000000000001',lease='00000000-0000-4000-8000-000000000002',runner='a'.repeat(64);let saved,providerCalls=0;
globalThis.fetch=async(url,options={})=>{
 const body=options.body?JSON.parse(options.body):null;
 if(url.endsWith('/user'))return Response.json({id:owner,email:'private@example.com',email_confirmed_at:'2026-01-01'});
 if(url.endsWith('/rpc/read_weekly_review')){assert.equal(options.headers.Authorization,'Bearer access');return Response.json({planId:ctx.sourcePlanId,weekStart:start,weekEnd:end});}
 if(url.endsWith('/rpc/save_weekly_review')){assert.equal(options.headers.Authorization,'Bearer access');assert.equal(body.plan_id,ctx.sourcePlanId);assert.equal(body.expected_revision,0);assert.deepEqual(body.report_data,report);return Response.json({id:'checkin',revision:1});}
 if(url.endsWith('/rpc/claim_ai_generation'))return Response.json({id:jobId,lease,kind:'weekly_review',profile:old,context:ctx});
 if(url.endsWith('/rpc/finish_ai_generation')){saved=body;return Response.json(true);}
 if(url.includes(':generateContent')){providerCalls++;const payload=JSON.parse(options.body),input=JSON.parse(payload.contents[0].parts[0].text);assert.equal(input.weeklyReview.performed.length,6);assert.ok(!options.body.includes('private@example.com'));const raw=sample(input.profile);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...raw,phases:raw.phases.map(({title,focus})=>({title,focus}))})}]}}]});}
 throw Error('Unexpected endpoint '+url);
};
const request=(body,headers={})=>new Request(env.APP_ORIGIN+'/api/training/weekly-review',{method:body?'POST':'GET',headers:{cookie:'__Host-dv-access=access',origin:env.APP_ORIGIN,'content-type':'application/json','x-account-id':owner,...headers},...(body?{body:JSON.stringify(body)}:{})});
assert.equal((await handleApi(request(),env)).status,200);
assert.equal((await handleApi(request(undefined,{cookie:''}),env)).status,401);
assert.equal((await handleApi(request(undefined,{'x-account-id':'another-owner'}),env)).status,409);
const payload={planId:ctx.sourcePlanId,weekStart:start,revision:0,report};
assert.equal((await handleApi(request(payload),env)).status,201);
assert.equal((await handleApi(request({...payload,report:{...report,fatigue:10}}),env)).status,400);
assert.equal((await handleApi(request(payload,{origin:'https://evil.example'}),env)).status,403);
const r=await handleApi(new Request(env.APP_ORIGIN+'/api/internal/ai-runner',{method:'POST',headers:{'x-dv-runner-key':runner}}),env);assert.equal(r.status,200);assert.equal(saved.job_result.profile.review.sourcePlanId,ctx.sourcePlanId);assert.equal(providerCalls,1);assert.equal(saved.job_result.profile.startDate,today);
ctx.checkin={...report,pain:'mild'};
await handleApi(new Request(env.APP_ORIGIN+'/api/internal/ai-runner',{method:'POST',headers:{'x-dv-runner-key':runner}}),env);assert.equal(providerCalls,1,'Pain must stop before any Gemini request');assert.equal(saved.job_result,null);assert.match(saved.job_error,/dor/);assert.equal(saved.retryable,false);
console.log('PASS: API semanal com autenticação/origem/conta/revisão, worker recebe diário real da tarefa e bloqueia geração com dor antes de chamar Gemini (simulado).');
