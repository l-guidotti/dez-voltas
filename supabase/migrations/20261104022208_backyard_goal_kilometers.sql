-- Data-only migration. Pause both schedulers, wait for processing jobs to finish,
-- deploy the km-aware application, then apply and resume the prior queue settings.
-- Existing plan IDs, sessions, diary, snapshots' meaning and legacy backups are preserved.
do $convert$
declare owner_id uuid; next_cursor bigint; col text;
begin
 if (select enabled from ai_private.queue_settings where singleton)
 or (select enabled from ai_private.weekly_settings where singleton)
 or exists(select 1 from public.ai_generation_jobs where status='processing') then
  raise exception 'Pause AI/weekly schedulers and wait for processing jobs before converting goal units';
 end if;

 for owner_id in
  select user_id from public.training_plans
   where profile->>'goal'='backyard' and profile->>'targetUnit' is null
  union
  select user_id from public.runner_profiles
   where (draft->>'goal'='backyard' and draft->>'targetUnit' is null)
      or (form_profile->>'goal'='backyard' and form_profile->>'targetUnit' is null)
 loop
  update public.training_sync_state set cursor=cursor+1 where user_id=owner_id returning cursor into next_cursor;
  if not found then raise exception 'Missing training sync state; no conversion applied';end if;
  update public.training_plans set
   profile=jsonb_set(profile,'{target}',to_jsonb(round((profile->>'target')::numeric*6.7056,4)))||'{"targetUnit":"km"}'::jsonb,
   revision=revision+1,sync_version=next_cursor,updated_at=now()
  where user_id=owner_id and profile->>'goal'='backyard' and profile->>'targetUnit' is null;

  -- A profile row may carry both an editing draft and a completed form. Bump once.
  update public.runner_profiles set
   draft=case when draft->>'goal'='backyard' and draft->>'targetUnit' is null
    then jsonb_set(draft,'{target}',to_jsonb(round((draft->>'target')::numeric*6.7056,4)))||'{"targetUnit":"km"}'::jsonb else draft end,
   form_profile=case when form_profile->>'goal'='backyard' and form_profile->>'targetUnit' is null
    then jsonb_set(form_profile,'{target}',to_jsonb(round((form_profile->>'target')::numeric*6.7056,4)))||'{"targetUnit":"km"}'::jsonb else form_profile end,
   revision=revision+1,sync_version=next_cursor,updated_at=now()
  where user_id=owner_id and ((draft->>'goal'='backyard' and draft->>'targetUnit' is null)
      or (form_profile->>'goal'='backyard' and form_profile->>'targetUnit' is null));
 end loop;

 -- Normalize durable requests and result profiles too, including pending initial jobs:
 -- finish_ai_generation compares their profile to the validated result exactly.
 update public.ai_generation_jobs set
  profile=jsonb_set(profile,'{target}',to_jsonb(round((profile->>'target')::numeric*6.7056,4)))||'{"targetUnit":"km"}'::jsonb
 where profile->>'goal'='backyard' and profile->>'targetUnit' is null;
 foreach col in array array['result','context'] loop
  execute format($sql$
   update public.ai_generation_jobs set %1$I=jsonb_set(%1$I,'{profile}',
    jsonb_set(%1$I->'profile','{target}',to_jsonb(round((%1$I#>>'{profile,target}')::numeric*6.7056,4)))||'{"targetUnit":"km"}'::jsonb)
   where %1$I#>>'{profile,goal}'='backyard' and %1$I#>>'{profile,targetUnit}' is null
  $sql$,col);
 end loop;
end $convert$;
