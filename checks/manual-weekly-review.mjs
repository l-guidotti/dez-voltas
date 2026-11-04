import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {handleApi} from '../server/api.js';
const db=new PGlite(),A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002',request='20000000-0000-4000-8000-000000000001';
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema ai_private;grant usage on schema auth,ai_private to authenticated;create table auth.users(id uuid primary key,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 const relational=await fs.readFile('database/relational-training.sql','utf8');await db.exec(relational.split('\n').slice(0,20).join('\n'));
 await db.exec("alter table public.training_sessions add column workout jsonb;");
 const queue=await fs.readFile('database/ai-queue.sql','utf8');await db.exec(queue.slice(queue.indexOf('create table public.ai_generation_jobs'),queue.indexOf('-- The capability stays')));
 const enqueue=queue.match(/create function public\.enqueue_ai_generation[\s\S]*?grant execute on function public\.enqueue_ai_generation\(jsonb,uuid\) to authenticated;/)[0];
 await db.exec(enqueue+'alter function public.enqueue_ai_generation(jsonb,uuid) set schema ai_private;');
 const weekly=await fs.readFile('database/weekly-reviews.sql','utf8');await db.exec(weekly.slice(0,weekly.indexOf('create function public.read_weekly_review')));
 const recovery=await fs.readFile('database/daily-recovery.sql','utf8');await db.exec(recovery.slice(0,recovery.indexOf('create function ai_private.recovery_alert')) .split('create function ai_private.save_daily_recovery')[0]);
 await db.exec(await fs.readFile('supabase/migrations/20261104204929_manual_weekly_review.sql','utf8'));
 await db.exec(`insert into auth.users values('${A}',now()),('${B}',now());update ai_private.queue_settings set enabled=true;
 insert into public.training_plans(user_id,id,revision,sync_version,profile,plan,generated_at,model,adopted)
 select u,'ai-manual',1,1,jsonb_build_object('goal','distance','target',21.1,'startDate',((now() at time zone 'America/Sao_Paulo')::date-7)::text,'targetDate',((now() at time zone 'America/Sao_Paulo')::date+120)::text,'pain','none','consent',true),'{}',now()::text,'test',true from unnest(array['${A}'::uuid,'${B}'::uuid])u;
 insert into public.training_preferences(user_id,id,revision,sync_version,active_plan_id,checklist) select u,'settings',1,1,'ai-manual','{}' from unnest(array['${A}'::uuid,'${B}'::uuid])u;
 insert into public.weekly_checkins(user_id,source_plan_id,week_start,week_end,report,revision)
 select u,'ai-manual',(now() at time zone 'America/Sao_Paulo')::date-7,(now() at time zone 'America/Sao_Paulo')::date-1,'{"consent":true,"recoveryConsent":true,"complete":true,"pain":"none","illness":false,"fatigue":2,"sleep":4,"readiness":4,"days":[1,3,6],"maxMinutes":60,"longMinutes":90,"notes":"Dados autorizados"}',2 from unnest(array['${A}'::uuid,'${B}'::uuid])u;
 insert into public.training_sessions(user_id,id,revision,sync_version,plan_id,week,date,title,km,minutes,rpe,long_run,instructions) select u,'run',1,1,'ai-manual',1,(now() at time zone 'America/Sao_Paulo')::date-3,'Rodagem',5,30,3,false,'Conversa' from unnest(array['${A}'::uuid,'${B}'::uuid])u;
 insert into public.diary_entries(user_id,id,revision,sync_version,km,minutes,rpe,pain,notes,recorded_at,session_date) select u,'run',1,1,5,30,3,'none',case when u='${A}' then 'Owner A' else 'Private B' end,now()::text,(now() at time zone 'America/Sao_Paulo')::date-3 from unnest(array['${A}'::uuid,'${B}'::uuid])u;
 insert into public.daily_recovery(user_id,day,fatigue,sleep,readiness,pain,illness,notes,activity_type,activity_minutes,last_mutation) select u,(now() at time zone 'America/Sao_Paulo')::date-2,2,4,4,'none',false,case when u='${A}' then 'Recovery A' else 'Recovery B' end,'none',0,gen_random_uuid() from unnest(array['${A}'::uuid,'${B}'::uuid])u;
 insert into public.ai_generation_jobs(user_id,request_id,profile,status,kind,review_id) select '${A}',gen_random_uuid(),'{}','failed','weekly_review',id from public.weekly_checkins where user_id='${A}';
 update public.weekly_checkins c set job_id=j.id from public.ai_generation_jobs j where j.review_id=c.id;
 grant select on public.training_preferences,public.training_plans,public.training_sessions,public.diary_entries to authenticated;
 select set_config('request.jwt.claim.sub','${A}',false);set role authenticated;`);
 const state=async()=>(await db.query('select public.read_weekly_review() as state')).rows[0].state;
 let current=await state();assert.equal(current.canRetry,true);assert.equal(current.history.length,1,'Owner B is never exposed');
 const call=async(revision=2,id=request,week=current.weekStart,plan='ai-manual')=>(await db.query('select public.retry_weekly_review($1,$2,$3,$4) as result',[plan,week,revision,id])).rows[0].result;
 const first=await call();assert.equal(first.job.status,'queued');assert.equal(first.checkin.revision,3);
 assert.equal((await call()).job.id,first.job.id,'Lost-response retry reuses job before revision check');
 assert.equal((await state()).canRetry,false);
 await assert.rejects(call(2,'20000000-0000-4000-8000-000000000002'),/CHECKIN_CONFLICT/);
 await assert.rejects(call(3,'20000000-0000-4000-8000-000000000002'),/REVIEW_BUSY/);
 await assert.rejects(call(3,request,current.weekStart,'ai-someone-else'),/WEEK_PLAN_CHANGED/);
 await db.exec('reset role;');
 const job=(await db.query('select * from public.ai_generation_jobs where id=$1',[first.job.id])).rows[0];
 assert.equal(job.context.manualRequest,true);assert.equal(job.context.logs.length,1);assert.equal(job.context.logs[0].notes,'Owner A');assert.equal(job.context.dailyRecovery[0].notes,'Recovery A');assert.ok(!JSON.stringify(job.context).includes('Private B'));
 assert.equal((await db.query('select count(*)::int as n from public.ai_generation_jobs where review_id=$1',[job.review_id])).rows[0].n,2,'Original failed job retained');
 await db.query("update public.ai_generation_jobs set status='completed' where id=$1",[first.job.id]);
 await db.exec('set role authenticated;');assert.equal((await state()).canRetry,true);
 const second=await call(3,'20000000-0000-4000-8000-000000000002');assert.notEqual(second.job.id,first.job.id);
 await db.exec('reset role;');await db.query("update public.ai_generation_jobs set status='completed' where id=$1",[second.job.id]);
 await db.exec('update ai_private.queue_settings set daily_user_jobs=3;set role authenticated;');
 await assert.rejects(call(4,'20000000-0000-4000-8000-000000000003'),/USER_DAILY_LIMIT/);
 await db.exec('reset role;update ai_private.queue_settings set daily_user_jobs=5;');
 await db.query("update public.weekly_checkins set report=jsonb_set(report,'{consent}','false') where user_id=$1",[A]);await db.exec('set role authenticated;');
 await assert.rejects(call(4,'20000000-0000-4000-8000-000000000003'),/CHECKIN_REQUIRED/);
 await db.exec('reset role;');await db.query("update public.weekly_checkins set report=jsonb_set(jsonb_set(report,'{consent}','true'),'{pain}','\"mild\"') where user_id=$1",[A]);await db.exec('set role authenticated;');
 await assert.rejects(call(4,'20000000-0000-4000-8000-000000000003'),/REVIEW_RECOVERY_BLOCKED/);
 await db.exec('reset role;');await db.query("update public.weekly_checkins set report=jsonb_set(report,'{pain}','\"none\"'),week_start=week_start-8,week_end=week_end-8 where user_id=$1",[A]);await db.exec('set role authenticated;');
 const expired=(await state()).history[0];assert.equal(expired.can_retry,false);
 await assert.rejects(call(4,'20000000-0000-4000-8000-000000000003',expired.week_start),/WEEK_REVIEW_EXPIRED/);
 await db.exec('reset role;');
 const privileges=(await db.query("select has_function_privilege('anon','public.retry_weekly_review(text,date,bigint,uuid)','execute') as anon,has_function_privilege('authenticated','ai_private.weekly_review_context(public.weekly_checkins,jsonb)','execute') as snapshot")).rows[0];assert.equal(privileges.anon,false);assert.equal(privileges.snapshot,false);
 console.log('PASS: nova revisão autenticada, fechamento obrigatório, janela, revisão concorrente, idempotência, histórico preservado, cota real e snapshots isolados/autorizados no PostgreSQL.');
}finally{await db.close();}

const env={APP_ORIGIN:'https://app.example',SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'public'};
let rpcCalls=0,serverError=null;
globalThis.fetch=async(url,options)=>{
 if(url.endsWith('/auth/v1/user'))return Response.json({id:A,email_confirmed_at:'2026-01-01'});
 if(url.endsWith('/rpc/retry_weekly_review')){rpcCalls++;const body=JSON.parse(options.body);assert.equal(body.client_request_id,request);assert.equal(body.expected_revision,2);assert.equal(options.headers.Authorization,'Bearer token');return serverError?Response.json({message:serverError},{status:400}):Response.json({checkin:{revision:3},job:{id:'new-job',status:'queued'}});}
 throw Error('No other endpoint or provider may be called at admission');
};
const body={planId:'ai-manual',weekStart:'2026-10-23',revision:2,requestId:request};
const req=(data=body,headers={})=>new Request(env.APP_ORIGIN+'/api/training/weekly-review/retry',{method:'POST',headers:{origin:env.APP_ORIGIN,cookie:'__Host-dv-access=token','content-type':'application/json','x-account-id':A,'x-dv-training-format':'4',...headers},body:JSON.stringify(data)});
assert.equal((await handleApi(req(),env)).status,202);assert.equal(rpcCalls,1);
for(const [headers,status]of [[{cookie:''},401],[{origin:'https://other.example'},403],[{'x-account-id':B},409],[{'x-dv-training-format':''},426]])assert.equal((await handleApi(req(body,headers),env)).status,status);
assert.equal((await handleApi(req({...body,requestId:'bad'}),env)).status,400);assert.equal(rpcCalls,1);
for(const [message,status]of [['REVIEW_BUSY',409],['CHECKIN_REQUIRED',409],['WEEK_REVIEW_EXPIRED',409],['USER_DAILY_LIMIT',429]]){serverError=message;assert.equal((await handleApi(req(),env)).status,status);}
console.log('PASS: endpoint manual autentica conta/origem, exige versão e idempotência, reutiliza fechamento e fila sem chamar o Gemini diretamente.');
