-- A check-in may produce several immutable generations; job_id remains the latest.
alter table public.ai_generation_jobs drop constraint ai_generation_jobs_review_id_key;
create index ai_jobs_review_history on public.ai_generation_jobs(review_id,created_at desc) where review_id is not null;

create function ai_private.weekly_review_context(c public.weekly_checkins,p jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('sourcePlanId',c.source_plan_id,'weekStart',c.week_start,'weekEnd',c.week_end,'checkin',c.report,'profile',p,
 'dailyRecoveryConsent',coalesce(c.report->>'recoveryConsent'='true',false),
 'dailyRecovery',case when c.report->>'recoveryConsent'='true' then
 (select coalesce(jsonb_agg(jsonb_build_object('date',d.day,'fatigue',d.fatigue,'sleep',d.sleep,'readiness',d.readiness,'pain',d.pain,'illness',d.illness,'painLocation',case when d.day>=c.week_start then d.pain_location else '' end,'notes',case when d.day>=c.week_start then d.notes else '' end,'activity',jsonb_build_object('type',d.activity_type,'minutes',d.activity_minutes,'rpe',d.activity_rpe)) order by d.day),'[]'::jsonb) from public.daily_recovery d where d.user_id=c.user_id and d.day between c.week_end-27 and c.week_end) else '[]'::jsonb end,
 'existingPhases',(select coalesce(plan->'phases','[]') from public.training_plans where user_id=c.user_id and id=c.source_plan_id),
 'upcoming',(select coalesce(jsonb_agg(jsonb_build_object('date',date,'title',title,'km',km,'minutes',minutes,'rpe',rpe,'long',long_run,'workout',workout) order by date),'[]'::jsonb) from public.training_sessions where user_id=c.user_id and plan_id=c.source_plan_id and not deleted and date>c.week_end and date<=c.week_end+28),
 'currentIntensity',(select draft#>'{details,intensity}' from public.runner_profiles where user_id=c.user_id and not deleted),
 'currentPain',(select coalesce(draft->>'pain','none') from public.runner_profiles where user_id=c.user_id and not deleted),
 'previousCheckin',(select report from public.weekly_checkins where user_id=c.user_id and week_end=c.week_start-1 order by updated_at desc limit 1),
 'planned',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'date',date,'km',km,'minutes',minutes,'rpe',rpe,'workout',workout) order by date),'[]'::jsonb) from public.training_sessions where user_id=c.user_id and plan_id=c.source_plan_id and not deleted and date between c.week_start and c.week_end),
 'logs',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'date',session_date,'km',km,'minutes',minutes,'rpe',rpe,'pain',pain,'notes',case when session_date>=c.week_start then notes else '' end) order by session_date,id),'[]'::jsonb) from public.diary_entries where user_id=c.user_id and not deleted and session_date between c.week_end-27 and c.week_end))
$$;
revoke all on function ai_private.weekly_review_context(public.weekly_checkins,jsonb) from public,anon,authenticated;

create function ai_private.retry_weekly_review(plan_id text,week_start_date date,expected_revision bigint,client_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();c public.weekly_checkins;p public.training_plans;j public.ai_generation_jobs;admitted jsonb;ctx jsonb;
 today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501';end if;
 if client_request_id is null or expected_revision is null or expected_revision<1 then raise exception 'Invalid request' using errcode='22023';end if;
 perform 1 from public.training_preferences where user_id=uid for update;
 select plans.* into p from public.training_preferences prefs join public.training_plans plans on plans.user_id=prefs.user_id and plans.id=prefs.active_plan_id
 where prefs.user_id=uid and prefs.active_plan_id=plan_id and not prefs.deleted and not plans.deleted and plans.adopted;
 if not found then raise exception 'WEEK_PLAN_CHANGED' using errcode='P0001';end if;
 select * into c from public.weekly_checkins where user_id=uid and source_plan_id=plan_id and week_start=week_start_date for update;
 if not found then raise exception 'CHECKIN_REQUIRED' using errcode='P0001';end if;
 -- A lost response can be retried even after the revision advanced, without billing again.
 select * into j from public.ai_generation_jobs where user_id=uid and request_id=client_request_id;
 if found then
  if j.review_id is distinct from c.id then raise exception 'Invalid request' using errcode='22023';end if;
  return jsonb_build_object('checkin',to_jsonb(c),'job',jsonb_build_object('id',j.id,'status',j.status,'attempts',j.attempts));
 end if;
 if c.revision<>expected_revision then raise exception 'CHECKIN_CONFLICT' using errcode='40001';end if;
 if c.week_end>=today or today>c.week_end+7 or today>=(p.profile->>'targetDate')::date then raise exception 'WEEK_REVIEW_EXPIRED' using errcode='P0001';end if;
 if c.report->>'consent' is distinct from 'true' then raise exception 'CHECKIN_REQUIRED' using errcode='P0001';end if;
 if c.report->>'pain' is distinct from 'none' or c.report->>'illness' is distinct from 'false' then raise exception 'REVIEW_RECOVERY_BLOCKED' using errcode='P0001';end if;
 if exists(select 1 from public.ai_generation_jobs where user_id=uid and status in ('queued','processing','retrying')) then raise exception 'REVIEW_BUSY' using errcode='P0001';end if;
 ctx:=ai_private.weekly_review_context(c,p.profile)||jsonb_build_object('manualRequest',true);
 if octet_length(ctx::text)>120000 then raise exception 'Invalid review size' using errcode='22023';end if;
 admitted:=ai_private.enqueue_ai_generation(p.profile,client_request_id);
 select * into j from public.ai_generation_jobs where id=(admitted->>'id')::uuid and user_id=uid;
 if not found or j.request_id is distinct from client_request_id then raise exception 'REVIEW_BUSY' using errcode='P0001';end if;
 update public.ai_generation_jobs set kind='weekly_review',context=ctx,review_id=c.id where id=j.id;
 update public.weekly_checkins set job_id=j.id,revision=revision+1,queue_error=null,updated_at=now() where id=c.id returning * into c;
 return jsonb_build_object('checkin',to_jsonb(c),'job',admitted);
end $$;
revoke all on function ai_private.retry_weekly_review(text,date,bigint,uuid) from public,anon,authenticated;
grant execute on function ai_private.retry_weekly_review(text,date,bigint,uuid) to authenticated;
create function public.retry_weekly_review(plan_id text,week_start_date date,expected_revision bigint,client_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select ai_private.retry_weekly_review(plan_id,week_start_date,expected_revision,client_request_id)$$;
revoke all on function public.retry_weekly_review(text,date,bigint,uuid) from public,anon,authenticated;
grant execute on function public.retry_weekly_review(text,date,bigint,uuid) to authenticated;

create or replace function public.read_weekly_review() returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();p public.training_plans;today date:=(now() at time zone 'America/Sao_Paulo')::date;s date;e date;d integer;report jsonb;stats jsonb;history jsonb;
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501';end if;
 select plans.* into p from public.training_preferences prefs join public.training_plans plans on plans.user_id=prefs.user_id and plans.id=prefs.active_plan_id
 where prefs.user_id=uid and not prefs.deleted and not plans.deleted and plans.adopted;
 if not found then return jsonb_build_object('planId',null);end if;
 d:=today-(p.profile->>'startDate')::date;
 s:=(p.profile->>'startDate')::date+7*greatest(0,floor(d/7.0)::integer-case when mod(d,7)<6 then 1 else 0 end);e:=s+6;
 select to_jsonb(c) into report from public.weekly_checkins c where c.user_id=uid and c.source_plan_id=p.id and c.week_start=s;
 select jsonb_build_object('registered',count(*),'km',coalesce(sum(km),0),'minutes',coalesce(sum(minutes),0),'pain',count(*) filter(where pain<>'none')) into stats
 from public.diary_entries where user_id=uid and not deleted and session_date between s and least(e,today);
 select coalesce(jsonb_agg(x),'[]'::jsonb) into history from (
  select c.id,c.source_plan_id,c.week_start,c.week_end,c.job_id,c.queue_error,c.revision,j.status,j.error,
   coalesce(c.source_plan_id=p.id and c.week_end<today and today<=c.week_end+7 and today<(p.profile->>'targetDate')::date
    and c.report->>'consent'='true' and c.report->>'pain'='none' and c.report->>'illness'='false'
    and not exists(select 1 from public.ai_generation_jobs pending where pending.user_id=uid and pending.status in ('queued','processing','retrying')),false) as can_retry
  from public.weekly_checkins c left join public.ai_generation_jobs j on j.id=c.job_id and j.user_id=uid
  where c.user_id=uid order by c.week_end desc limit 8)x;
 return jsonb_build_object('planId',p.id,'profile',p.profile,'weekStart',s,'weekEnd',e,'canSave',today>=e and today<(p.profile->>'targetDate')::date,
 'checkin',report,'stats',stats,'canRetry',coalesce((select (x->>'can_retry')::boolean from jsonb_array_elements(history)x where x->>'id'=report->>'id'),false),
 'planned',(select count(*) from public.training_sessions where user_id=uid and plan_id=p.id and not deleted and date between s and e),'history',history);
end $$;
