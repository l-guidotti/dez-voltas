-- Generate the VAPID key inside the deployed worker; private material is stored directly in Vault.
-- This request returns only {ready:true}; do not print queued headers or decrypted secrets.
do $$
declare capability text;
begin
 select decrypted_secret into capability from vault.decrypted_secrets where name='dez_voltas_ai_dispatch';
 if capability is null then raise exception 'Worker capability not configured';end if;
 perform net.http_post(url:='https://dez-voltas.pages.dev/api/internal/push-setup',headers:=jsonb_build_object('Content-Type','application/json','x-dv-runner-key',capability),body:='{}'::jsonb,timeout_milliseconds:=90000);
end $$;
