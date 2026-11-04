import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const sql=await fs.readFile('supabase/migrations/20261104022208_backyard_goal_kilometers.sql','utf8');
const db=new PGlite();
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
const legacy={goal:'backyard',target:20},canonical={goal:'backyard',target:134.112,targetUnit:'km'},distance={goal:'distance',target:20};
const snapshot=async()=>{
 const out={};for(const table of ['training_plans','runner_profiles','training_sync_state','training_sessions','diary_entries','training_preferences','ai_generation_jobs'])out[table]=(await db.query(`select to_jsonb(t) as data from public.${table} t order by to_jsonb(t)::text`)).rows;
 return out;
};
const migrate=async()=>{try{await db.exec('begin;'+sql+'commit;');}catch(e){await db.exec('rollback;');throw e;}};
try{
 await db.exec('create schema auth;create schema ai_private;create table auth.users(id uuid primary key);');
 // Use the repository's actual relational tables, checks and foreign keys.
 const relational=await fs.readFile('database/relational-training.sql','utf8');await db.exec(relational.split('\n').slice(0,20).join('\n'));
 await db.exec(`create table ai_private.queue_settings(singleton boolean,enabled boolean);create table ai_private.weekly_settings(singleton boolean,enabled boolean);insert into ai_private.queue_settings values(true,true);insert into ai_private.weekly_settings values(true,true);create table public.ai_generation_jobs(id text primary key,user_id uuid,profile jsonb,result jsonb,context jsonb,status text);insert into auth.users values('${A}'),('${B}');insert into public.training_sync_state(user_id,cursor,initialized) values('${A}',7,true),('${B}',3,true);`);
 for(const [id,p,user] of [['ai-legacy',legacy,A],['ai-canonical',canonical,A],['ai-distance',distance,B]])await db.query(`insert into public.training_plans(user_id,id,revision,sync_version,profile,plan,generated_at,model,adopted) values($1,$2,1,1,$3,'{}','2026-11-03T12:00:00Z','test',true)`,[user,id,p]);
 await db.query(`insert into public.runner_profiles(user_id,id,revision,sync_version,draft,form_profile,suggestion_id) values($1,'profile',4,7,$2,$2,'ai-legacy')`,[A,legacy]);
 await db.exec(`insert into public.training_preferences(user_id,id,revision,sync_version,active_plan_id,checklist) values('${A}','settings',1,1,'ai-legacy','{}');insert into public.training_sessions(user_id,id,revision,sync_version,plan_id,week,date,title,km,minutes,rpe,long_run,instructions) values('${A}','ai-legacy-w1s0',1,1,'ai-legacy',1,'2026-11-03','Rodagem',5,35,3,false,'Teste');insert into public.diary_entries(user_id,id,revision,sync_version,km,minutes,rpe,pain,notes,recorded_at,session_date) values('${A}','ai-legacy-w1s0',1,1,5,35,3,'none','Registro preservado','2026-11-03T12:00:00Z','2026-11-03');`);
 for(const [id,p,status] of [['initial',legacy,'queued'],['completed',legacy,'completed'],['canonical',canonical,'completed'],['distance',distance,'completed']])await db.query('insert into public.ai_generation_jobs values($1,$2,$3,$4,$5,$6)',[id,A,p,{profile:p,plan:{summary:'Histórico'}},{profile:p,sourcePlanId:'ai-legacy'},status]);
 const before=await snapshot();
 await assert.rejects(migrate(),/Pause AI\/weekly schedulers/);assert.deepEqual(await snapshot(),before);
 await db.exec('update ai_private.queue_settings set enabled=false;update ai_private.weekly_settings set enabled=false;');
 await db.exec("update public.ai_generation_jobs set status='processing' where id='initial';");
 await assert.rejects(migrate(),/Pause AI\/weekly schedulers/);
 await db.exec("update public.ai_generation_jobs set status='queued' where id='initial';");
 // Failure after an update must roll back all revisions/units atomically.
 await db.exec(`delete from public.training_sync_state where user_id='${A}';`);
 const missingState=await snapshot();await assert.rejects(migrate(),/Missing training sync state/);assert.deepEqual(await snapshot(),missingState);
 await db.exec(`insert into public.training_sync_state(user_id,cursor,initialized) values('${A}',7,true);`);
 await migrate();
 const after=await snapshot();
 const plan=(await db.query("select profile,revision,sync_version from public.training_plans where id='ai-legacy'")).rows[0];
 assert.deepEqual(plan.profile,canonical);assert.equal(plan.revision,2);assert.equal(plan.sync_version,8);
 const runner=(await db.query('select draft,form_profile,revision from public.runner_profiles')).rows[0];assert.deepEqual(runner.draft,canonical);assert.deepEqual(runner.form_profile,canonical);assert.equal(runner.revision,5);
 for(const j of (await db.query("select * from public.ai_generation_jobs where id in ('initial','completed')")).rows){assert.deepEqual(j.profile,canonical);assert.deepEqual(j.result.profile,canonical);assert.deepEqual(j.context.profile,canonical);}
 for(const table of ['training_sessions','diary_entries','training_preferences'])assert.deepEqual(after[table],before[table]);
 const unchanged=(data,id)=>data.training_plans.find(x=>x.data.id===id);
 assert.deepEqual(unchanged(after,'ai-canonical'),unchanged(before,'ai-canonical'));assert.deepEqual(unchanged(after,'ai-distance'),unchanged(before,'ai-distance'));
 await migrate();assert.deepEqual(await snapshot(),after,'Repeated migration cannot multiply distances or increment revisions');
 console.log('PASS: PostgreSQL local: migração real, transação/reversão, guarda de fila, 134,112 km, sincronização, tarefas antigas, FKs e diário preservados, idempotência.');
}finally{await db.close();}
