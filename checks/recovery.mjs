import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRecovery,recoveryDay,recoverySummary} from '../dist/recovery-contract.js';
import {createRecoverySync} from '../dist/recovery-sync.js';
import {dailyRecoveryEvidence,prepareWeeklyReview,validateWeeklyCheckin} from '../dist/weekly-contract.js';
import {handleApi} from '../server/api.js';
import {validateProfile,addDate,localToday} from '../dist/training-contract.js';
const day=localToday(),report={fatigue:2,sleep:4,readiness:4,pain:'none',illness:false,painLocation:'',notes:'Descanso sem corrida',activity:{type:'none',minutes:0,rpe:null}};
assert.deepEqual(validateRecovery(report),report);
for(const patch of [{fatigue:0},{sleep:6},{readiness:null},{pain:'unknown'},{illness:1},{notes:'x'.repeat(501)},{activity:{type:'bike',minutes:0,rpe:5}}])assert.throws(()=>validateRecovery({...report,...patch}));
assert.throws(()=>recoveryDay(addDate(day,1)));assert.throws(()=>recoveryDay(addDate(day,-28)));assert.equal(recoveryDay(addDate(day,-27)),addDate(day,-27));
const storage=new Map(),remote=new Map(),seen=new Map();let offline=false,loseAck=false,release=null,waitPost=false,requests=0;
const req=async(owner,body)=>{
 if(offline)throw Error('offline');requests++;
 if(!body)return {records:[...remote.values()].filter(x=>x.owner===owner).map(({owner,...x})=>x)};
 const key=owner+':'+body.day,old=remote.get(key);
 if(seen.has(owner+':'+body.mutationId))return {record:seen.get(owner+':'+body.mutationId)};
 if((old?.revision||0)!==body.revision)throw Object.assign(Error('conflict'),{status:409,record:old});
 if(waitPost){waitPost=false;await new Promise(r=>release=r);}
 const saved={day:body.day,report:structuredClone(body.report),revision:(old?.revision||0)+1,updatedAt:new Date().toISOString()};remote.set(key,{...saved,owner});seen.set(owner+':'+body.mutationId,saved);
 if(loseAck){loseAck=false;throw Error('response lost');}return {record:saved};
};
const create=()=>createRecoverySync({request:req,read:k=>storage.get(k),write:(k,v)=>storage.set(k,v),uuid:randomUUID});
const sync=create();sync.select('a');offline=true;sync.save(day,report);await sync.sync();assert.equal(sync.entries()[0].pending,true);assert.equal(requests,0);assert.equal(sync.ready(),false);
const reopened=create();reopened.select('a');assert.equal(reopened.entries()[0].report.notes,report.notes);
offline=false;await reopened.sync();assert.equal(reopened.ready(),true);assert.equal(remote.get('a:'+day).revision,1);
// Lost acknowledgement plus another edit must replay the original id before sending the new edit.
loseAck=true;reopened.save(day,{...report,notes:'First edit'});await reopened.sync();assert.equal(reopened.ready(),false);
reopened.save(day,{...report,notes:'Latest edit'});await reopened.sync();assert.equal(remote.get('a:'+day).revision,3);assert.equal(remote.get('a:'+day).report.notes,'Latest edit');assert.equal(reopened.ready(),true);
// Edits during an in-flight upload are not lost.
waitPost=true;reopened.save(day,{...report,notes:'In flight'});const flight=reopened.sync();while(!release)await new Promise(r=>setTimeout(r,0));reopened.save(day,{...report,notes:'Typed while sending'});release();await flight;
assert.equal(remote.get('a:'+day).report.notes,'Typed while sending');
// Another device requires an explicit choice, not a silent overwrite.
reopened.save(day,{...report,notes:'Local value'});const latest=remote.get('a:'+day);remote.set('a:'+day,{...latest,revision:latest.revision+1,report:{...report,notes:'Other device'}});
await reopened.sync();assert.equal(reopened.conflict(day),true);assert.equal(reopened.entries()[0].report.notes,'Local value');
reopened.resolve(day,true);await reopened.sync();assert.equal(remote.get('a:'+day).report.notes,'Local value');
reopened.save(day,{...report,notes:'Discarded local'});const latest2=remote.get('a:'+day);remote.set('a:'+day,{...latest2,revision:latest2.revision+1,report:{...report,notes:'Keep cloud'}});await reopened.sync();reopened.resolve(day,false);assert.equal(reopened.entries()[0].report.notes,'Keep cloud');
reopened.select('b');assert.equal(reopened.entries().length,0);reopened.select('a');assert.equal(reopened.entries()[0].report.notes,'Keep cloud');
// A delayed response is isolated after a switch to another account.
let unlock;const late=createRecoverySync({request:()=>new Promise(r=>unlock=r),read:()=>null,write(){},uuid:randomUUID});late.select('a');const waiting=late.sync();late.select('b');unlock({records:[{day,report,revision:1}]});await waiting;assert.equal(late.entries().length,0);
const start=addDate(day,-7),end=addDate(day,-1),consent=validateWeeklyCheckin({fatigue:2,sleep:4,readiness:4,pain:'none',illness:false,complete:true,consent:true,recoveryConsent:true,days:[0,2,4],maxMinutes:60,longMinutes:90,notes:''});
const daily=Array.from({length:14},(_,i)=>({date:addDate(start,i-7),...report}));
let evidence=dailyRecoveryEvidence({dailyRecoveryConsent:true,dailyRecovery:daily},consent,start,end);assert.equal(evidence.good,true);assert.equal(evidence.recordedDays,7);
assert.equal(dailyRecoveryEvidence({dailyRecovery:daily},consent,start,end).good,false,'Missing daily evidence never establishes good recovery');
assert.equal(dailyRecoveryEvidence({dailyRecovery:daily},{...consent,recoveryConsent:false},start,end),null);
const heavy=structuredClone(daily);heavy.at(-1).activity={type:'strength',minutes:50,rpe:8};assert.equal(dailyRecoveryEvidence({dailyRecoveryConsent:true,dailyRecovery:heavy},consent,start,end).good,false);
const tired=structuredClone(daily);tired.at(-1).fatigue=4;tired.at(-2).fatigue=4;assert.equal(dailyRecoveryEvidence({dailyRecoveryConsent:true,dailyRecovery:tired},consent,start,end).reduce,true);
const pain=structuredClone(daily);pain.at(-1).pain='mild';assert.equal(dailyRecoveryEvidence({dailyRecoveryConsent:true,dailyRecovery:pain},consent,start,end).blocked,true);
assert.equal(recoverySummary([{day,report}],day,day).activityMinutes,0);
// The full weekly decision uses the daily evidence without adding other activity to running km.
const oldProfile=validateProfile({goal:'distance',target:21,startDate:addDate(day,-28),targetDate:addDate(day,120),weeklyKm:20,longestKm:10,weeksConsistent:8,days:[0,2,4],maxMinutes:60,longMinutes:100,pain:'none',consent:true},addDate(day,-28));
const runs=Array.from({length:3},(_,i)=>({id:'s'+i,date:addDate(start,i*2),km:5,minutes:35,rpe:3,pain:'none',notes:''}));
const weeklyContext={profile:oldProfile,sourcePlanId:'ai-test-daily',weekStart:start,weekEnd:end,checkin:consent,previousCheckin:consent,currentPain:'none',planned:runs,logs:[...runs,...runs.map(x=>({...x,id:'previous-'+x.id,date:addDate(x.date,-7)}))],dailyRecoveryConsent:true,dailyRecovery:daily};
assert.equal(prepareWeeklyReview(weeklyContext,day).profile.review.decision,'increase');
assert.equal(prepareWeeklyReview({...weeklyContext,dailyRecovery:[]},day).profile.review.decision,'hold');
assert.equal(prepareWeeklyReview({...weeklyContext,dailyRecovery:tired},day).profile.review.decision,'reduce');
assert.throws(()=>prepareWeeklyReview({...weeklyContext,dailyRecovery:pain},day),/check-in diário/);
const preparedDaily=prepareWeeklyReview({...weeklyContext,dailyRecovery:heavy},day);assert.equal(preparedDaily.profile.weeklyKm,15);assert.equal(preparedDaily.profile.review.decision,'hold');
assert.equal(preparedDaily.evidence.dailyRecovery.activityMinutes,50);assert.equal(preparedDaily.evidence.dailyRecovery.reports[0].notes,'');
assert.equal(prepareWeeklyReview({...weeklyContext,checkin:{...consent,recoveryConsent:false}},day).evidence.dailyRecovery,undefined);
// API ownership, origin, validation and conflict payload; saving never calls Gemini.
const env={APP_ORIGIN:'https://example.com',SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'pub'};let mismatch=false,conflict=false,calls=[];
globalThis.fetch=async(url,options={})=>{calls.push(url);if(url.endsWith('/user'))return Response.json({id:'a',email_confirmed_at:day});if(url.endsWith('/read_daily_recovery'))return Response.json([]);if(url.endsWith('/save_daily_recovery')){if(conflict)return Response.json({code:'40001'},{status:400});const body=JSON.parse(options.body);return Response.json({day:body.record_day,...body.report_data,pain_location:body.report_data.painLocation,activity_type:'none',activity_minutes:0,activity_rpe:null,revision:1,updated_at:new Date().toISOString()});}throw Error('Unexpected endpoint');};
const body={day,report,revision:0,mutationId:randomUUID()};
const request=(payload,origin=env.APP_ORIGIN,id='a')=>new Request(env.APP_ORIGIN+'/api/recovery/daily',{method:'POST',headers:{origin,'content-type':'application/json','x-account-id':id,cookie:'__Host-dv-access=access'},body:JSON.stringify(payload)});
assert.equal((await handleApi(request(body),env)).status,200);assert.equal((await handleApi(request(body,'https://bad.example'),env)).status,403);assert.equal((await handleApi(request(body,env.APP_ORIGIN,'b'),env)).status,409);
assert.equal((await handleApi(request({...body,report:{...report,sleep:9}}),env)).status,400);conflict=true;assert.equal((await handleApi(request(body),env)).status,409);
assert.ok(calls.every(x=>!x.includes('generateContent')));
console.log('PASS: diário opcional sem corrida; validação, offline/reabertura, envio individual, resposta perdida, edição em voo, conflito explícito, isolamento, consentimento, recuperação incompleta/dor/fadiga e API sem chamada ao Gemini.');
