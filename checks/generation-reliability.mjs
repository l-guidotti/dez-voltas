import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {generateSuggestion,trainingCalendar,phaseCalendar,schemaForCalendar,attachPhaseDates,handleApi} from '../server/api.js';
import {assessGeneratedPlan} from '../server/generation-validation.js';
import {validateProfile,validateSuggestion,localToday,addDate} from '../dist/training-contract.js';
import {easyWorkouts} from './workout-fixtures.mjs';
const p=validateProfile({goal:'distance',target:21.1,startDate:localToday(),targetDate:addDate(localToday(),150),weeklyKm:15,longestKm:6,weeksConsistent:8,days:[1,3,6],maxMinutes:60,longMinutes:90,pain:'none',consent:true});
const env={GEMINI_MODEL:'gemini-test',GEMINI_API_KEY:'secret'};
const valid=easyWorkouts({summary:'Bloco completo',feasibility:'Reavaliar conforme recuperação',warnings:[],phases:phaseCalendar(p).map(()=>({title:'Preparação',focus:'Continuidade'})),weeks:trainingCalendar(p).map(w=>({start:w.start,focus:'Evoluir pela recuperação',sessions:w.availableDates.map(date=>({date,title:'Rodagem',km:4,minutes:35,rpe:3,long:false,instructions:'Conversa confortável'}))}))});
const response=model=>Response.json({usageMetadata:{promptTokenCount:100,candidatesTokenCount:200,thoughtsTokenCount:10},candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'private-thought'},{text:JSON.stringify(model)}]}}]});
const original=structuredClone(valid),wrongTotal=structuredClone(valid);wrongTotal.weeks[0].sessions[0].minutes=999;
const derived=assessGeneratedPlan(attachPhaseDates(wrongTotal,p),p);
assert.ok(derived.plan);assert.equal(derived.plan.weeks[0].sessions[0].minutes,35);
assert.deepEqual(valid,original);assert.equal(wrongTotal.weeks[0].sessions[0].minutes,999,'Never mutate provider evidence');
assert.throws(()=>validateSuggestion({...derived.plan,weeks:derived.plan.weeks.map((w,i)=>i? w:{...w,sessions:w.sessions.map((s,j)=>j?s:{...s,minutes:999})})},p),/tempo|duração/,'Stored plans remain strict');
const schema=schemaForCalendar(p).properties.weeks.items.properties.sessions.items;
assert.equal(schema.properties.minutes,undefined);assert.ok(!schema.required.includes('minutes'));
const bad=structuredClone(valid);for(const w of bad.weeks)for(const s of w.sessions)s.km=8;
const failed=assessGeneratedPlan(attachPhaseDates(bad,p),p);assert.equal(failed.plan,null);
assert.ok(failed.issues.some(x=>x.path==='weeks[0]'&&x.message.includes('24.00')));
let calls=0,reserved=0,sent=[];
const corrected=await generateSuggestion(p,env,null,{diagnostic:'progressive-review-preview',reserveCorrection:async()=>{reserved++;return true;},fetchImpl:async(url,o)=>{sent.push(JSON.parse(o.body));return response(++calls===1?bad:valid);}}).catch(e=>e);
// Diagnostics require a weekly profile; normal generation uses the identical validator/correction.
assert.match(corrected.message,/revisão semanal/);assert.equal(calls,0);
const options={reserveCorrection:async()=>{reserved++;return true;},fetchImpl:async(url,o)=>{sent.push(JSON.parse(o.body));return response(++calls===1?bad:valid);}};
const result=await generateSuggestion(p,env,null,options);
assert.equal(calls,2);assert.equal(reserved,1);assert.ok(result.result.plan);assert.deepEqual(result.usage,{input:200,output:420});
const feedback=JSON.parse(sent[1].contents.at(-1).parts[0].text).validationFeedback;
assert.ok(feedback.issues.some(x=>x.path==='weeks[0]'));assert.equal(feedback.weeklyTotals[0].km,24);
assert.ok(!JSON.stringify(sent).includes('private-thought'));assert.deepEqual(JSON.parse(sent[0].contents[0].parts[0].text),JSON.parse(sent[1].contents[0].parts[0].text));
calls=0;reserved=0;
await assert.rejects(generateSuggestion(p,env,null,{...options,fetchImpl:async()=>{calls++;return response(bad);}}),e=>{assert.deepEqual(e.usage,{input:200,output:420});return /volume/.test(e.message);});
assert.equal(calls,2);assert.equal(reserved,1,'Never loop until a proposal happens to pass');
calls=0;
await assert.rejects(generateSuggestion(p,env,null,{reserveCorrection:async()=>false,fetchImpl:async()=>{calls++;return response(bad);}}),/validar/);assert.equal(calls,1);
calls=0;
await assert.rejects(generateSuggestion(p,env,null,{reserveCorrection:async()=>true,fetchImpl:async()=>++calls===1?response(bad):Response.json({error:{status:'RESOURCE_EXHAUSTED'}},{status:429})}),e=>{assert.deepEqual(e.usage,{input:100,output:210});return /cota/.test(e.message);});
const reviewed={...p,review:{sourcePlanId:'ai-check',weekStart:addDate(p.startDate,-7),weekEnd:addDate(p.startDate,-1),decision:'hold',reason:'Conferir recuperação',observedKm:15,observedMinutes:105,maxWeeklyKm:15,maxWeeklyMinutes:105,maxSessionKm:6,maxSessionMinutes:60,maxRpe:4,maxLoad:500}};
calls=0;
const preview=await generateSuggestion(reviewed,env,null,{diagnostic:'progressive-review-preview',reserveCorrection:async()=>true,fetchImpl:async()=>response(++calls===1?bad:valid)});
assert.equal(preview.result.plan,null);assert.equal(preview.result.diagnostic.validation.accepted,true);
assert.equal(preview.result.diagnostic.attempts.length,2);assert.equal(preview.result.diagnostic.attempts[0].validation.accepted,false);
assert.ok(preview.result.diagnostic.attempts[0].text.includes('"km":8'));assert.ok(preview.result.diagnostic.text.includes('"km":4'));assert.ok(!JSON.stringify(preview).includes('private-thought'));
assert.ok(Buffer.byteLength(JSON.stringify(preview.result))<180000);
calls=0;
const failedCorrection=await generateSuggestion(reviewed,env,null,{diagnostic:'progressive-review-preview',reserveCorrection:async()=>true,fetchImpl:async()=>++calls===1?response(bad):Response.json({error:{status:'UNAVAILABLE'}},{status:503})});
assert.equal(failedCorrection.result.diagnostic.validation.accepted,false);assert.ok(failedCorrection.result.diagnostic.correctionError);
assert.ok(failedCorrection.result.diagnostic.text.includes('"km":8'));assert.deepEqual(failedCorrection.usage,{input:100,output:210});
let ack,reservations=0;calls=0;
globalThis.fetch=async(url,options)=>{
 if(url.endsWith('/claim_ai_generation'))return Response.json({id:'job',lease:'lease',profile:p,attempts:1});
 if(url.endsWith('/reserve_ai_correction')){reservations++;assert.deepEqual(JSON.parse(options.body),{runner_key:'a'.repeat(64),job_id:'job',job_lease:'lease'});return Response.json(true);}
 if(url.includes(':generateContent'))return response(++calls===1?bad:valid);
 if(url.endsWith('/finish_ai_generation')){ack=JSON.parse(options.body);return Response.json(true);}
 throw Error('Unexpected endpoint');
};
assert.equal((await handleApi(new Request('https://app.example/api/internal/ai-runner',{method:'POST',headers:{'x-dv-runner-key':'a'.repeat(64)}}),{...env,SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'public'})).status,200);
assert.equal(calls,2);assert.equal(reservations,1);assert.ok(ack.job_result.plan);assert.equal(ack.tokens_in,200);assert.equal(ack.tokens_out,420);

// Exercise the actual migration in PostgreSQL, including capability, lease and quotas.
const db=new PGlite(),id='10000000-0000-4000-8000-000000000001',lease='20000000-0000-4000-8000-000000000001';
try{
 await db.exec(`create role anon;create role authenticated;create schema ai_private;
 create table ai_private.queue_settings(singleton boolean primary key,enabled boolean,daily_attempts integer);
 create table ai_private.daily_usage(day date primary key,attempts integer default 0);
 create table public.ai_generation_jobs(id uuid primary key,status text,attempts integer check(attempts between 0 and 2),lease uuid,lease_until timestamptz,started_at timestamptz,updated_at timestamptz);
 create function ai_private.authorize_runner(key text) returns void language plpgsql as $$begin if key is distinct from 'test-runner' then raise exception 'Unauthorized' using errcode='42501';end if;end$$;
 insert into ai_private.queue_settings values(true,true,20);
 insert into ai_private.daily_usage values((now() at time zone 'UTC')::date,1);
 insert into public.ai_generation_jobs values('${id}','processing',1,'${lease}',now()+interval '3 minutes',now(),now());`);
 await db.exec(await fs.readFile('supabase/migrations/20261104033134_reserve_gemini_correction.sql','utf8'));
 const reserve=async(key='test-runner',token=lease)=>(await db.query('select public.reserve_ai_correction($1,$2,$3) as ok',[key,id,token])).rows[0].ok;
 await assert.rejects(reserve('wrong'),/Unauthorized/);
 assert.equal(await reserve('test-runner',id),false);assert.equal(await reserve(),true);assert.equal(await reserve(),false);
 assert.equal((await db.query('select attempts from ai_private.daily_usage')).rows[0].attempts,2);
 const reset=()=>db.exec(`update public.ai_generation_jobs set attempts=1,lease_until=now()+interval '3 minutes';update ai_private.daily_usage set attempts=1;update ai_private.queue_settings set enabled=true;`);
 await reset();await db.exec('update ai_private.daily_usage set attempts=20');assert.equal(await reserve(),false);
 await reset();await db.exec('update ai_private.queue_settings set enabled=false');assert.equal(await reserve(),false);
 await reset();await db.exec("update public.ai_generation_jobs set lease_until=now()+interval '30 seconds'");assert.equal(await reserve(),false);
 await reset();await db.exec("update public.ai_generation_jobs set status='completed'");assert.equal(await reserve(),false);
 const permissions=(await db.query("select has_function_privilege('authenticated','public.reserve_ai_correction(text,uuid,uuid)','execute') as authenticated,has_function_privilege('anon','public.reserve_ai_correction(text,uuid,uuid)','execute') as anon")).rows[0];
 assert.equal(permissions.authenticated,false);assert.equal(permissions.anon,true);
 await db.exec('grant usage on schema ai_private to anon,authenticated;set role anon;');
 await assert.rejects(reserve('wrong'),/Unauthorized/);assert.equal(await reserve(),false);
 await db.exec('reset role;set role authenticated;');await assert.rejects(reserve(),/permission denied/);
}finally{await db.close();}
console.log('PASS: duração derivada sem alterar blocos, arquivo estrito, erros quantitativos, correção limitada, tokens de ambas as chamadas, cota recusada, falha posterior e reserva SQL com autorização/lease/limites.');
