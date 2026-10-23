create table public.weekly_checkins (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 source_plan_id text not null,week_start date not null,week_end date not null check(week_end=week_start+6),
 report jsonb not null check(octet_length(report::text)<=4000),revision bigint not null default 1,
 job_id uuid references public.ai_generation_jobs(id) on delete set null,
 queue_error text,next_enqueue_at timestamptz not null default now(),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(user_id,source_plan_id,week_start),foreign key(user_id,source_plan_id) references public.training_plans(user_id,id)
);
alter table public.weekly_checkins enable row level security;
revoke all on public.weekly_checkins from public,anon,authenticated;
grant select on public.weekly_checkins to authenticated;
create policy own_weekly_checkins on public.weekly_checkins for select to authenticated using((select auth.uid())=user_id);
create index weekly_checkins_job on public.weekly_checkins(job_id) where job_id is not null;
create index weekly_checkins_history on public.weekly_checkins(user_id,week_end desc);
create index weekly_checkins_pending on public.weekly_checkins(next_enqueue_at,week_end) where job_id is null and queue_error is null;
alter table public.ai_generation_jobs add column kind text not null default 'initial' check(kind in ('initial','weekly_review')),
 add column context jsonb check(octet_length(context::text)<=120000),add column review_id uuid unique references public.weekly_checkins(id) on delete set null;
grant select(kind,review_id) on public.ai_generation_jobs to authenticated;
create table ai_private.weekly_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into ai_private.weekly_settings(singleton) values(true);
alter table ai_private.weekly_settings enable row level security;
revoke all on ai_private.weekly_settings from public,anon,authenticated;
create policy deny_direct_weekly_settings on ai_private.weekly_settings for all using(false) with check(false);

create function public.read_weekly_review() returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); p public.training_plans; today date:=(now() at time zone 'America/Sao_Paulo')::date; s date; e date; d integer; report jsonb; stats jsonb;
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select plans.* into p from public.training_preferences prefs join public.training_plans plans on plans.user_id=prefs.user_id and plans.id=prefs.active_plan_id
 where prefs.user_id=uid and not prefs.deleted and not plans.deleted and plans.adopted;
 if not found then return jsonb_build_object('planId',null);end if;
 d:=today-(p.profile->>'startDate')::date;
 s:=(p.profile->>'startDate')::date+7*greatest(0,floor(d/7.0)::integer-case when mod(d,7)<6 then 1 else 0 end);e:=s+6;
 select to_jsonb(c) into report from public.weekly_checkins c where c.user_id=uid and c.source_plan_id=p.id and c.week_start=s;
 select jsonb_build_object('registered',count(*),'km',coalesce(sum(km),0),'minutes',coalesce(sum(minutes),0),'pain',count(*) filter(where pain<>'none')) into stats
 from public.diary_entries where user_id=uid and not deleted and session_date between s and least(e,today);
 return jsonb_build_object('planId',p.id,'profile',p.profile,'weekStart',s,'weekEnd',e,'canSave',today>=e and today<(p.profile->>'targetDate')::date,'checkin',report,'stats',stats,
 'planned',(select count(*) from public.training_sessions where user_id=uid and plan_id=p.id and not deleted and date between s and e),
 'history',(select coalesce(jsonb_agg(x),'[]') from(select id,source_plan_id,week_start,week_end,job_id,queue_error from public.weekly_checkins where user_id=uid order by week_end desc limit 8)x));
end $$;
revoke all on function public.read_weekly_review() from public,anon,authenticated;
grant execute on function public.read_weekly_review() to authenticated;

create function ai_private.save_weekly_review(plan_id text,week_start_date date,report_data jsonb,expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); state jsonb; previous public.weekly_checkins; c public.weekly_checkins; n integer;
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501';end if;
 if expected_revision is null or expected_revision<0 then raise exception 'Invalid revision' using errcode='22023';end if;
 -- Serialize saves for this account and re-check the active plan under its row lock.
 perform 1 from public.training_preferences where user_id=uid for update;
 state:=public.read_weekly_review();
 if state->>'planId' is distinct from plan_id or state->>'weekStart' is distinct from week_start_date::text or state->>'canSave' is distinct from 'true' then raise exception 'WEEK_NOT_READY' using errcode='P0001';end if;
 if report_data is null or jsonb_typeof(report_data)<>'object' or octet_length(report_data::text)>4000 then raise exception 'Invalid checkin' using errcode='22023';end if;
 foreach n in array array[1,2,3] loop
  if coalesce(report_data->>(array['fatigue','sleep','readiness'])[n],'')!~'^[1-5]$' then raise exception 'Invalid recovery' using errcode='22023';end if;
 end loop;
 if coalesce(report_data->>'pain','') not in ('none','mild','stop') or jsonb_typeof(report_data->'illness') is distinct from 'boolean' or jsonb_typeof(report_data->'complete') is distinct from 'boolean' or jsonb_typeof(report_data->'consent') is distinct from 'boolean'
 or jsonb_typeof(report_data->'days') is distinct from 'array' or jsonb_array_length(report_data->'days')>6 or jsonb_typeof(report_data->'notes') is distinct from 'string' or length(report_data->>'notes')>1000
 or coalesce(report_data->>'maxMinutes','')!~'^[0-9]{2,3}$' or coalesce(report_data->>'longMinutes','')!~'^[0-9]{2,3}$' then raise exception 'Invalid availability' using errcode='22023';end if;
 if (report_data->>'maxMinutes')::int not between 20 and 360 or (report_data->>'longMinutes')::int not between 20 and 600 then raise exception 'Invalid minutes' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(report_data->'days') x where x::text!~'^[0-6]$') or (select count(distinct x) from jsonb_array_elements(report_data->'days') x)<>jsonb_array_length(report_data->'days') then raise exception 'Invalid days' using errcode='22023';end if;
 select * into previous from public.weekly_checkins where user_id=uid and source_plan_id=plan_id and week_start=week_start_date for update;
 if found then
  if previous.revision<>expected_revision then raise exception 'CHECKIN_CONFLICT' using errcode='40001';end if;
  if previous.job_id is not null then raise exception 'CHECKIN_QUEUED' using errcode='P0001';end if;
  update public.weekly_checkins set report=report_data,revision=revision+1,updated_at=now(),queue_error=null,next_enqueue_at=now() where id=previous.id returning * into c;
 else
  if expected_revision<>0 then raise exception 'CHECKIN_CONFLICT' using errcode='40001';end if;
  insert into public.weekly_checkins(user_id,source_plan_id,week_start,week_end,report) values(uid,plan_id,week_start_date,week_start_date+6,report_data) returning * into c;
 end if;
 return to_jsonb(c);
end $$;
revoke all on function ai_private.save_weekly_review(text,date,jsonb,bigint) from public,anon,authenticated;
grant execute on function ai_private.save_weekly_review(text,date,jsonb,bigint) to authenticated;
create function public.save_weekly_review(plan_id text,week_start_date date,report_data jsonb,expected_revision bigint) returns jsonb language sql security invoker set search_path='' as $$ select ai_private.save_weekly_review(plan_id,week_start_date,report_data,expected_revision) $$;
revoke all on function public.save_weekly_review(text,date,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.save_weekly_review(text,date,jsonb,bigint) to authenticated;

create function ai_private.enqueue_weekly_reviews() returns void language plpgsql security definer set search_path='' as $$
declare c public.weekly_checkins; j jsonb; p jsonb; ctx jsonb; prior_uid text:=current_setting('request.jwt.claim.sub',true); today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if not (select enabled from ai_private.weekly_settings where singleton) or not (select enabled from ai_private.queue_settings where singleton) then return;end if;
 for c in select * from public.weekly_checkins where job_id is null and queue_error is null and report->>'consent'='true' and week_end<today and next_enqueue_at<=now() order by week_end,created_at limit 20 for update skip locked loop
  if today>c.week_end+7 or not exists(select 1 from public.training_preferences where user_id=c.user_id and active_plan_id=c.source_plan_id and not deleted) then
   update public.weekly_checkins set queue_error='A semana expirou ou o plano em uso mudou. Faça o fechamento da semana atual.',updated_at=now() where id=c.id;continue;
  end if;
  select profile into p from public.training_plans where user_id=c.user_id and id=c.source_plan_id and not deleted and adopted;
  if p is null then continue;end if;
  ctx:=jsonb_build_object('sourcePlanId',c.source_plan_id,'weekStart',c.week_start,'weekEnd',c.week_end,'checkin',c.report,'profile',p,
   'currentPain',(select coalesce(draft->>'pain','none') from public.runner_profiles where user_id=c.user_id and not deleted),
   'previousCheckin',(select report from public.weekly_checkins where user_id=c.user_id and week_end=c.week_start-1 order by updated_at desc limit 1),
   'planned',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'date',date,'km',km,'minutes',minutes,'rpe',rpe)),'[]') from public.training_sessions where user_id=c.user_id and plan_id=c.source_plan_id and not deleted and date between c.week_start and c.week_end),
   'logs',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'date',session_date,'km',km,'minutes',minutes,'rpe',rpe,'pain',pain,'notes',case when session_date>=c.week_start then notes else '' end)),'[]') from public.diary_entries where user_id=c.user_id and not deleted and session_date between c.week_end-27 and c.week_end));
  if octet_length(ctx::text)>120000 then update public.weekly_checkins set queue_error='O histórico excedeu o tamanho de revisão. Revise os registros da semana.',updated_at=now() where id=c.id;continue;end if;
  perform set_config('request.jwt.claim.sub',c.user_id::text,true);
  begin
   -- Existing admission is reused: same atomic account/global backlog limits and idempotence.
   j:=ai_private.enqueue_ai_generation(p,c.id);
   if exists(select 1 from public.ai_generation_jobs where id=(j->>'id')::uuid and user_id=c.user_id and request_id=c.id) then
    update public.ai_generation_jobs set kind='weekly_review',context=ctx,review_id=c.id where id=(j->>'id')::uuid;
    update public.weekly_checkins set job_id=(j->>'id')::uuid,updated_at=now() where id=c.id;
   else update public.weekly_checkins set next_enqueue_at=now()+interval '10 minutes' where id=c.id;end if;
  exception when raise_exception then
   update public.weekly_checkins set next_enqueue_at=case when sqlerrm='USER_DAILY_LIMIT' then (date_trunc('day',now() at time zone 'UTC')+interval '1 day') at time zone 'UTC' else now()+interval '10 minutes' end where id=c.id;
  when others then
   update public.weekly_checkins set queue_error='Não foi possível preparar a revisão. Confira os dados do plano e faça um novo fechamento.',updated_at=now() where id=c.id;
  end;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(prior_uid,''),true);
end $$;
revoke all on function ai_private.enqueue_weekly_reviews() from public,anon,authenticated;
select cron.schedule('dez-voltas-weekly-reviews','* * * * *','select ai_private.enqueue_weekly_reviews()');

create or replace function ai_private.claim_ai_generation(runner_key text,worker_model text) returns jsonb
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
 return jsonb_build_object('id',j.id,'lease',j.lease,'profile',j.profile,'attempts',j.attempts,'kind',j.kind,'context',j.context);
end $$;

create or replace function ai_private.finish_ai_generation(runner_key text,job_id uuid,job_lease uuid,job_result jsonb default null,job_error text default null,retryable boolean default false,tokens_in bigint default 0,tokens_out bigint default 0) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.ai_generation_jobs;
begin
 perform ai_private.authorize_runner(runner_key);
 select * into j from public.ai_generation_jobs where id=job_id for update;
 if not found or j.status<>'processing' or j.lease is distinct from job_lease or j.lease_until<now() then return false; end if;
 if job_result is not null and (jsonb_typeof(job_result)<>'object' or (j.kind='initial' and job_result->'profile' is distinct from j.profile) or (j.kind='weekly_review' and (job_result#>>'{profile,review,sourcePlanId}' is distinct from j.context->>'sourcePlanId' or job_result#>>'{profile,targetDate}' is distinct from j.profile->>'targetDate')) or not job_result ? 'plan') then raise exception 'Invalid result' using errcode='22023'; end if;
 update public.ai_generation_jobs set status=case when job_result is not null then 'completed' when retryable and attempts<2 then 'retrying' else 'failed' end,
  result=job_result,error=case when job_result is not null then null else left(coalesce(job_error,'Não foi possível concluir a geração. Seu plano anterior foi preservado.'),800) end,
  next_attempt_at=now()+interval '2 minutes',updated_at=now(),
  finished_at=case when job_result is not null or not retryable or attempts>=2 then now() else null end,
  input_tokens=input_tokens+greatest(0,coalesce(tokens_in,0)),output_tokens=output_tokens+greatest(0,coalesce(tokens_out,0)),lease=null,lease_until=null where id=job_id;
 update ai_private.daily_usage set input_tokens=input_tokens+greatest(0,coalesce(tokens_in,0)),output_tokens=output_tokens+greatest(0,coalesce(tokens_out,0)) where day=(j.started_at at time zone 'UTC')::date;
 return true;
end $$;
