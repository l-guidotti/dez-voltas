-- Rollback fixtures only. No dispatch or delivery to real subscriptions.
begin;
do $$
declare u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); today date:=(now() at time zone 'America/Sao_Paulo')::date; local_time text:=to_char(now() at time zone 'UTC','HH24:MI'); subscription jsonb; prefs jsonb; p jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@example.test',now()),(other_u,other_u||'@example.test',now());
 update ai_private.push_settings set enabled=true,public_key=repeat('A',87),private_key_id=gen_random_uuid();
 subscription:=jsonb_build_object('endpoint','https://web.push.apple.com/test-'||d,'keys',jsonb_build_object('p256dh',repeat('A',87),'auth',repeat('A',22)));
 prefs:=jsonb_build_object('training',true,'diary',true,'trainingTime',local_time,'diaryTime',local_time,'timeZone','UTC');
 perform set_config('request.jwt.claim.sub',u::text,true);
 execute 'set local role authenticated';
 perform public.save_push_device(d,subscription,prefs);
 assert public.read_push_device(d)->>'id'=d::text;
 assert not has_column_privilege('authenticated','public.push_devices','auth','select');
 assert not has_table_privilege('authenticated','public.push_devices','update');
 perform set_config('request.jwt.claim.sub',other_u::text,true);
 assert public.read_push_device(d) is null;
 assert not public.remove_push_device(d);
 begin perform public.save_push_device(d,subscription,prefs);raise exception 'Foreign owner accepted';exception when insufficient_privilege then null;end;
 execute 'reset role';perform set_config('request.jwt.claim.sub',u::text,true);
 update public.push_devices set updated_at=now()-interval '1 day' where id=d;
 p:=jsonb_build_object('goal','distance','target',21,'startDate',today,'targetDate',today+90);
 insert into public.training_plans(user_id,id,revision,sync_version,profile,plan,generated_at,model,adopted) values(u,'ai-push-test',1,1,p,'{}',now()::text,'test',true);
 insert into public.training_preferences(user_id,id,revision,sync_version,active_plan_id,checklist) values(u,'settings',1,1,'ai-push-test','{}');
 insert into public.training_sessions(user_id,id,revision,sync_version,plan_id,week,date,title,km,minutes,rpe,long_run,instructions) values(u,'push-session',1,1,'ai-push-test',1,today,'Teste',5,30,3,false,'');
 perform ai_private.enqueue_push_reminders();perform ai_private.enqueue_push_reminders();
 assert (select count(*)=2 from ai_private.push_deliveries where device_id=d),'One reminder per kind/day';
 delete from ai_private.push_deliveries where device_id=d;
 insert into public.diary_entries(user_id,id,revision,sync_version,km,minutes,rpe,pain,notes,recorded_at,session_date) values(u,'push-session',1,1,5,30,3,'none','',now()::text,today);
 insert into public.daily_recovery(user_id,day,fatigue,sleep,readiness,pain,illness,activity_type,activity_minutes,last_mutation) values(u,today,2,4,4,'none',false,'none',0,gen_random_uuid());
 perform ai_private.enqueue_push_reminders();assert not exists(select 1 from ai_private.push_deliveries where device_id=d),'Completed records suppress reminders';
 delete from public.diary_entries where user_id=u;update public.daily_recovery set pain='mild' where user_id=u;
 perform ai_private.enqueue_push_reminders();assert not exists(select 1 from ai_private.push_deliveries where device_id=d),'Symptoms suppress workout prompts';
 perform public.remove_push_device(d);assert not exists(select 1 from public.push_devices where id=d);
end $$;
rollback;
