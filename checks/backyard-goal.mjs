import assert from 'node:assert/strict';
import {validateProfile,validateStoredProfile,validateSuggestion,backyardKm,backyardLaps,addDate} from '../dist/training-contract.js';
import {checkedSuggestion,suggestionId,validatePlanArchive} from '../dist/active-plan.js';
import {documentRows,rowsDocument} from '../dist/relational-contract.js';
import {prepareWeeklyReview} from '../dist/weekly-contract.js';
import {weeklyFixture} from '../scripts/weekly-review-fixture.mjs';
import {generateSuggestion,handleApi,trainingCalendar,phaseCalendar} from '../server/api.js';
import {trainingStore} from '../server/training-store.js';
import {easyWorkouts} from './workout-fixtures.mjs';

const today='2026-11-03',legacy={goal:'backyard',target:20,startDate:today,targetDate:addDate(today,120),weeklyKm:20,longestKm:8,weeksConsistent:8,days:[1,3,5,6],maxMinutes:60,longMinutes:90,pain:'none',consent:true};
const profile=validateProfile(legacy,today);
assert.equal(backyardLaps({target:'',targetUnit:'km'}),'','An unfinished goal stays blank');
assert.equal(profile.target,134.112);assert.equal(profile.targetUnit,'km');assert.equal(backyardLaps(profile),20);
assert.deepEqual(validateStoredProfile(profile),profile,'Canonical goals cannot be multiplied twice');
for(const laps of [1,2,20,48]){
 const p=validateProfile({...legacy,target:backyardKm(laps),targetUnit:'km'},today);
 assert.equal(backyardLaps(p),laps);assert.equal(p.target,backyardKm(laps));
}
for(const patch of [{target:0},{target:49},{target:20.5},{target:'20'},{target:20,targetUnit:'km'},{target:134.113,targetUnit:'km'},{target:134.112,targetUnit:'miles'}])assert.throws(()=>validateProfile({...legacy,...patch},today));
assert.equal(validateProfile({...legacy,goal:'distance',target:20},today).target,20);
assert.equal(validateProfile({...legacy,goal:'time',target:20},today).target,20);

const raw=easyWorkouts({summary:'Base',feasibility:'Reavaliar a meta backyard de 134,112 km.',warnings:[],phases:phaseCalendar(profile).map(p=>({...p,title:'Preparação',focus:'Continuidade até a prova.'})),weeks:trainingCalendar(profile).map(w=>({start:w.start,totalKm:5,focus:'Confortável.',sessions:w.availableDates.slice(0,1).map(date=>({date,title:'Rodagem',km:5,minutes:35,rpe:3,long:false,instructions:'Conversa confortável.'}))}))});
const plan=validateSuggestion(raw,profile),result={version:1,profile,plan,generatedAt:'2026-11-03T12:00:00Z',model:'test'};
const oldProfile={...profile,target:20};delete oldProfile.targetUnit;
const oldResult={...result,profile:oldProfile};
// Compute the historical FNV identity from its original, laps-based representation.
let hash=2166136261;const text='owner'+JSON.stringify(oldResult);for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
const oldId='ai-'+Date.parse(result.generatedAt).toString(36)+'-'+(hash>>>0).toString(36);
assert.equal(suggestionId(result,'owner'),oldId);assert.equal(suggestionId(oldResult,'owner'),oldId);
const archive=validatePlanArchive({version:1,owner:'owner',plans:[{...oldResult,id:oldId,owner:'owner',active:true}]});
assert.equal(archive.plans[0].profile.target,134.112);
const doc={version:1,profile:oldResult,draft:legacy,archive,state:{version:1,logs:{},checklist:{},timer:null}};
const rows=documentRows(doc,'owner');assert.equal(rows.get('profiles:profile').data.draft.target,134.112);assert.equal(rows.get('plans:'+oldId).data.profile.target,134.112);
assert.equal(rowsDocument(rows,'owner').archive.plans[0].id,oldId);
assert.equal(checkedSuggestion(oldResult).profile.target,134.112);
const fixture=weeklyFixture(today),review=prepareWeeklyReview({...fixture.context,profile:{...fixture.context.profile,goal:'backyard',target:20}},today);
assert.equal(review.profile.target,134.112);assert.equal(review.profile.targetUnit,'km');

let payload;await generateSuggestion(legacy,{GEMINI_MODEL:'gemini-test',GEMINI_API_KEY:'secret'},null,{fetchImpl:async(url,options)=>{payload=JSON.parse(options.body);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...raw,phases:raw.phases.map(({title,focus})=>({title,focus}))})}]}}]});}});
const input=JSON.parse(payload.contents[0].parts[0].text);
assert.equal(input.profile.target,134.112);assert.equal(input.profile.targetUnit,'km');
assert.deepEqual(input.objective,{discipline:'backyard',target:{value:134.112,unit:'km'},lapDistanceKm:6.7056,startIntervalMinutes:60});
assert.match(payload.systemInstruction.parts[0].text,/nunca trate target como número de voltas/);

const env={APP_ORIGIN:'https://app.example',SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'public',GEMINI_API_KEY:'secret',GEMINI_MODEL:'gemini-test'};
let admitted=0;
globalThis.fetch=async(url,options)=>{
 if(url.endsWith('/user'))return Response.json({id:'owner',email_confirmed_at:'2026-01-01'});
 if(url.endsWith('/enqueue_ai_generation')){admitted++;const body=JSON.parse(options.body);assert.equal(body.job_profile.target,134.112);return Response.json({id:'job',status:'queued'});}
 throw Error('Unexpected endpoint '+url);
};
const request=(body,format='3')=>new Request(env.APP_ORIGIN+'/api/training/suggest',{method:'POST',headers:{origin:env.APP_ORIGIN,cookie:'__Host-dv-access=access','content-type':'application/json','x-dv-training-format':format},body:JSON.stringify(body)});
// API dates are anchored to the current day, independently of deterministic fixtures above.
const {localToday}=await import('../dist/training-contract.js');const current={...legacy,startDate:localToday(),targetDate:addDate(localToday(),120)};
assert.equal((await handleApi(request(current),env)).status,400);
assert.equal((await handleApi(request(validateProfile(current),'2'),env)).status,426);
assert.equal(admitted,0);assert.equal((await handleApi(request(validateProfile(current)),env)).status,202);assert.equal(admitted,1);
globalThis.fetch=async()=>Response.json({initialized:true,cursor:1,rows:[{kind:'profiles',data:{draft:profile}}]});
const storeArgs={env,user:{id:'owner'},access:'access',fail:(status,message)=>Object.assign(Error(message),{status})};
await assert.rejects(trainingStore({...storeArgs,request:new Request(env.APP_ORIGIN+'/api/account/sync',{headers:{'x-dv-training-format':'2'}})}),e=>e.status===426);
assert.equal((await trainingStore({...storeArgs,request:new Request(env.APP_ORIGIN+'/api/account/sync',{headers:{'x-dv-training-format':'3'}})})).cursor,1);
let initialized=0;
globalThis.fetch=async(url)=>{
 if(url.endsWith('/rpc/read_training_store'))return Response.json({initialized:false,rows:[]});
 if(url.includes('/account_data?'))return Response.json([{revision:1,document:doc}]);
 if(url.endsWith('/rpc/initialize_training_store')){initialized++;return Response.json({initialized:true,rows:[],cursor:1});}
 throw Error('Unexpected endpoint '+url);
};
await assert.rejects(trainingStore({...storeArgs,request:new Request(env.APP_ORIGIN+'/api/account/sync',{headers:{'x-dv-training-format':'2'}})}),e=>e.status===426);
assert.equal(initialized,0,'An old client cannot initialize the new representation accidentally');
console.log('PASS: 20 voltas = 134,112 km, limites/precisão, leitura antiga idempotente, IDs/diário/sincronização preservados, revisão e Gemini em km, bloqueio de clientes antigos.');
