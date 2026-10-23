-- Applied to the hosted project; account snapshots retain validated plan definitions
-- alongside logs so that restoring a device never creates orphaned workouts.
create table public.account_data (
 user_id uuid primary key references auth.users(id) on delete cascade,
 revision bigint not null default 1 check (revision > 0),
 document jsonb not null check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 2097152),
 updated_at timestamptz not null default now()
);
alter table public.account_data enable row level security;
revoke all on public.account_data from anon, authenticated;
grant select, insert, update on public.account_data to authenticated;
create policy account_read on public.account_data for select to authenticated using ((select auth.uid()) = user_id);
create policy account_insert on public.account_data for insert to authenticated with check ((select auth.uid()) = user_id);
create policy account_update on public.account_data for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Compare-and-swap is atomic. No privileged function and no user_id supplied by clients.
create function public.save_account_data(expected_revision bigint, new_document jsonb)
returns setof public.account_data language plpgsql security invoker set search_path = '' as $$
begin
 if auth.uid() is null then raise insufficient_privilege using message = 'Authentication required'; end if;
 if expected_revision = 0 then
  return query insert into public.account_data(user_id, document)
   values (auth.uid(), new_document) on conflict (user_id) do nothing returning *;
 else
  return query update public.account_data set document = new_document, revision = revision + 1, updated_at = now()
   where user_id = auth.uid() and revision = expected_revision returning *;
 end if;
end;
$$;
revoke all on function public.save_account_data(bigint,jsonb) from public, anon;
grant execute on function public.save_account_data(bigint,jsonb) to authenticated;
