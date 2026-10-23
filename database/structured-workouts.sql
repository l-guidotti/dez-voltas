-- Optional structure for new sessions; existing session IDs and plan hashes remain unchanged.
alter table public.training_sessions add column workout jsonb check(workout is null or (jsonb_typeof(workout)='object' and octet_length(workout::text)<=12000));

create or replace function public.read_training_store(since_cursor bigint default 0) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb := '[]'::jsonb; batch jsonb; tbl text; kind text; st public.training_sync_state;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into st from public.training_sync_state where user_id=auth.uid();
 for kind,tbl in select * from (values ('profiles','runner_profiles'),('plans','training_plans'),('sessions','training_sessions'),('diary','diary_entries'),('settings','training_preferences')) as tables(kind,tbl) loop
  execute format('select coalesce(jsonb_agg(jsonb_build_object(''kind'',$1,''id'',r.id,''revision'',r.revision,''data'',case when r.deleted then null else (case when $1=''sessions'' and to_jsonb(r)->''workout''=''null''::jsonb then to_jsonb(r)-''workout'' else to_jsonb(r) end)-array[''user_id'',''id'',''revision'',''sync_version'',''deleted'',''updated_at''] end)),''[]''::jsonb) from public.%I r where r.user_id=$2 and r.sync_version>$3',tbl) into batch using kind,auth.uid(),greatest(since_cursor,0);
  result:=result||batch;
 end loop;
 return jsonb_build_object('cursor',coalesce(st.cursor,0),'initialized',coalesce(st.initialized,false),'legacy_revision',coalesce(st.legacy_revision,0),'rows',result);
end $$;

create or replace function public.apply_training_changes(changes jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb; tbl text; cols text; v bigint; current_revision bigint; body jsonb; n integer;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if jsonb_typeof(changes)<>'array' or jsonb_array_length(changes)>6000 then raise exception 'INVALID_CHANGES'; end if;
 select cursor into v from public.training_sync_state where user_id=auth.uid() and initialized for update;
 if v is null then raise exception 'STORE_NOT_INITIALIZED'; end if;
 if (select count(*) from jsonb_array_elements(changes))<>(select count(distinct (e->>'kind',e->>'id')) from jsonb_array_elements(changes) e) then raise exception 'DUPLICATE_CHANGES'; end if;
 for item in select * from jsonb_array_elements(changes) loop
  tbl:=case item->>'kind' when 'profiles' then 'runner_profiles' when 'plans' then 'training_plans' when 'sessions' then 'training_sessions' when 'diary' then 'diary_entries' when 'settings' then 'training_preferences' else null end;
  if tbl is null or item->>'id' is null or (item->>'revision')::bigint<0 then raise exception 'INVALID_CHANGE'; end if;
  execute format('select revision from public.%I where user_id=$1 and id=$2',tbl) into current_revision using auth.uid(),item->>'id';
  if coalesce(current_revision,0)<>(item->>'revision')::bigint then raise exception 'SYNC_CONFLICT' using errcode='40001'; end if;
 end loop;
 if jsonb_array_length(changes)=0 then return public.read_training_store(v); end if;
 v:=v+1;
 for item in select * from jsonb_array_elements(changes) loop
  tbl:=case item->>'kind' when 'profiles' then 'runner_profiles' when 'plans' then 'training_plans' when 'sessions' then 'training_sessions' when 'diary' then 'diary_entries' when 'settings' then 'training_preferences' end;
  if item->'data'='null'::jsonb then
   if item->>'kind'<>'diary' then raise exception 'ONLY_DIARY_DELETION_SUPPORTED'; end if;
   execute format('update public.%I set deleted=true, revision=revision+1, sync_version=$3, updated_at=now() where user_id=$1 and id=$2',tbl) using auth.uid(),item->>'id',v;
  else
   if jsonb_typeof(item->'data')<>'object' then raise exception 'INVALID_DATA'; end if;
   body:=(item->'data')||jsonb_build_object('user_id',auth.uid(),'id',item->>'id','revision',(item->>'revision')::bigint+1,'sync_version',v,'deleted',false,'updated_at',now());
   cols:=case item->>'kind' when 'profiles' then 'draft,form_profile,suggestion_id,revision,sync_version,deleted,updated_at' when 'plans' then 'profile,plan,generated_at,model,adopted,revision,sync_version,deleted,updated_at' when 'sessions' then 'plan_id,week,date,title,km,minutes,rpe,long_run,instructions,workout,revision,sync_version,deleted,updated_at' when 'diary' then 'km,minutes,rpe,pain,notes,recorded_at,session_date,revision,sync_version,deleted,updated_at' when 'settings' then 'active_plan_id,checklist,revision,sync_version,deleted,updated_at' end;
   execute format('insert into public.%1$I select (jsonb_populate_record(null::public.%1$I,$1)).* on conflict(user_id,id) do update set (%2$s)=(%3$s)',tbl,cols,'excluded.'||replace(cols,',',',excluded.')) using body;
  end if;
 end loop;
 update public.training_sync_state set cursor=v where user_id=auth.uid();
 return public.read_training_store(v-1);
end $$;

create or replace function ai_private.enqueue_weekly_reviews() returns void language plpgsql security definer set search_path='' as $$
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
   'existingPhases',(select coalesce(plan->'phases','[]') from public.training_plans where user_id=c.user_id and id=c.source_plan_id),
   'upcoming',(select coalesce(jsonb_agg(jsonb_build_object('date',date,'title',title,'km',km,'minutes',minutes,'rpe',rpe,'long',long_run,'workout',workout)),'[]') from public.training_sessions where user_id=c.user_id and plan_id=c.source_plan_id and not deleted and date>c.week_end and date<=c.week_end+28),
   'currentIntensity',(select draft#>'{details,intensity}' from public.runner_profiles where user_id=c.user_id and not deleted),
   'currentPain',(select coalesce(draft->>'pain','none') from public.runner_profiles where user_id=c.user_id and not deleted),
   'previousCheckin',(select report from public.weekly_checkins where user_id=c.user_id and week_end=c.week_start-1 order by updated_at desc limit 1),
   'planned',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'date',date,'km',km,'minutes',minutes,'rpe',rpe,'workout',workout)),'[]') from public.training_sessions where user_id=c.user_id and plan_id=c.source_plan_id and not deleted and date between c.week_start and c.week_end),
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
