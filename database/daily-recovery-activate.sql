-- Run after the daily-aware worker has been deployed. Existing cron schedule is preserved.
create or replace function public.claim_ai_generation(runner_key text,worker_model text) returns jsonb language sql security invoker set search_path='' as $$ select ai_private.claim_ai_generation_recovery(runner_key,worker_model) $$;
revoke all on function public.claim_ai_generation(text,text) from public,anon,authenticated;
grant execute on function public.claim_ai_generation(text,text) to anon;

-- Preserve the currently deployed scheduler (including intensity/structured workouts).
-- Insert an owner-filtered, consent-bound daily snapshot into the same transaction that creates the job.
do $activate$
declare old text:=pg_get_functiondef('ai_private.enqueue_weekly_reviews()'::regprocedure); updated text;
begin
 if strpos(old,'dailyRecoveryConsent')>0 then return;end if;
 updated:=replace(old,'ctx:=jsonb_build_object(', $insert$ctx:=jsonb_build_object(
   'dailyRecoveryConsent',coalesce(c.report->>'recoveryConsent'='true',false),
   'dailyRecovery',case when c.report->>'recoveryConsent'='true' then
    (select coalesce(jsonb_agg(jsonb_build_object('date',d.day,'fatigue',d.fatigue,'sleep',d.sleep,'readiness',d.readiness,'pain',d.pain,'illness',d.illness,'painLocation',case when d.day>=c.week_start then d.pain_location else '' end,'notes',case when d.day>=c.week_start then d.notes else '' end,'activity',jsonb_build_object('type',d.activity_type,'minutes',d.activity_minutes,'rpe',d.activity_rpe)) order by d.day),'[]'::jsonb) from public.daily_recovery d where d.user_id=c.user_id and d.day between c.week_end-27 and c.week_end)
    else '[]'::jsonb end,
 $insert$);
 if updated=old then raise exception 'Unexpected scheduler version; activation not applied';end if;
 execute updated;
end $activate$;
