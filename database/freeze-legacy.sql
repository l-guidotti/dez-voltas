-- The original account document remains readable for migration/recovery.
-- Old applications must refresh instead of writing a divergent snapshot.
revoke insert, update on public.account_data from authenticated;
revoke execute on function public.save_account_data(bigint,jsonb) from authenticated;
