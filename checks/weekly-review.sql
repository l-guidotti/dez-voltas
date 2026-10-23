-- Rollback-only integration. Must run with no existing jobs awaiting processing.
begin;
do $$
declare uid uuid:=gen_random_uuid(); other_uid uuid:=gen_random_uuid(); today date:=(now() at time zone 'America/Sao_Paulo')::date;
 p jsonb; c jsonb; state jsonb; claimed jsonb; key text; report jsonb:='{"fatigue":2,"sleep":4,"readiness":4,"pain":"none","illness":false,"complete":true,"consent":false,"days":[0,2,4],"maxMinutes":60,"longMinutes":90,"notes":"Revisão de teste"}';
begin
 assert not exists(select 1 from public.ai_generation_jobs where status in ('queued','processing','retrying')),'Run with an idle queue';
 insert into auth.users(id,email,email_confirmed_at) values(uid,'weekly-check-'||uid||'@example.invalid',now()),(other_uid,'weekly-check-'||other_uid||'@example.invalid',now());
 p:=jsonb_build_object('goal','distance','target',21,'startDate',today-7,'targetDate',today+90,'weeklyKm',20,'longestKm',8,'weeksConsistent',8,'days',jsonb_build_array(0,2,4),'maxMinutes',60,'longMinutes',90,'pain','none','consent',true);
 insert into public.training_plans(user_id,id,revision,sync_version,profile,plan,generated_at,model,adopted) values(uid,'ai-weekly-test',1,1,p,'{}',now()::text,'test',true),(other_uid,'ai-weekly-other',1,1,p,'{}',now()::text,'test',true);
 insert into public.training_preferences(user_id,id,revision,sync_version,active_plan_id,checklist) values(uid,'settings',1,1,'ai-weekly-test','{}'),(other_uid,'settings',1,1,'ai-weekly-other','{}');
 insert into public.training_sessions(user_id,id,revision,sync_version,plan_id,week,date,title,km,minutes,rpe,long_run,instructions) values(uid,'weekly-session-1',1,1,'ai-weekly-test',1,today-3,'Corrida',5,35,3,false,'Teste');
 insert into public.diary_entries(user_id,id,revision,sync_version,km,minutes,rpe,pain,notes,recorded_at,session_date) values(uid,'weekly-session-1',1,1,5,35,3,'none','Registro próprio',now()::text,today-3);
 perform set_config('request.jwt.claim.sub',uid::text,true);
 state:=public.read_weekly_review();assert state->>'planId'='ai-weekly-test';assert state->>'weekStart'=(today-7)::text;assert state#>>'{stats,registered}'='1';
 c:=public.save_weekly_review('ai-weekly-test',today-7,report,0);assert c->>'revision'='1';
 update ai_private.weekly_settings set enabled=true;update ai_private.queue_settings set enabled=true;
 perform ai_private.enqueue_weekly_reviews();assert not exists(select 1 from public.ai_generation_jobs where user_id=uid),'No consent means no queue';
 begin perform public.save_weekly_review('ai-weekly-test',today-7,report,0);raise exception 'Conflict not detected';exception when serialization_failure then null;end;
 report:=report||'{"consent":true}';c:=public.save_weekly_review('ai-weekly-test',today-7,report,1);
 perform ai_private.enqueue_weekly_reviews();
 assert (select count(*)=1 from public.ai_generation_jobs where user_id=uid and kind='weekly_review');
 assert (select job_id is not null from public.weekly_checkins where user_id=uid);
 assert (select context#>>'{logs,0,notes}'='Registro próprio' from public.ai_generation_jobs where user_id=uid),'Diary is snapshotted from the database';
 perform ai_private.enqueue_weekly_reviews();assert (select count(*)=1 from public.ai_generation_jobs where user_id=uid),'One review per plan/week';
 begin perform public.save_weekly_review('ai-weekly-test',today-7,report,2);raise exception 'Frozen checkin accepted';exception when raise_exception then if sqlerrm<>'CHECKIN_QUEUED' then raise;end if;end;
 select decrypted_secret into key from vault.decrypted_secrets where name='dez_voltas_ai_dispatch';
 claimed:=public.claim_ai_generation(key,'test');assert claimed->>'kind'='weekly_review';assert claimed#>>'{context,sourcePlanId}'='ai-weekly-test';
 assert public.finish_ai_generation(key,(claimed->>'id')::uuid,(claimed->>'lease')::uuid,jsonb_build_object('profile',p||jsonb_build_object('startDate',today,'review',jsonb_build_object('sourcePlanId','ai-weekly-test')),'plan','{}'::jsonb));
 perform set_config('request.jwt.claim.sub',other_uid::text,true);
 state:=public.read_weekly_review();assert state->>'planId'='ai-weekly-other';assert state#>>'{stats,registered}'='0';assert jsonb_array_length(state->'history')=0;
 assert not has_table_privilege('authenticated','public.weekly_checkins','update');
end $$;
set local role authenticated;
do $$ begin assert (select count(*)=0 from public.weekly_checkins),'RLS hides other account checkins';end $$;
reset role;
delete from auth.users where email like 'weekly-check-%@example.invalid';
rollback;
