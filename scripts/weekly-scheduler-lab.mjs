import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {weeklyFixture} from './weekly-review-fixture.mjs';

const sqlText=s=>"'"+String(s).replace(/'/g,"''")+"'";
const json=x=>sqlText(JSON.stringify(x))+'::jsonb';
export function schedulerSeed(fixture=weeklyFixture(),uid=randomUUID()){
 if(!/^[a-f0-9-]{36}$/.test(uid)||fixture.scenario!=='hold'||fixture.context.sourcePlanId!=='ai-fiction-weekly-test')throw Error('Use apenas o cenário fictício de manutenção.');
 const c=fixture.context,email='weekly-scheduler-lab-'+uid+'@example.invalid';
 const statements=[
  'begin;',
  `insert into auth.users(id,email,email_confirmed_at) values(${sqlText(uid)},${sqlText(email)},now());`,
  `insert into public.training_plans(user_id,id,revision,sync_version,profile,plan,generated_at,model,adopted) values(${sqlText(uid)},${sqlText(c.sourcePlanId)},1,1,${json(c.profile)},${json({phases:c.existingPhases})},now()::text,'fiction-only',true);`,
  `insert into public.training_preferences(user_id,id,revision,sync_version,active_plan_id,checklist) values(${sqlText(uid)},'settings',1,1,${sqlText(c.sourcePlanId)},'{}');`
 ];
 const sessions=[...new Map([...c.logs,...c.planned,...c.upcoming.map((s,i)=>({...s,id:'fiction-upcoming-'+i}))].map(s=>[s.id,s])).values()];
 for(const s of sessions)statements.push(`insert into public.training_sessions(user_id,id,revision,sync_version,plan_id,week,date,title,km,minutes,rpe,long_run,instructions) values(${sqlText(uid)},${sqlText(s.id)},1,1,${sqlText(c.sourcePlanId)},${s.date<c.weekStart?1:s.date<=c.weekEnd?2:3},${sqlText(s.date)},'Rodagem fictícia',${s.km},${s.minutes},${s.rpe},false,'Dados fictícios para testar o cron semanal.');`);
 for(const s of c.logs)statements.push(`insert into public.diary_entries(user_id,id,revision,sync_version,km,minutes,rpe,pain,notes,recorded_at,session_date) values(${sqlText(uid)},${sqlText(s.id)},1,1,${s.km},${s.minutes},${s.rpe},${sqlText(s.pain)},${sqlText(s.notes)},now()::text,${sqlText(s.date)});`);
 for(const d of c.dailyRecovery)statements.push(`insert into public.daily_recovery(user_id,day,fatigue,sleep,readiness,pain,illness,notes,activity_type,activity_minutes,activity_rpe,last_mutation) values(${sqlText(uid)},${sqlText(d.date)},${d.fatigue},${d.sleep},${d.readiness},'none',false,${sqlText(d.notes)},'none',0,null,gen_random_uuid());`);
 statements.push(
  `select set_config('request.jwt.claim.sub',${sqlText(uid)},true);`,
  'set local role authenticated;',
  `select public.save_weekly_review(${sqlText(c.sourcePlanId)},${sqlText(c.weekStart)},${json(c.checkin)},0);`,
  'reset role;',
  `do $assert$ begin assert (select count(*)=0 from public.ai_generation_jobs where user_id=${sqlText(uid)}),'The seed must not enqueue a job directly'; end $assert$;`,
  'commit;',
  `select id,week_start,week_end,job_id,queue_error,created_at from public.weekly_checkins where user_id=${sqlText(uid)};`
 );
 return {fixture,uid,email,sql:statements.join('\n')};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)process.stdout.write(JSON.stringify(schedulerSeed()));
