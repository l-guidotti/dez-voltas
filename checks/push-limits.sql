-- Rollback: test dispatch requests are never committed or sent.
begin;
do $$
declare u uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); prefs jsonb:='{"training":false,"diary":true,"trainingTime":"07:00","diaryTime":"20:00","timeZone":"UTC"}'; subscription jsonb; i integer;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@example.test',now());
 perform set_config('request.jwt.claim.sub',u::text,true);
 update ai_private.push_settings set enabled=true,public_key=repeat('A',87),private_key_id=gen_random_uuid();
 subscription:=jsonb_build_object('endpoint','https://web.push.apple.com/test-'||d,'keys',jsonb_build_object('p256dh',repeat('A',87),'auth',repeat('A',22)));
 perform public.save_push_device(d,subscription,prefs);
 for i in 1..5 loop
  assert public.test_push_device(d);
  assert not public.test_push_device(d),'An active test is not duplicated';
  update ai_private.push_deliveries set status='failed' where device_id=d and kind='test';
 end loop;
 begin perform public.test_push_device(d);raise exception 'Test limit missing';exception when raise_exception then if sqlerrm<>'PUSH_TEST_LIMIT' then raise;end if;end;
 perform public.remove_push_device(d);
 d:=gen_random_uuid();subscription:=jsonb_set(subscription,'{endpoint}',to_jsonb('https://web.push.apple.com/test-'||d));perform public.save_push_device(d,subscription,prefs);
 begin perform public.test_push_device(d);raise exception 'Reactivation bypassed test quota';exception when raise_exception then if sqlerrm<>'PUSH_TEST_LIMIT' then raise;end if;end;
 begin perform public.save_push_device(d,jsonb_set(subscription,'{endpoint}','"https://127.0.0.1/private"'),prefs);raise exception 'SSRF endpoint accepted';exception when invalid_parameter_value then null;end;
 begin perform public.save_push_device(d,subscription,jsonb_set(prefs,'{timeZone}','"Invalid/Zone"'));raise exception 'Timezone not checked';exception when invalid_parameter_value then null;end;
 begin perform public.claim_push_reminder(repeat('0',64));raise exception 'Missing runner authentication';exception when insufficient_privilege then null;end;
end $$;
rollback;
