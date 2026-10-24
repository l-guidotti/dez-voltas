-- Installation script: independent, account-owned daily records; existing training documents are unchanged.
create table public.daily_recovery (
 user_id uuid not null references auth.users(id) on delete cascade,day date not null,
 fatigue smallint not null check(fatigue between 1 and 5),sleep smallint not null check(sleep between 1 and 5),readiness smallint not null check(readiness between 1 and 5),
 pain text not null check(pain in ('none','mild','stop')),illness boolean not null,
 pain_location text not null default '' check(length(pain_location)<=100),notes text not null default '' check(length(notes)<=500),
 activity_type text not null check(activity_type in ('none','strength','walk','bike','swim','other')),
 activity_minutes integer not null check(activity_minutes between 0 and 600),activity_rpe smallint,
 revision bigint not null default 1 check(revision>0),last_mutation uuid not null,updated_at timestamptz not null default now(),
 primary key(user_id,day),check((activity_type='none' and activity_minutes=0 and activity_rpe is null) or (activity_type<>'none' and activity_minutes>=1 and activity_rpe between 1 and 10 and activity_rpe is not null))
);
alter table public.daily_recovery enable row level security;
revoke all on public.daily_recovery from public,anon,authenticated;
grant select on public.daily_recovery to authenticated;
create policy daily_recovery_owner on public.daily_recovery for select to authenticated using((select auth.uid())=user_id);

create function public.read_daily_recovery() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(d)-'user_id'-'last_mutation' order by d.day desc),'[]'::jsonb)
 from public.daily_recovery d where d.user_id=(select auth.uid()) and d.day between (now() at time zone 'America/Sao_Paulo')::date-27 and (now() at time zone 'America/Sao_Paulo')::date
$$;
revoke all on function public.read_daily_recovery() from public,anon,authenticated;
grant execute on function public.read_daily_recovery() to authenticated;

create function ai_private.save_daily_recovery(record_day date,report_data jsonb,expected_revision bigint,mutation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); today date:=(now() at time zone 'America/Sao_Paulo')::date; saved public.daily_recovery; field text; a jsonb;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception 'Authentication required' using errcode='42501';end if;
 if record_day is null or record_day<today-27 or record_day>today or expected_revision is null or expected_revision<0 or mutation_id is null then raise exception 'Invalid date/revision' using errcode='22023';end if;
 if report_data is null or jsonb_typeof(report_data)<>'object' or octet_length(report_data::text)>3000 then raise exception 'Invalid recovery' using errcode='22023';end if;
 foreach field in array array['fatigue','sleep','readiness'] loop
  if jsonb_typeof(report_data->field) is distinct from 'number' or coalesce(report_data->>field,'')!~'^[1-5]$' then raise exception 'Invalid recovery scale' using errcode='22023';end if;
 end loop;
 if coalesce(report_data->>'pain','') not in ('none','mild','stop') or jsonb_typeof(report_data->'illness') is distinct from 'boolean' or jsonb_typeof(report_data->'painLocation') is distinct from 'string' or length(report_data->>'painLocation')>100 or jsonb_typeof(report_data->'notes') is distinct from 'string' or length(report_data->>'notes')>500 then raise exception 'Invalid recovery report' using errcode='22023';end if;
 a:=report_data->'activity';
 if jsonb_typeof(a) is distinct from 'object' or coalesce(a->>'type','') not in ('none','strength','walk','bike','swim','other') then raise exception 'Invalid activity' using errcode='22023';end if;
 if a->>'type'='none' then
  if a->>'minutes' is distinct from '0' or jsonb_typeof(a->'rpe') is distinct from 'null' then raise exception 'Invalid rest' using errcode='22023';end if;
 else
  if jsonb_typeof(a->'minutes') is distinct from 'number' or coalesce(a->>'minutes','')!~'^[0-9]{1,3}$' or jsonb_typeof(a->'rpe') is distinct from 'number' or coalesce(a->>'rpe','')!~'^[0-9]{1,2}$' then raise exception 'Invalid activity load' using errcode='22023';end if;
  if (a->>'minutes')::int not between 1 and 600 or (a->>'rpe')::int not between 1 and 10 then raise exception 'Invalid activity load' using errcode='22023';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||record_day::text,0));
 select * into saved from public.daily_recovery where user_id=uid and day=record_day;
 if found and saved.last_mutation=mutation_id then return to_jsonb(saved)-'user_id'-'last_mutation';end if;
 if coalesce(saved.revision,0)<>expected_revision then raise exception 'RECOVERY_CONFLICT' using errcode='40001';end if;
 insert into public.daily_recovery(user_id,day,fatigue,sleep,readiness,pain,illness,pain_location,notes,activity_type,activity_minutes,activity_rpe,last_mutation)
 values(uid,record_day,(report_data->>'fatigue')::smallint,(report_data->>'sleep')::smallint,(report_data->>'readiness')::smallint,report_data->>'pain',(report_data->>'illness')::boolean,report_data->>'painLocation',report_data->>'notes',a->>'type',(a->>'minutes')::integer,(a->>'rpe')::smallint,mutation_id)
 on conflict(user_id,day) do update set fatigue=excluded.fatigue,sleep=excluded.sleep,readiness=excluded.readiness,pain=excluded.pain,illness=excluded.illness,pain_location=excluded.pain_location,notes=excluded.notes,activity_type=excluded.activity_type,activity_minutes=excluded.activity_minutes,activity_rpe=excluded.activity_rpe,last_mutation=excluded.last_mutation,revision=daily_recovery.revision+1,updated_at=now() returning * into saved;
 return to_jsonb(saved)-'user_id'-'last_mutation';
end $$;
revoke all on function ai_private.save_daily_recovery(date,jsonb,bigint,uuid) from public,anon,authenticated;
grant execute on function ai_private.save_daily_recovery(date,jsonb,bigint,uuid) to authenticated;
create function public.save_daily_recovery(record_day date,report_data jsonb,expected_revision bigint,mutation_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select ai_private.save_daily_recovery(record_day,report_data,expected_revision,mutation_id) $$;
revoke all on function public.save_daily_recovery(date,jsonb,bigint,uuid) from public,anon,authenticated;
grant execute on function public.save_daily_recovery(date,jsonb,bigint,uuid) to authenticated;

create function ai_private.recovery_alert(uid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select pain<>'none' or illness from public.daily_recovery where user_id=uid and day between (now() at time zone 'America/Sao_Paulo')::date-6 and (now() at time zone 'America/Sao_Paulo')::date order by day desc limit 1),false)
$$;
revoke all on function ai_private.recovery_alert(uuid) from public,anon,authenticated;
create function ai_private.claim_ai_generation_recovery(runner_key text,worker_model text) returns jsonb language plpgsql security definer set search_path='' as $$
declare job jsonb; uid uuid;
begin
 job:=ai_private.claim_ai_generation(runner_key,worker_model); -- Existing capability check, lease and quotas remain authoritative.
 if job is null then return null;end if;
 select user_id into uid from public.ai_generation_jobs where id=(job->>'id')::uuid;
 return job||jsonb_build_object('recovery_alert',ai_private.recovery_alert(uid));
end $$;
revoke all on function ai_private.claim_ai_generation_recovery(text,text) from public,anon,authenticated;
grant execute on function ai_private.claim_ai_generation_recovery(text,text) to anon;
-- Activated after the updated worker is deployed (see daily-recovery-activate.sql).
