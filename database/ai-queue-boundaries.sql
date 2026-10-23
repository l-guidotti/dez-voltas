-- Keep privileged implementation outside the Data API schema; wrappers run as invoker.
alter function public.enqueue_ai_generation(jsonb,uuid) set schema ai_private;
alter function public.claim_ai_generation(text,text) set schema ai_private;
alter function public.finish_ai_generation(text,uuid,uuid,jsonb,text,boolean,bigint,bigint) set schema ai_private;
grant usage on schema ai_private to anon,authenticated;
create function public.enqueue_ai_generation(job_profile jsonb,client_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select ai_private.enqueue_ai_generation(job_profile,client_request_id) $$;
create function public.claim_ai_generation(runner_key text,worker_model text) returns jsonb language sql security invoker set search_path='' as $$ select ai_private.claim_ai_generation(runner_key,worker_model) $$;
create function public.finish_ai_generation(runner_key text,job_id uuid,job_lease uuid,job_result jsonb default null,job_error text default null,retryable boolean default false,tokens_in bigint default 0,tokens_out bigint default 0) returns boolean language sql security invoker set search_path='' as $$ select ai_private.finish_ai_generation(runner_key,job_id,job_lease,job_result,job_error,retryable,tokens_in,tokens_out) $$;
revoke all on function public.enqueue_ai_generation(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_ai_generation(jsonb,uuid) to authenticated;
revoke all on function public.claim_ai_generation(text,text) from public,anon,authenticated;
grant execute on function public.claim_ai_generation(text,text) to anon;
revoke all on function public.finish_ai_generation(text,uuid,uuid,jsonb,text,boolean,bigint,bigint) from public,anon,authenticated;
grant execute on function public.finish_ai_generation(text,uuid,uuid,jsonb,text,boolean,bigint,bigint) to anon;
create policy deny_direct_settings on ai_private.queue_settings for all using(false) with check(false);
create policy deny_direct_usage on ai_private.daily_usage for all using(false) with check(false);
