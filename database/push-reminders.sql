-- Web Push: keys stay in Vault; subscription delivery data is never included in AI prompts.
create table ai_private.push_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false,public_key text,private_key_id uuid,max_daily_attempts integer not null default 200 check(max_daily_attempts between 1 and 5000));
insert into ai_private.push_settings(singleton) values(true);
alter table ai_private.push_settings enable row level security;
revoke all on ai_private.push_settings from public,anon,authenticated;
create policy no_direct_push_settings on ai_private.push_settings for all using(false) with check(false);
create table public.push_devices(
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique check(length(endpoint)<=2048),p256dh text not null,auth text not null,
 training_enabled boolean not null,diary_enabled boolean not null,training_time time not null,diary_time time not null,time_zone text not null check(length(time_zone)<=80),
 enabled boolean not null default true,last_status integer,last_sent_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.push_devices enable row level security;
revoke all on public.push_devices from public,anon,authenticated;
grant select(id,user_id,training_enabled,diary_enabled,training_time,diary_time,time_zone,enabled,last_status,last_sent_at,created_at,updated_at) on public.push_devices to authenticated;
create policy own_push_devices on public.push_devices for select to authenticated using((select auth.uid())=user_id);
create index push_devices_owner on public.push_devices(user_id);
create table ai_private.push_deliveries(
 id uuid primary key default gen_random_uuid(),device_id uuid not null references public.push_devices(id) on delete cascade,
 kind text not null check(kind in('training','diary','test')),day date not null,
 status text not null default 'queued' check(status in('queued','processing','accepted','failed','expired')),
 attempts integer not null default 0 check(attempts between 0 and 2),due_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 minutes',
 lease uuid,lease_until timestamptz,provider_status integer,created_at timestamptz not null default now(),finished_at timestamptz
);
alter table ai_private.push_deliveries enable row level security;
revoke all on ai_private.push_deliveries from public,anon,authenticated;
create policy no_direct_push_deliveries on ai_private.push_deliveries for all using(false) with check(false);
create unique index push_once_per_day on ai_private.push_deliveries(device_id,day,kind) where kind<>'test';
create index push_deliveries_ready on ai_private.push_deliveries(due_at,created_at) where status='queued';
create index push_deliveries_device on ai_private.push_deliveries(device_id,created_at);
create table ai_private.push_test_usage(user_id uuid not null references auth.users(id) on delete cascade,day date not null,attempts integer not null default 0,primary key(user_id,day));
alter table ai_private.push_test_usage enable row level security;
revoke all on ai_private.push_test_usage from public,anon,authenticated;
create policy no_direct_push_test_usage on ai_private.push_test_usage for all using(false) with check(false);
create table ai_private.push_usage(day date primary key,attempts integer not null default 0);
alter table ai_private.push_usage enable row level security;
revoke all on ai_private.push_usage from public,anon,authenticated;
create policy no_direct_push_usage on ai_private.push_usage for all using(false) with check(false);

-- Public wrappers below are invoker; privileged implementations stay outside exposed schemas.
create function ai_private.read_push_config() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 return (select jsonb_build_object('ready',public_key is not null,'publicKey',public_key,'enabled',enabled) from ai_private.push_settings where singleton);
end $$;
revoke all on function ai_private.read_push_config() from public,anon,authenticated;
grant execute on function ai_private.read_push_config() to authenticated;
create function public.read_push_config() returns jsonb language sql stable security invoker set search_path='' as $$ select ai_private.read_push_config() $$;
revoke all on function public.read_push_config() from public,anon,authenticated;
grant execute on function public.read_push_config() to authenticated;
create function public.read_push_device(device_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',id,'enabled',enabled,'settings',jsonb_build_object('training',training_enabled,'diary',diary_enabled,'trainingTime',to_char(training_time,'HH24:MI'),'diaryTime',to_char(diary_time,'HH24:MI'),'timeZone',time_zone),'lastStatus',last_status,'lastSentAt',last_sent_at) from public.push_devices where id=device_id and user_id=(select auth.uid())
$$;
revoke all on function public.read_push_device(uuid) from public,anon,authenticated;
grant execute on function public.read_push_device(uuid) to authenticated;

create function ai_private.save_push_device(device_id uuid,subscription jsonb,preferences jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); existing public.push_devices;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception 'Authentication required' using errcode='42501';end if;
 if not exists(select 1 from ai_private.push_settings where singleton and enabled and public_key is not null) then raise exception 'PUSH_NOT_READY' using errcode='P0001';end if;
 if device_id is null or subscription is null or preferences is null or octet_length(subscription::text)>4000 or octet_length(preferences::text)>1000 then raise exception 'Invalid device' using errcode='22023';end if;
 if coalesce(subscription->>'endpoint','')!~'^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/[^[:space:]]+$' or length(subscription->>'endpoint')>2048
 or coalesce(subscription#>>'{keys,p256dh}','')!~'^[A-Za-z0-9_-]{87}$' or coalesce(subscription#>>'{keys,auth}','')!~'^[A-Za-z0-9_-]{22}$' then raise exception 'Invalid subscription' using errcode='22023';end if;
 if jsonb_typeof(preferences->'training') is distinct from 'boolean' or jsonb_typeof(preferences->'diary') is distinct from 'boolean'
 or coalesce(preferences->>'trainingTime','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(preferences->>'diaryTime','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
 or not exists(select 1 from pg_timezone_names where name=preferences->>'timeZone') then raise exception 'Invalid reminder preferences' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('push:'||uid::text,0));
 select * into existing from public.push_devices where id=device_id;
 if found and existing.user_id<>uid then raise exception 'Invalid owner' using errcode='42501';end if;
 if existing.id is null and (select count(*) from public.push_devices where user_id=uid and enabled)>=5 then raise exception 'PUSH_DEVICE_LIMIT' using errcode='P0001';end if;
 insert into public.push_devices(id,user_id,endpoint,p256dh,auth,training_enabled,diary_enabled,training_time,diary_time,time_zone)
 values(device_id,uid,subscription->>'endpoint',subscription#>>'{keys,p256dh}',subscription#>>'{keys,auth}',(preferences->>'training')::boolean,(preferences->>'diary')::boolean,(preferences->>'trainingTime')::time,(preferences->>'diaryTime')::time,preferences->>'timeZone')
 on conflict(id) do update set endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth=excluded.auth,training_enabled=excluded.training_enabled,diary_enabled=excluded.diary_enabled,training_time=excluded.training_time,diary_time=excluded.diary_time,time_zone=excluded.time_zone,enabled=true,updated_at=now();
 update ai_private.push_deliveries set status='expired',finished_at=now() where push_deliveries.device_id=save_push_device.device_id and status='queued';
 return public.read_push_device(device_id);
exception when unique_violation then raise exception 'PUSH_DEVICE_IN_USE' using errcode='P0001';
end $$;
revoke all on function ai_private.save_push_device(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function ai_private.save_push_device(uuid,jsonb,jsonb) to authenticated;
create function public.save_push_device(device_id uuid,subscription jsonb,preferences jsonb) returns jsonb language sql security invoker set search_path='' as $$ select ai_private.save_push_device(device_id,subscription,preferences) $$;
revoke all on function public.save_push_device(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_push_device(uuid,jsonb,jsonb) to authenticated;
create function ai_private.remove_push_device(device_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 delete from public.push_devices where id=device_id and user_id=auth.uid();return found;
end $$;
revoke all on function ai_private.remove_push_device(uuid) from public,anon,authenticated;
grant execute on function ai_private.remove_push_device(uuid) to authenticated;
create function public.remove_push_device(device_id uuid) returns boolean language sql security invoker set search_path='' as $$ select ai_private.remove_push_device(device_id) $$;
revoke all on function public.remove_push_device(uuid) from public,anon,authenticated;
grant execute on function public.remove_push_device(uuid) to authenticated;

create function ai_private.push_key_state(runner_key text) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform ai_private.authorize_runner(runner_key);return (select jsonb_build_object('ready',public_key is not null and private_key_id is not null) from ai_private.push_settings where singleton);end $$;
revoke all on function ai_private.push_key_state(text) from public,anon,authenticated;
grant execute on function ai_private.push_key_state(text) to anon;
create function public.push_key_state(runner_key text) returns jsonb language sql security invoker set search_path='' as $$ select ai_private.push_key_state(runner_key) $$;
revoke all on function public.push_key_state(text) from public,anon,authenticated;
grant execute on function public.push_key_state(text) to anon;
create function ai_private.install_push_keys(runner_key text,public_key text,private_key jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
 perform ai_private.authorize_runner(runner_key);perform 1 from ai_private.push_settings where singleton for update;
 if exists(select 1 from ai_private.push_settings where singleton and private_key_id is not null) then return false;end if;
 if coalesce(public_key,'')!~'^[A-Za-z0-9_-]{87}$' or private_key->>'kty' is distinct from 'EC' or private_key->>'crv' is distinct from 'P-256' or coalesce(private_key->>'d','')!~'^[A-Za-z0-9_-]{43}$' or octet_length(private_key::text)>1000 then raise exception 'Invalid key material' using errcode='22023';end if;
 select vault.create_secret(private_key::text,'dez_voltas_push_vapid','VAPID signing key; never expose to clients') into secret_id;
 update ai_private.push_settings s set public_key=install_push_keys.public_key,private_key_id=secret_id where singleton;return true;
end $$;
revoke all on function ai_private.install_push_keys(text,text,jsonb) from public,anon,authenticated;
grant execute on function ai_private.install_push_keys(text,text,jsonb) to anon;
create function public.install_push_keys(runner_key text,public_key text,private_key jsonb) returns boolean language sql security invoker set search_path='' as $$ select ai_private.install_push_keys(runner_key,public_key,private_key) $$;
revoke all on function public.install_push_keys(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.install_push_keys(text,text,jsonb) to anon;

create function ai_private.enqueue_push_reminders() returns void language plpgsql security definer set search_path='' as $$
declare d public.push_devices; local_now timestamp; local_day date; record_day date:=(now() at time zone 'America/Sao_Paulo')::date; scheduled timestamptz; kind text; count_created integer:=0;
begin
 if not exists(select 1 from ai_private.push_settings where singleton and enabled and private_key_id is not null) then return;end if;
 for d in select * from public.push_devices where enabled and (training_enabled or diary_enabled) loop
  local_now:=now() at time zone d.time_zone;local_day:=local_now::date;
  foreach kind in array array['training','diary'] loop
   if kind='training' and not d.training_enabled or kind='diary' and not d.diary_enabled then continue;end if;
   scheduled:=(local_day+case when kind='training' then d.training_time else d.diary_time end) at time zone d.time_zone;
   if now()<scheduled or now()>=scheduled+interval '30 minutes' or d.updated_at>scheduled then continue;end if;
   if kind='diary' and exists(select 1 from public.daily_recovery where user_id=d.user_id and day=record_day) then continue;end if;
   if kind='training' then
    if ai_private.recovery_alert(d.user_id) or exists(select 1 from public.runner_profiles where user_id=d.user_id and not deleted and draft->>'pain' in('current','return')) then continue;end if;
    if not exists(select 1 from public.training_preferences p join public.training_sessions s on s.user_id=p.user_id and s.plan_id=p.active_plan_id where p.user_id=d.user_id and not p.deleted and not s.deleted and s.date=record_day and not exists(select 1 from public.diary_entries e where e.user_id=s.user_id and e.id=s.id and not e.deleted)) then continue;end if;
   end if;
   insert into ai_private.push_deliveries(device_id,kind,day,expires_at) values(d.id,kind,record_day,scheduled+interval '30 minutes') on conflict do nothing;
   if found then count_created:=count_created+1;end if;
   if count_created>=100 then return;end if;
  end loop;
 end loop;
 -- Retain delivery metadata for 30 days; no message content is stored.
 delete from ai_private.push_deliveries where created_at<now()-interval '30 days' and status<>'processing';
end $$;
revoke all on function ai_private.enqueue_push_reminders() from public,anon,authenticated;

create function ai_private.claim_push_reminder(runner_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg ai_private.push_settings; j ai_private.push_deliveries; d public.push_devices; key jsonb; i integer; today date:=(now() at time zone 'UTC')::date; used integer;
begin
 perform ai_private.authorize_runner(runner_key);select * into cfg from ai_private.push_settings where singleton for update;
 if not cfg.enabled or cfg.private_key_id is null then return null;end if;
 update ai_private.push_deliveries set status=case when attempts>=2 then 'failed' else 'queued' end,lease=null,lease_until=null where status='processing' and lease_until<now();
 update ai_private.push_deliveries set status='expired',finished_at=now() where status='queued' and expires_at<=now();
 if (select count(*) from ai_private.push_deliveries where status='processing')>=2 then return null;end if;
 insert into ai_private.push_usage(day) values(today) on conflict do nothing;
 select attempts into used from ai_private.push_usage where day=today for update;if used>=cfg.max_daily_attempts then return null;end if;
 for i in 1..20 loop
 select jobs.* into j from ai_private.push_deliveries jobs join public.push_devices devices on devices.id=jobs.device_id where jobs.status='queued' and jobs.due_at<=now() and devices.enabled and (jobs.kind<>'training' or devices.training_enabled) and (jobs.kind<>'diary' or devices.diary_enabled) order by jobs.created_at limit 1 for update of jobs skip locked;
 if not found then return null;end if;
 select * into d from public.push_devices where id=j.device_id;
 -- Recheck completion/symptoms immediately before dispatch, not only during scheduling.
 if j.kind='training' and exists(select 1 from public.runner_profiles where user_id=d.user_id and not deleted and draft->>'pain' in('current','return')) or j.kind='diary' and exists(select 1 from public.daily_recovery where user_id=d.user_id and day=j.day) or j.kind='training' and (ai_private.recovery_alert(d.user_id) or not exists(select 1 from public.training_preferences p join public.training_sessions s on s.user_id=p.user_id and s.plan_id=p.active_plan_id where p.user_id=d.user_id and not p.deleted and not s.deleted and s.date=j.day and not exists(select 1 from public.diary_entries e where e.user_id=s.user_id and e.id=s.id and not e.deleted))) then
  update ai_private.push_deliveries set status='expired',finished_at=now() where id=j.id;continue;
 end if;
 update ai_private.push_deliveries set status='processing',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '2 minutes' where id=j.id returning * into j;
 update ai_private.push_usage set attempts=attempts+1 where day=today;
 select decrypted_secret::jsonb into key from vault.decrypted_secrets where id=cfg.private_key_id;
 return jsonb_build_object('id',j.id,'lease',j.lease,'endpoint',d.endpoint,'p256dh',d.p256dh,'auth',d.auth,'kind',j.kind,'day',j.day,'time_zone',d.time_zone,'privateKey',key,'publicKey',cfg.public_key);
 end loop;return null;
end $$;
revoke all on function ai_private.claim_push_reminder(text) from public,anon,authenticated;
grant execute on function ai_private.claim_push_reminder(text) to anon;
create function public.claim_push_reminder(runner_key text) returns jsonb language sql security invoker set search_path='' as $$ select ai_private.claim_push_reminder(runner_key) $$;
revoke all on function public.claim_push_reminder(text) from public,anon,authenticated;
grant execute on function public.claim_push_reminder(text) to anon;
create function ai_private.finish_push_reminder(runner_key text,job_id uuid,job_lease uuid,accepted boolean,invalid boolean,retryable boolean,provider_status integer) returns boolean language plpgsql security definer set search_path='' as $$
declare j ai_private.push_deliveries;
begin
 perform ai_private.authorize_runner(runner_key);select * into j from ai_private.push_deliveries where id=job_id for update;
 if not found or j.status<>'processing' or j.lease is distinct from job_lease or j.lease_until<now() then return false;end if;
 update ai_private.push_deliveries set status=case when accepted then 'accepted' when retryable and attempts<2 and expires_at>now()+interval '5 minutes' then 'queued' else 'failed' end,due_at=now()+interval '5 minutes',provider_status=finish_push_reminder.provider_status,lease=null,lease_until=null,finished_at=case when accepted or not retryable or attempts>=2 then now() else null end where id=j.id;
 update public.push_devices set enabled=case when invalid then false else enabled end,last_status=provider_status,last_sent_at=case when accepted then now() else last_sent_at end where id=j.device_id;
 return true;
end $$;
revoke all on function ai_private.finish_push_reminder(text,uuid,uuid,boolean,boolean,boolean,integer) from public,anon,authenticated;
grant execute on function ai_private.finish_push_reminder(text,uuid,uuid,boolean,boolean,boolean,integer) to anon;
create function public.finish_push_reminder(runner_key text,job_id uuid,job_lease uuid,accepted boolean,invalid boolean,retryable boolean,provider_status integer) returns boolean language sql security invoker set search_path='' as $$ select ai_private.finish_push_reminder(runner_key,job_id,job_lease,accepted,invalid,retryable,provider_status) $$;
revoke all on function public.finish_push_reminder(text,uuid,uuid,boolean,boolean,boolean,integer) from public,anon,authenticated;
grant execute on function public.finish_push_reminder(text,uuid,uuid,boolean,boolean,boolean,integer) to anon;

create function ai_private.dispatch_push_reminders() returns void language plpgsql security definer set search_path='' as $$
declare secret text;
begin
 perform ai_private.enqueue_push_reminders();
 if not exists(select 1 from ai_private.push_settings where singleton and enabled) or not exists(select 1 from ai_private.push_deliveries where status='queued' and due_at<=now() and expires_at>now() or status='processing' and lease_until<now()) then return;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='dez_voltas_ai_dispatch';
 perform net.http_post(url:='https://dez-voltas.pages.dev/api/internal/push-runner',headers:=jsonb_build_object('Content-Type','application/json','x-dv-runner-key',secret),body:='{}'::jsonb,timeout_milliseconds:=90000);
end $$;
revoke all on function ai_private.dispatch_push_reminders() from public,anon,authenticated;
create function ai_private.test_push_device(device_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare d public.push_devices; today date:=(now() at time zone 'UTC')::date; used integer;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 select * into d from public.push_devices where id=device_id and user_id=auth.uid() and enabled for update;
 if not found then raise exception 'PUSH_NOT_READY' using errcode='P0001';end if;
 if exists(select 1 from ai_private.push_deliveries where push_deliveries.device_id=d.id and kind='test' and status in('queued','processing')) then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('push-test:'||auth.uid()::text,0));
 insert into ai_private.push_test_usage(user_id,day) values(auth.uid(),today) on conflict do nothing;
 select attempts into used from ai_private.push_test_usage where user_id=auth.uid() and day=today for update;
 if used>=5 then raise exception 'PUSH_TEST_LIMIT' using errcode='P0001';end if;
 update ai_private.push_test_usage set attempts=attempts+1 where user_id=auth.uid() and day=today;
 insert into ai_private.push_deliveries(device_id,kind,day) values(d.id,'test',(now() at time zone d.time_zone)::date);
 perform ai_private.dispatch_push_reminders();return true;
end $$;
revoke all on function ai_private.test_push_device(uuid) from public,anon,authenticated;
grant execute on function ai_private.test_push_device(uuid) to authenticated;
create function public.test_push_device(device_id uuid) returns boolean language sql security invoker set search_path='' as $$ select ai_private.test_push_device(device_id) $$;
revoke all on function public.test_push_device(uuid) from public,anon,authenticated;
grant execute on function public.test_push_device(uuid) to authenticated;
-- Provision keys and activate the scheduler only after deployment; no user is opted in by this script.
