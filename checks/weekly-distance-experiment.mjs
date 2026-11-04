import assert from 'node:assert/strict';
import {weeklyFixture,prepareFixture} from '../scripts/weekly-review-fixture.mjs';
import {generateSuggestion,trainingCalendar,phaseCalendar,handleApi} from '../server/api.js';
import {easyWorkouts} from './workout-fixtures.mjs';
import {renderDistanceExperiment} from '../scripts/render-distance-experiment.mjs';
const fixture=weeklyFixture(),prepared=prepareFixture(fixture).prepared;
const profile={...prepared.profile,review:{...prepared.profile.review,maxWeeklyKm:15,maxSessionKm:6}};
const env={APP_ORIGIN:'https://app.example',SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'public',GEMINI_API_KEY:'private-key',GEMINI_MODEL:'gemini-test'};
const model=easyWorkouts({summary:'Proposta concreta',feasibility:'Reavaliar o objetivo conforme os registros.',warnings:[],phases:phaseCalendar(profile).map(()=>({title:'Fase',focus:'Continuidade'})),weeks:trainingCalendar(profile).map(w=>({start:w.start,focus:'Consolidação',sessions:w.availableDates.map(date=>({date,title:'Rodagem',km:5.5,minutes:35,rpe:3,long:false,instructions:'Conversa confortável'}))}))});
let sent,calls=0;
const response=()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'not-for-output'},{text:JSON.stringify(model)}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:20}});
const provider=async(url,options)=>{calls++;sent=JSON.parse(options.body);return response();};
await assert.rejects(generateSuggestion(profile,env,prepared.evidence,{fetchImpl:provider}),/volume/);
const result=await generateSuggestion(profile,env,prepared.evidence,{fetchImpl:provider,diagnostic:true});
const input=JSON.parse(sent.contents[0].parts[0].text);
assert.equal(input.profile.review.maxWeeklyKm,undefined);assert.equal(input.weeklyReview.limits.maxWeeklyKm,undefined);
assert.ok(input.calendar.every(w=>w.weeklyKmCeiling===undefined));assert.equal(input.profile.review.maxRpe,4);
assert.ok(!sent.systemInstruction.parts[0].text.includes('weeklyKmCeiling'));
assert.ok(!sent.systemInstruction.parts[0].text.includes('Na primeira semana não exceda'));
assert.equal(result.result.diagnostic.proposal.weeks[0].totalKm,16.5);
assert.equal(result.result.diagnostic.validation.accepted,true);assert.equal(result.result.plan,null);
assert.equal(result.result.diagnostic.adoptable,false);assert.equal(profile.review.maxWeeklyKm,15);
const report={job:{result:result.result,model:env.GEMINI_MODEL,attempts:1,input_tokens:10,output_tokens:20}};
const html=renderDistanceExperiment(report);assert.ok(html.includes('16,5 km'));assert.ok(html.includes('Texto integral retornado'));
const malicious=structuredClone(report);malicious.job.result.diagnostic.proposal.summary='</script><img src=x onerror=alert(1)>';
assert.ok(!renderDistanceExperiment(malicious).includes('</script><img'));
assert.ok(result.result.diagnostic.text.includes('Proposta concreta'));assert.ok(!JSON.stringify(result).includes('not-for-output'));assert.ok(!JSON.stringify(result).includes(env.GEMINI_API_KEY));
model.weeks[0].sessions[0].rpe=5;
const invalid=await generateSuggestion(profile,env,prepared.evidence,{fetchImpl:provider,diagnostic:true});
assert.equal(invalid.result.diagnostic.validation.accepted,false);assert.ok(invalid.result.diagnostic.text.includes('"rpe":5'));assert.ok(invalid.result.diagnostic.proposal);
model.weeks[0].sessions[0].rpe=3;
const incomplete=await generateSuggestion(profile,env,prepared.evidence,{fetchImpl:async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{"partial":true'}]}}]}),diagnostic:true});
assert.equal(incomplete.result.diagnostic.text,'{"partial":true');assert.equal(incomplete.result.diagnostic.validation.accepted,false);

// Only the runner's server-owned context activates the experiment; no new public endpoint.
let finished;globalThis.fetch=async(url,options)=>{
 if(url.endsWith('/claim_ai_generation'))return Response.json({id:'job',lease:'lease',kind:'weekly_review',profile:fixture.context.profile,context:{...fixture.context,diagnostic:{mode:'without-weekly-distance-ceiling'}}});
 if(url.includes(':generateContent'))return response();
 if(url.endsWith('/finish_ai_generation')){finished=JSON.parse(options.body);return Response.json(true);}
 throw Error('Unexpected endpoint '+url);
};
const runner=new Request(env.APP_ORIGIN+'/api/internal/ai-runner',{method:'POST',headers:{'x-dv-runner-key':'a'.repeat(64)}});
assert.equal((await handleApi(runner,env)).status,200);assert.equal(finished.job_result.diagnostic.adoptable,false);assert.equal(finished.job_result.plan,null);
assert.equal(calls,3);
console.log('PASS: experimento remove teto semanal do pedido, preserva demais limites e resposta rejeitada/incompleta, não é adotável e só é ativado pelo contexto interno da tarefa.');
