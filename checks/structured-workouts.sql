begin;
do $$
declare uid uuid:=gen_random_uuid(); result jsonb; s jsonb; changes jsonb; workout jsonb:='{"type":"interval","purpose":"Persistência de teste","blocks":[]}'::jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(uid,'structured-test-'||uid||'@example.invalid',now());
 insert into public.training_sync_state(user_id,initialized) values(uid,true);
 perform set_config('request.jwt.claim.sub',uid::text,true);
 s:=jsonb_build_object('plan_id','ai-structured-test','week',1,'date','2026-10-01','title','Intervalado de teste','km',5,'minutes',31,'rpe',5,'long_run',false,'instructions','Fixture temporária','workout',workout);
 changes:=jsonb_build_array(jsonb_build_object('kind','plans','id','ai-structured-test','revision',0,'data',jsonb_build_object('profile','{}'::jsonb,'plan','{}'::jsonb,'generated_at',now()::text,'model','test','adopted',true)),jsonb_build_object('kind','sessions','id','structured-session','revision',0,'data',s));
 perform public.apply_training_changes(changes);
 assert (select t.workout->>'type'='interval' from public.training_sessions t where user_id=uid and id='structured-session');
 s:=s||jsonb_build_object('workout',workout||'{"purpose":"Atualização persistida"}'::jsonb);
 perform public.apply_training_changes(jsonb_build_array(jsonb_build_object('kind','sessions','id','structured-session','revision',1,'data',s)));
 assert (select t.workout->>'purpose'='Atualização persistida' from public.training_sessions t where user_id=uid and id='structured-session');
 perform public.apply_training_changes(jsonb_build_array(jsonb_build_object('kind','sessions','id','legacy-session','revision',0,'data',s-'workout')));
 result:=public.read_training_store(0);
 assert (select e#>>'{data,workout,type}'='interval' from jsonb_array_elements(result->'rows') e where e->>'id'='structured-session');
 assert (select not (e->'data'?'workout') from jsonb_array_elements(result->'rows') e where e->>'id'='legacy-session'),'Null workout must not alter legacy hashes';
end $$;
rollback;
