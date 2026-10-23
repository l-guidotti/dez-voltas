-- Integration assertions in a rollback-only transaction: no Gemini calls, no real account changes.
begin;
do $$
declare
 uid uuid:=gen_random_uuid(); other_uid uuid:=gen_random_uuid(); req uuid:=gen_random_uuid();
 p jsonb:='{"consent":true,"pain":"none"}'; j jsonb; claimed jsonb; key text; answer boolean; i integer;
begin
 insert into auth.users(id,email,email_confirmed_at) values(uid,'queue-check-'||uid||'@example.invalid',now()),(other_uid,'queue-check-'||other_uid||'@example.invalid',now());
 perform set_config('request.jwt.claim.sub',uid::text,true);
 update ai_private.queue_settings set enabled=true,daily_attempts=20;
 select decrypted_secret into key from vault.decrypted_secrets where name='dez_voltas_ai_dispatch';
 j:=public.enqueue_ai_generation(p,req);
 assert j->>'status'='queued';
 assert public.enqueue_ai_generation(p,req)->>'id'=j->>'id','Idempotent enqueue';
 assert public.enqueue_ai_generation(p,gen_random_uuid())->>'id'=j->>'id','One active job per account';
 begin
  perform public.claim_ai_generation(repeat('0',64),'test');raise exception 'Unauthenticated runner accepted';
 exception when insufficient_privilege then null;end;
 claimed:=public.claim_ai_generation(key,'test');assert claimed->>'id'=j->>'id';
 assert (select attempts=1 and status='processing' from public.ai_generation_jobs where id=(j->>'id')::uuid);
 answer:=public.finish_ai_generation(key,(j->>'id')::uuid,gen_random_uuid(),null,'bad',true);assert not answer,'Wrong lease rejected';
 answer:=public.finish_ai_generation(key,(j->>'id')::uuid,(claimed->>'lease')::uuid,null,'Temporary error',true);assert answer;
 assert (select status='retrying' and attempts=1 from public.ai_generation_jobs where id=(j->>'id')::uuid);
 update public.ai_generation_jobs set next_attempt_at=now() where id=(j->>'id')::uuid;
 claimed:=public.claim_ai_generation(key,'test');assert (claimed->>'attempts')::int=2;
 answer:=public.finish_ai_generation(key,(j->>'id')::uuid,(claimed->>'lease')::uuid,jsonb_build_object('profile',p,'plan',jsonb_build_object('test',true)),null,false,100,200);assert answer;
 assert (select status='completed' and input_tokens=100 and output_tokens=200 from public.ai_generation_jobs where id=(j->>'id')::uuid);
 answer:=public.finish_ai_generation(key,(j->>'id')::uuid,(claimed->>'lease')::uuid,null,'Duplicate ack',true);assert not answer;
 -- Every admitted request counts, including validation/provider failures.
 for i in 2..5 loop
  j:=public.enqueue_ai_generation(p,gen_random_uuid());
  update public.ai_generation_jobs set status='failed' where id=(j->>'id')::uuid;
 end loop;
 begin
  perform public.enqueue_ai_generation(p,gen_random_uuid());raise exception 'Daily quota bypass';
 exception when raise_exception then if sqlerrm<>'USER_DAILY_LIMIT' then raise;end if;end;
 -- Global budget, recovery, and final-attempt exhaustion.
 perform set_config('request.jwt.claim.sub',other_uid::text,true);
 j:=public.enqueue_ai_generation(p,gen_random_uuid());
 update ai_private.queue_settings set daily_attempts=2;
 assert public.claim_ai_generation(key,'test') is null;
 assert (select next_attempt_at>now() and error is not null from public.ai_generation_jobs where id=(j->>'id')::uuid);
 update ai_private.queue_settings set daily_attempts=20;
 update public.ai_generation_jobs set next_attempt_at=now() where id=(j->>'id')::uuid;
 claimed:=public.claim_ai_generation(key,'test');
 update public.ai_generation_jobs set lease_until=now()-interval '1 second' where id=(j->>'id')::uuid;
 claimed:=public.claim_ai_generation(key,'test');assert (claimed->>'attempts')::int=2;
 perform public.finish_ai_generation(key,(j->>'id')::uuid,(claimed->>'lease')::uuid,null,'Temporary error',true);
 assert (select status='failed' and attempts=2 from public.ai_generation_jobs where id=(j->>'id')::uuid);
 -- SELECT is available with RLS, financial settings/transport/result writes are not.
 assert not has_table_privilege('authenticated','ai_private.queue_settings','update');
 assert not has_table_privilege('authenticated','public.ai_generation_jobs','update');
 assert not has_column_privilege('authenticated','public.ai_generation_jobs','lease','select');
end $$;
set local role authenticated;
do $$ begin
 assert (select count(*)=1 from public.ai_generation_jobs), 'RLS must hide other accounts';
 assert (select bool_and(user_id=auth.uid()) from public.ai_generation_jobs);
end $$;
reset role;
do $$
declare uid uuid; i integer; key text; first_claim jsonb;
begin
 select decrypted_secret into key from vault.decrypted_secrets where name='dez_voltas_ai_dispatch';
 update ai_private.queue_settings set enabled=true,daily_attempts=20,concurrency=2;
 for i in 1..3 loop
  uid:=gen_random_uuid();
  insert into auth.users(id,email,email_confirmed_at) values(uid,'queue-concurrency-'||uid||'@example.invalid',now());
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform public.enqueue_ai_generation('{"consent":true,"pain":"none"}',gen_random_uuid());
 end loop;
 first_claim:=public.claim_ai_generation(key,'test');assert first_claim is not null;
 assert public.claim_ai_generation(key,'test') is not null;
 assert public.claim_ai_generation(key,'test') is null,'Concurrency ceiling must stop a third worker';
 assert (select count(*)=2 from public.ai_generation_jobs where status='processing');
 perform public.finish_ai_generation(key,(first_claim->>'id')::uuid,(first_claim->>'lease')::uuid,null,'Permanent failure',false);
 assert public.claim_ai_generation(key,'test') is not null,'Releasing a slot must allow the next job';
end $$;
rollback;
