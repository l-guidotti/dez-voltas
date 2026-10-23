-- Durable AI jobs. Apply through the Supabase migration tool, then enable the dispatcher.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create schema if not exists ai_private;
revoke all on schema ai_private from public, anon, authenticated;

create table public.ai_generation_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 profile jsonb not null check (octet_length(profile::text)<=12000),
 status text not null default 'queued' check(status in ('queued','processing','retrying','completed','failed')),
 attempts integer not null default 0 check(attempts between 0 and 2),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 next_attempt_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz,
 lease uuid, lease_until timestamptz,
 result jsonb check(octet_length(result::text)<=180000), error text,
 model text, input_tokens bigint not null default 0, output_tokens bigint not null default 0,
 unique(user_id,request_id)
);
alter table public.ai_generation_jobs enable row level security;
revoke all on public.ai_generation_jobs from anon, authenticated;
grant select(id,user_id,request_id,status,attempts,created_at,updated_at,next_attempt_at,started_at,finished_at,result,error,model) on public.ai_generation_jobs to authenticated;
create policy own_ai_jobs on public.ai_generation_jobs for select to authenticated using ((select auth.uid())=user_id);
create unique index ai_jobs_one_active on public.ai_generation_jobs(user_id) where status in ('queued','processing','retrying');
create index ai_jobs_owner_history on public.ai_generation_jobs(user_id,created_at desc);
create index ai_jobs_pending on public.ai_generation_jobs(next_attempt_at,created_at) where status in ('queued','retrying');
create index ai_jobs_leases on public.ai_generation_jobs(lease_until) where status='processing';

create table ai_private.queue_settings (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 daily_user_jobs integer not null default 5 check(daily_user_jobs between 1 and 20),
 daily_attempts integer not null default 20 check(daily_attempts between 1 and 1000),
 concurrency integer not null default 2 check(concurrency between 1 and 4)
);
insert into ai_private.queue_settings(singleton) values(true);
create table ai_private.daily_usage(day date primary key,attempts integer not null default 0,input_tokens bigint not null default 0,output_tokens bigint not null default 0);
alter table ai_private.queue_settings enable row level security;
alter table ai_private.daily_usage enable row level security;
revoke all on all tables in schema ai_private from public,anon,authenticated;

-- The capability stays in Vault. Neither the browser nor GitHub receives it.
do $$ begin
 if not exists(select 1 from vault.secrets where name='dez_voltas_ai_dispatch') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'dez_voltas_ai_dispatch','Internal AI queue dispatcher capability');
 end if;
end $$;
create function ai_private.authorize_runner(runner_key text) returns void language plpgsql security definer set search_path='' as $$
begin
 if runner_key is null or length(runner_key)<>64 or not exists(
  select 1 from vault.decrypted_secrets where name='dez_voltas_ai_dispatch'
  and extensions.digest(decrypted_secret,'sha256')=extensions.digest(runner_key,'sha256')
 ) then raise exception 'Unauthorized runner' using errcode='42501'; end if;
end $$;
revoke all on function ai_private.authorize_runner(text) from public,anon,authenticated;

create function public.enqueue_ai_generation(job_profile jsonb,client_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); j public.ai_generation_jobs; cfg ai_private.queue_settings; n integer;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into cfg from ai_private.queue_settings where singleton for update;
 if not cfg.enabled then raise exception 'QUEUE_PAUSED' using errcode='P0001'; end if;
 select * into j from public.ai_generation_jobs where user_id=uid and request_id=client_request_id;
 if found then return jsonb_build_object('id',j.id,'status',j.status,'attempts',j.attempts); end if;
 select * into j from public.ai_generation_jobs where user_id=uid and status in ('queued','processing','retrying');
 if found then return jsonb_build_object('id',j.id,'status',j.status,'attempts',j.attempts); end if;
 if client_request_id is null or job_profile is null or jsonb_typeof(job_profile)<>'object' or octet_length(job_profile::text)>12000
  or job_profile->>'consent' is distinct from 'true' or job_profile->>'pain' is distinct from 'none'
  or (job_profile ? 'details' and job_profile#>>'{details,registrationCompleted}' is distinct from 'true') then
  raise exception 'Invalid profile' using errcode='22023';
 end if;
 select count(*) into n from public.ai_generation_jobs where user_id=uid and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if n>=cfg.daily_user_jobs then raise exception 'USER_DAILY_LIMIT' using errcode='P0001'; end if;
 if (select count(*) from public.ai_generation_jobs where status in ('queued','processing','retrying'))>=100 then raise exception 'QUEUE_FULL' using errcode='P0001'; end if;
 insert into public.ai_generation_jobs(user_id,request_id,profile) values(uid,client_request_id,job_profile) returning * into j;
 return jsonb_build_object('id',j.id,'status',j.status,'attempts',j.attempts);
end $$;
revoke all on function public.enqueue_ai_generation(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_ai_generation(jsonb,uuid) to authenticated;

create function public.claim_ai_generation(runner_key text,worker_model text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg ai_private.queue_settings; j public.ai_generation_jobs; used integer; today date:=(now() at time zone 'UTC')::date;
begin
 perform ai_private.authorize_runner(runner_key);
 select * into cfg from ai_private.queue_settings where singleton for update;
 if not cfg.enabled then return null; end if;
 update public.ai_generation_jobs set status=case when attempts>=2 then 'failed' else 'retrying' end,
  error=case when attempts>=2 then 'O processamento foi interrompido duas vezes. Seu plano anterior foi preservado.' else 'O processamento foi interrompido. Uma nova tentativa será feita automaticamente.' end,
  updated_at=now(),next_attempt_at=now(),lease=null,lease_until=null,
  finished_at=case when attempts>=2 then now() else null end
 where status='processing' and lease_until<now();
 update public.ai_generation_jobs set status='failed',error='O tempo de espera expirou. Atualize as datas do cadastro e solicite novamente.',updated_at=now(),finished_at=now() where status in ('queued','retrying') and created_at<now()-interval '2 days';
 if (select count(*) from public.ai_generation_jobs where status='processing')>=cfg.concurrency then return null; end if;
 insert into ai_private.daily_usage(day) values(today) on conflict do nothing;
 select attempts into used from ai_private.daily_usage where day=today for update;
 if used>=cfg.daily_attempts then
  update public.ai_generation_jobs set error='Aguardando a renovação do limite diário de geração.',next_attempt_at=(today+1)::timestamp at time zone 'UTC',updated_at=now()
  where status in ('queued','retrying') and next_attempt_at<=now();
  return null;
 end if;
 select * into j from public.ai_generation_jobs where status in ('queued','retrying') and next_attempt_at<=now() order by next_attempt_at,created_at limit 1 for update skip locked;
 if not found then return null; end if;
 update public.ai_generation_jobs set status='processing',attempts=attempts+1,started_at=now(),updated_at=now(),error=null,
  lease=gen_random_uuid(),lease_until=now()+interval '3 minutes',model=left(worker_model,100) where id=j.id returning * into j;
 update ai_private.daily_usage set attempts=attempts+1 where day=today;
 return jsonb_build_object('id',j.id,'lease',j.lease,'profile',j.profile,'attempts',j.attempts);
end $$;
revoke all on function public.claim_ai_generation(text,text) from public,anon,authenticated;
grant execute on function public.claim_ai_generation(text,text) to anon;

create function public.finish_ai_generation(runner_key text,job_id uuid,job_lease uuid,job_result jsonb default null,job_error text default null,retryable boolean default false,tokens_in bigint default 0,tokens_out bigint default 0) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.ai_generation_jobs;
begin
 perform ai_private.authorize_runner(runner_key);
 select * into j from public.ai_generation_jobs where id=job_id for update;
 if not found or j.status<>'processing' or j.lease is distinct from job_lease or j.lease_until<now() then return false; end if;
 if job_result is not null and (jsonb_typeof(job_result)<>'object' or job_result->'profile' is distinct from j.profile or not job_result ? 'plan') then raise exception 'Invalid result' using errcode='22023'; end if;
 update public.ai_generation_jobs set status=case when job_result is not null then 'completed' when retryable and attempts<2 then 'retrying' else 'failed' end,
  result=job_result,error=case when job_result is not null then null else left(coalesce(job_error,'Não foi possível concluir a geração. Seu plano anterior foi preservado.'),800) end,
  next_attempt_at=now()+interval '2 minutes',updated_at=now(),
  finished_at=case when job_result is not null or not retryable or attempts>=2 then now() else null end,
  input_tokens=input_tokens+greatest(0,coalesce(tokens_in,0)),output_tokens=output_tokens+greatest(0,coalesce(tokens_out,0)),lease=null,lease_until=null where id=job_id;
 update ai_private.daily_usage set input_tokens=input_tokens+greatest(0,coalesce(tokens_in,0)),output_tokens=output_tokens+greatest(0,coalesce(tokens_out,0)) where day=(j.started_at at time zone 'UTC')::date;
 return true;
end $$;
revoke all on function public.finish_ai_generation(text,uuid,uuid,jsonb,text,boolean,bigint,bigint) from public,anon,authenticated;
grant execute on function public.finish_ai_generation(text,uuid,uuid,jsonb,text,boolean,bigint,bigint) to anon;

create function ai_private.dispatch_generation() returns void language plpgsql security definer set search_path='' as $$
declare secret text; i integer; cfg ai_private.queue_settings;
begin
 select * into cfg from ai_private.queue_settings where singleton;
 if not cfg.enabled or not exists(select 1 from public.ai_generation_jobs where status in ('queued','retrying') and next_attempt_at<=now() or status='processing' and lease_until<now()) then return; end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='dez_voltas_ai_dispatch';
 for i in 1..cfg.concurrency loop
  perform net.http_post(url:='https://dez-voltas.pages.dev/api/internal/ai-runner',headers:=jsonb_build_object('Content-Type','application/json','x-dv-runner-key',secret),body:='{}'::jsonb,timeout_milliseconds:=90000);
 end loop;
end $$;
revoke all on function ai_private.dispatch_generation() from public,anon,authenticated;
-- Intentionally activated only after the consumer is deployed and verified.
select cron.schedule('dez-voltas-ai-queue','* * * * *','select ai_private.dispatch_generation()');
-- Keep net, vault and ai_private OUT of the Data API exposed schemas.
-- Supabase owns pg_net objects; their grants cannot be revoked by postgres.
