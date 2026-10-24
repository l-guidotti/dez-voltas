-- Run after activation. Rollback only: no dispatch, provider calls or runner secret access.
begin;
do $test$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); today date:=(now() at time zone 'America/Sao_Paulo')::date; p jsonb; r jsonb:='{"fatigue":2,"sleep":4,"readiness":4,"pain":"none","illness":false,"complete":true,"consent":true,"days":[0,2,4],"maxMinutes":60,"longMinutes":90,"notes":"Teste semanal"}'; uid uuid; plan_id text;
begin
 insert into auth.users(id,email,email_confirmed_at) values(a,a||'@example.test',now()),(b,b||'@example.test',now());
 p:=jsonb_build_object('goal','distance','target',21,'startDate',today-7,'targetDate',today+90,'weeklyKm',20,'longestKm',8,'weeksConsistent',8,'days',jsonb_build_array(0,2,4),'maxMinutes',60,'longMinutes',90,'pain','none','consent',true);
 foreach uid in array array[a,b] loop
  plan_id:='ai-daily-'||uid::text;
  insert into public.training_plans(user_id,id,revision,sync_version,profile,plan,generated_at,model,adopted) values(uid,plan_id,1,1,p,'{}',now()::text,'test',true);
  insert into public.training_preferences(user_id,id,revision,sync_version,active_plan_id,checklist) values(uid,'settings',1,1,plan_id,'{}');
  insert into public.daily_recovery(user_id,day,fatigue,sleep,readiness,pain,illness,notes,activity_type,activity_minutes,last_mutation) values(uid,today-2,2,4,4,'none',false,case when uid=b then 'Registro do titular B' else 'Privado sem consentimento A' end,'none',0,gen_random_uuid());
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform public.save_weekly_review(plan_id,today-7,case when uid=b then r||'{"recoveryConsent":true}' else r end,0);
 end loop;
 update ai_private.weekly_settings set enabled=true;update ai_private.queue_settings set enabled=true;
 perform ai_private.enqueue_weekly_reviews();
 assert (select count(*)=2 from public.ai_generation_jobs where user_id in(a,b) and kind='weekly_review');
 assert (select context->>'dailyRecoveryConsent'='false' and jsonb_array_length(context->'dailyRecovery')=0 from public.ai_generation_jobs where user_id=a),'Old consent must not send daily data';
 assert (select context->>'dailyRecoveryConsent'='true' and jsonb_array_length(context->'dailyRecovery')=1 from public.ai_generation_jobs where user_id=b);
 assert (select context#>>'{dailyRecovery,0,notes}'='Registro do titular B' from public.ai_generation_jobs where user_id=b),'Only owner daily records may enter the snapshot';
 assert (select not(context::text like '%Privado sem consentimento A%') from public.ai_generation_jobs where user_id=b),'Another account must never enter the context';
end $test$;
rollback;
