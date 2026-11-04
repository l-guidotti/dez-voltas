-- One correction shares the original job's two-call budget and worker lease.
-- Install before deploying the worker. Existing jobs/plans/records are untouched.
create function ai_private.reserve_ai_correction(runner_key text,job_id uuid,job_lease uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare cfg ai_private.queue_settings; j public.ai_generation_jobs; used integer;
 today date:=(now() at time zone 'UTC')::date;
begin
 perform ai_private.authorize_runner(runner_key);
 select * into cfg from ai_private.queue_settings where singleton for update;
 if not found or not cfg.enabled then return false; end if;
 -- Same lock order as claim: settings, daily budget, job. No extra worker slot.
 insert into ai_private.daily_usage(day) values(today) on conflict do nothing;
 select attempts into used from ai_private.daily_usage where day=today for update;
 if used>=cfg.daily_attempts then return false; end if;
 select * into j from public.ai_generation_jobs where id=job_id for update;
 if not found or j.status<>'processing' or j.attempts<>1
  or j.lease is distinct from job_lease or j.lease_until is null
  or j.lease_until<now()+interval '70 seconds'
  or (j.started_at at time zone 'UTC')::date is distinct from today then return false; end if;
 update public.ai_generation_jobs set attempts=2,updated_at=now() where id=j.id;
 update ai_private.daily_usage set attempts=attempts+1 where day=today;
 return true;
end $$;
revoke all on function ai_private.reserve_ai_correction(text,uuid,uuid) from public,anon,authenticated;
grant execute on function ai_private.reserve_ai_correction(text,uuid,uuid) to anon;
create function public.reserve_ai_correction(runner_key text,job_id uuid,job_lease uuid)
returns boolean language sql security invoker set search_path='' as $$
 select ai_private.reserve_ai_correction(runner_key,job_id,job_lease)
$$;
revoke all on function public.reserve_ai_correction(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_ai_correction(text,uuid,uuid) to anon;
