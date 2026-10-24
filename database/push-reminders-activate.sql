-- Start scheduling after deployment and successful bootstrap. No account/device is automatically enrolled.
begin;
do $$ begin
 if not exists(select 1 from ai_private.push_settings where singleton and public_key is not null and private_key_id is not null) then raise exception 'Push keys not provisioned';end if;
end $$;
update ai_private.push_settings set enabled=true where singleton;
select cron.schedule('dez-voltas-push-reminders','*/5 * * * *','select ai_private.dispatch_push_reminders()');
commit;
