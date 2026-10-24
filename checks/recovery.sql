-- Transactional fixtures only: no real users, dispatches, Gemini calls or committed records.
begin;
do $test$
declare uid uuid:=gen_random_uuid(); other_uid uuid:=gen_random_uuid(); today date:=(now() at time zone 'America/Sao_Paulo')::date; mutation uuid:=gen_random_uuid(); report jsonb:='{"fatigue":2,"sleep":4,"readiness":4,"pain":"none","illness":false,"painLocation":"","notes":"Dia de descanso","activity":{"type":"none","minutes":0,"rpe":null}}'; row jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(uid,uid||'@example.test',now()),(other_uid,other_uid||'@example.test',now());
 perform set_config('request.jwt.claim.sub',uid::text,true);
 row:=public.save_daily_recovery(today,report,0,mutation);assert row->>'revision'='1';assert not(row?'user_id');
 row:=public.save_daily_recovery(today,report,0,mutation);assert row->>'revision'='1','Lost acknowledgement must not insert/update twice';
 begin perform public.save_daily_recovery(today,report,0,gen_random_uuid());raise exception 'Conflict not caught';exception when serialization_failure then null;end;
 begin perform public.save_daily_recovery(today+1,report,0,gen_random_uuid());raise exception 'Future day not caught';exception when invalid_parameter_value then null;end;
 begin perform public.save_daily_recovery(today,report||'{"sleep":0}',1,gen_random_uuid());raise exception 'Scale not caught';exception when invalid_parameter_value then null;end;
 row:=public.save_daily_recovery(today,report||'{"pain":"mild"}',1,gen_random_uuid());assert row->>'revision'='2';assert ai_private.recovery_alert(uid);
 execute 'set local role authenticated';
 row:=public.save_daily_recovery(today,report||'{"pain":"mild"}',2,gen_random_uuid());assert row->>'revision'='3','Authenticated RPC save must work without direct table write';
 assert jsonb_array_length(public.read_daily_recovery())=1,'Owner should see only their record';
 begin insert into public.daily_recovery(user_id,day,fatigue,sleep,readiness,pain,illness,activity_type,activity_minutes,last_mutation) values(uid,today-1,2,4,4,'none',false,'none',0,gen_random_uuid());raise exception 'Direct write allowed';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',other_uid::text,true);
 assert jsonb_array_length(public.read_daily_recovery())=0,'Cross-account read leaked a record';
 assert (select count(*)=0 from public.daily_recovery where user_id=uid),'RLS must protect direct REST/table reads';
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',uid::text,true);
 row:=public.save_daily_recovery(today,report,3,gen_random_uuid());assert not ai_private.recovery_alert(uid),'A new current report supersedes earlier symptoms';
 begin perform ai_private.claim_ai_generation_recovery(repeat('0',64),'test');raise exception 'Invalid runner accepted';exception when insufficient_privilege then null;end;
end $test$;
rollback;
