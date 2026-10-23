-- Additive migration: account_data remains an untouched legacy backup.
create table public.training_sync_state(user_id uuid primary key references auth.users(id) on delete cascade, cursor bigint not null default 0 check(cursor>=0), initialized boolean not null default false, legacy_revision bigint not null default 0);
create table public.runner_profiles(user_id uuid not null references auth.users(id) on delete cascade, id text not null check(id ~ '^[a-zA-Z0-9_-]{1,128}$'), revision bigint not null check(revision>0), sync_version bigint not null check(sync_version>0), deleted boolean not null default false, updated_at timestamptz not null default now(), draft jsonb, form_profile jsonb, suggestion_id text, check(id='profile'), primary key(user_id,id));
create index runner_profiles_sync_idx on public.runner_profiles(user_id,sync_version);
create table public.training_plans(user_id uuid not null references auth.users(id) on delete cascade, id text not null check(id ~ '^[a-zA-Z0-9_-]{1,128}$'), revision bigint not null check(revision>0), sync_version bigint not null check(sync_version>0), deleted boolean not null default false, updated_at timestamptz not null default now(), profile jsonb not null, plan jsonb not null, generated_at text not null, model text not null, adopted boolean not null, check(jsonb_typeof(profile)='object' and jsonb_typeof(plan)='object'), primary key(user_id,id));
create index training_plans_sync_idx on public.training_plans(user_id,sync_version);
create table public.training_sessions(user_id uuid not null references auth.users(id) on delete cascade, id text not null check(id ~ '^[a-zA-Z0-9_-]{1,128}$'), revision bigint not null check(revision>0), sync_version bigint not null check(sync_version>0), deleted boolean not null default false, updated_at timestamptz not null default now(), plan_id text, week integer not null check(week between 1 and 105), date date not null, title text not null check(length(title)<=120), km numeric not null check(km between 0 and 150), minutes numeric check(minutes between 1 and 600), rpe integer check(rpe between 1 and 10), long_run boolean not null, instructions text not null check(length(instructions)<=1500), check(plan_id is null or (minutes is not null and rpe is not null)), primary key(user_id,id));
create index training_sessions_sync_idx on public.training_sessions(user_id,sync_version);
create table public.diary_entries(user_id uuid not null references auth.users(id) on delete cascade, id text not null check(id ~ '^[a-zA-Z0-9_-]{1,128}$'), revision bigint not null check(revision>0), sync_version bigint not null check(sync_version>0), deleted boolean not null default false, updated_at timestamptz not null default now(), km numeric not null check(km between 0 and 150), minutes numeric not null check(minutes>0 and minutes<=1440), rpe integer not null check(rpe between 1 and 10), pain text not null check(pain in ('none','mild','stop')), notes text not null check(length(notes)<=1500), recorded_at text not null, session_date date not null, primary key(user_id,id));
create index diary_entries_sync_idx on public.diary_entries(user_id,sync_version);
create table public.training_preferences(user_id uuid not null references auth.users(id) on delete cascade, id text not null check(id ~ '^[a-zA-Z0-9_-]{1,128}$'), revision bigint not null check(revision>0), sync_version bigint not null check(sync_version>0), deleted boolean not null default false, updated_at timestamptz not null default now(), active_plan_id text, checklist jsonb not null check(jsonb_typeof(checklist)='object'), check(id='settings'), primary key(user_id,id));
create index training_preferences_sync_idx on public.training_preferences(user_id,sync_version);
alter table public.training_sessions add foreign key(user_id,plan_id) references public.training_plans(user_id,id) deferrable initially deferred;
alter table public.diary_entries add foreign key(user_id,id) references public.training_sessions(user_id,id) deferrable initially deferred;
alter table public.runner_profiles add foreign key(user_id,suggestion_id) references public.training_plans(user_id,id) deferrable initially deferred;
alter table public.training_preferences add foreign key(user_id,active_plan_id) references public.training_plans(user_id,id) deferrable initially deferred;
create index diary_entries_history_idx on public.diary_entries(user_id,session_date desc) where not deleted;
create index training_sessions_plan_idx on public.training_sessions(user_id,plan_id);
create index runner_profiles_suggestion_idx on public.runner_profiles(user_id,suggestion_id);
create index training_preferences_active_idx on public.training_preferences(user_id,active_plan_id);
alter table public.training_sync_state enable row level security;
revoke all on public.training_sync_state from anon, authenticated;
grant select,insert,update on public.training_sync_state to authenticated;
create policy own_read on public.training_sync_state for select to authenticated using ((select auth.uid())=user_id);
create policy own_insert on public.training_sync_state for insert to authenticated with check ((select auth.uid())=user_id);
create policy own_update on public.training_sync_state for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
alter table public.runner_profiles enable row level security;
revoke all on public.runner_profiles from anon, authenticated;
grant select,insert,update on public.runner_profiles to authenticated;
create policy own_read on public.runner_profiles for select to authenticated using ((select auth.uid())=user_id);
create policy own_insert on public.runner_profiles for insert to authenticated with check ((select auth.uid())=user_id);
create policy own_update on public.runner_profiles for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
alter table public.training_plans enable row level security;
revoke all on public.training_plans from anon, authenticated;
grant select,insert,update on public.training_plans to authenticated;
create policy own_read on public.training_plans for select to authenticated using ((select auth.uid())=user_id);
create policy own_insert on public.training_plans for insert to authenticated with check ((select auth.uid())=user_id);
create policy own_update on public.training_plans for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
alter table public.training_sessions enable row level security;
revoke all on public.training_sessions from anon, authenticated;
grant select,insert,update on public.training_sessions to authenticated;
create policy own_read on public.training_sessions for select to authenticated using ((select auth.uid())=user_id);
create policy own_insert on public.training_sessions for insert to authenticated with check ((select auth.uid())=user_id);
create policy own_update on public.training_sessions for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
alter table public.diary_entries enable row level security;
revoke all on public.diary_entries from anon, authenticated;
grant select,insert,update on public.diary_entries to authenticated;
create policy own_read on public.diary_entries for select to authenticated using ((select auth.uid())=user_id);
create policy own_insert on public.diary_entries for insert to authenticated with check ((select auth.uid())=user_id);
create policy own_update on public.diary_entries for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
alter table public.training_preferences enable row level security;
revoke all on public.training_preferences from anon, authenticated;
grant select,insert,update on public.training_preferences to authenticated;
create policy own_read on public.training_preferences for select to authenticated using ((select auth.uid())=user_id);
create policy own_insert on public.training_preferences for insert to authenticated with check ((select auth.uid())=user_id);
create policy own_update on public.training_preferences for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create function public.read_training_store(since_cursor bigint default 0) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb := '[]'::jsonb; batch jsonb; tbl text; kind text; st public.training_sync_state;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into st from public.training_sync_state where user_id=auth.uid();
 for kind,tbl in select * from (values ('profiles','runner_profiles'),('plans','training_plans'),('sessions','training_sessions'),('diary','diary_entries'),('settings','training_preferences')) as tables(kind,tbl) loop
  execute format('select coalesce(jsonb_agg(jsonb_build_object(''kind'',$1,''id'',r.id,''revision'',r.revision,''data'',case when r.deleted then null else to_jsonb(r)-array[''user_id'',''id'',''revision'',''sync_version'',''deleted'',''updated_at''] end)),''[]''::jsonb) from public.%I r where r.user_id=$2 and r.sync_version>$3',tbl) into batch using kind,auth.uid(),greatest(since_cursor,0);
  result:=result||batch;
 end loop;
 return jsonb_build_object('cursor',coalesce(st.cursor,0),'initialized',coalesce(st.initialized,false),'legacy_revision',coalesce(st.legacy_revision,0),'rows',result);
end $$;
create function public.apply_training_changes(changes jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
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
   cols:=case item->>'kind' when 'profiles' then 'draft,form_profile,suggestion_id,revision,sync_version,deleted,updated_at' when 'plans' then 'profile,plan,generated_at,model,adopted,revision,sync_version,deleted,updated_at' when 'sessions' then 'plan_id,week,date,title,km,minutes,rpe,long_run,instructions,revision,sync_version,deleted,updated_at' when 'diary' then 'km,minutes,rpe,pain,notes,recorded_at,session_date,revision,sync_version,deleted,updated_at' when 'settings' then 'active_plan_id,checklist,revision,sync_version,deleted,updated_at' end;
   execute format('insert into public.%1$I select (jsonb_populate_record(null::public.%1$I,$1)).* on conflict(user_id,id) do update set (%2$s)=(%3$s)',tbl,cols,'excluded.'||replace(cols,',',',excluded.')) using body;
  end if;
 end loop;
 update public.training_sync_state set cursor=v where user_id=auth.uid();
 return public.read_training_store(v-1);
end $$;
create function public.initialize_training_store(expected_legacy_revision bigint, initial_rows jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare st public.training_sync_state; legacy bigint;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 insert into public.training_sync_state(user_id) values(auth.uid()) on conflict do nothing;
 select * into st from public.training_sync_state where user_id=auth.uid() for update;
 if st.initialized then return public.read_training_store(0); end if;
 select coalesce(revision,0) into legacy from public.account_data where user_id=auth.uid();
 if coalesce(legacy,0)<>expected_legacy_revision then raise exception 'LEGACY_CHANGED' using errcode='40001'; end if;
 update public.training_sync_state set initialized=true,legacy_revision=expected_legacy_revision where user_id=auth.uid();
 perform public.apply_training_changes(initial_rows);
 return public.read_training_store(0);
end $$;
revoke all on function public.read_training_store(bigint) from public,anon;
grant execute on function public.read_training_store(bigint) to authenticated;
revoke all on function public.apply_training_changes(jsonb) from public,anon;
grant execute on function public.apply_training_changes(jsonb) to authenticated;
revoke all on function public.initialize_training_store(bigint,jsonb) from public,anon;
grant execute on function public.initialize_training_store(bigint,jsonb) to authenticated;
