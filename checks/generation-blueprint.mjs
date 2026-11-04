import assert from 'node:assert/strict';
import {weeklyFixture} from '../scripts/weekly-review-fixture.mjs';
import {prepareWeeklyReview} from '../dist/weekly-contract.js';
import {addDate} from '../dist/training-contract.js';
import {trainingBlueprint,compileBlueprintResponse} from '../server/training-blueprint.js';
import {assessGeneratedPlan} from '../server/generation-validation.js';
import {trainingCalendar,phaseCalendar,attachPhaseDates,generateSuggestion} from '../server/api.js';
import {blueprintResponse} from './blueprint-fixture.mjs';
const base='2026-11-04';let cases=0,qualityCases=0;
for(let offset=0;offset<7;offset++)for(const goal of ['distance','time','backyard'])for(const reduce of [false,true])for(const partial of [false,true]){
 const today=addDate(base,offset),ctx=weeklyFixture(today).context;
 ctx.profile={...ctx.profile,goal,target:goal==='time'?120:goal==='backyard'?134.112:21.1,...(goal==='backyard'?{targetUnit:'km'}:{}),targetDate:addDate(today,partial?12:150),details:{registrationCompleted:true,experience:'returning',experienceMonths:30,recentRuns:3,longDay:6,intensity:{recentQuality:'occasional',qualityWeeks:null,fatigue:2,sleep:4,restriction:'none',preference:'balanced'}}};
 ctx.checkin={...ctx.checkin,days:[1,3,5,6],fatigue:reduce?4:2};
 const profile=prepareWeeklyReview(ctx,today).profile,calendar=trainingCalendar(profile),snapshot=structuredClone(profile);
 const blueprint=trainingBlueprint(profile,calendar),input={sessionBlueprint:blueprint,phases:phaseCalendar(profile)},raw=blueprintResponse(input);
 const compiled=compileBlueprintResponse(raw,blueprint),checked=assessGeneratedPlan(attachPhaseDates(compiled,profile),profile);
 assert.ok(checked.plan,JSON.stringify({offset,goal,reduce,partial,issues:checked.issues,blueprint}));
 assert.deepEqual(profile,snapshot);assert.ok(!JSON.stringify(raw).includes('"blocks"'));
 for(const w of checked.plan.weeks){assert.ok(w.sessions.every(s=>s.minutes>=3));assert.equal(w.sessions.length,profile.days.filter(d=>calendar.find(c=>c.start===w.start).availableDates.some(date=>new Date(date+'T12:00:00Z').getUTCDay()===d)).length);}
 const quality=blueprint.weeks.flatMap(w=>w.slots).filter(s=>s.role==='quality');if(quality.length)qualityCases++;
 if(reduce||partial)assert.equal(quality.length,0);
 if(quality.length>=2){const bad=structuredClone(raw);for(const w of bad.weeks)for(const s of w.sessions)if(['fartlek','interval','tempo'].includes(s.type))s.type='fartlek';assert.throws(()=>compileBlueprintResponse(bad,blueprint),/Varie/);}
 const missing=structuredClone(raw);missing.weeks[0].sessions.pop();assert.throws(()=>compileBlueprintResponse(missing,blueprint),/slot/);
 const swapped=structuredClone(raw);swapped.weeks[0].sessions[0].slotId='invented';assert.throws(()=>compileBlueprintResponse(swapped,blueprint),/slot/);
 cases++;
}
assert.ok(qualityCases>0);
const ctx=weeklyFixture(base).context,prepared=prepareWeeklyReview(ctx,base);let calls=0;
const out=await generateSuggestion(prepared.profile,{GEMINI_MODEL:'gemini-test',GEMINI_API_KEY:'private'},prepared.evidence,{diagnostic:'progressive-review-preview',reserveCorrection:async()=>true,fetchImpl:async(url,options)=>{
 const sent=JSON.parse(options.body),input=JSON.parse(sent.contents[0].parts[0].text),answer=blueprintResponse(input);calls++;
 assert.ok(!JSON.stringify(sent.generationConfig.responseJsonSchema).includes('"blocks"'));assert.ok(Buffer.byteLength(options.body)<60000);
 if(calls===1)answer.weeks[0].sessions[0].slotId='invented';
 else assert.match(sent.contents.at(-1).parts[0].text,/slot/);
 return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(answer)}]}}]});
}});
assert.equal(calls,2);assert.equal(out.result.diagnostic.validation.accepted,true);assert.equal(out.result.plan,null);
assert.ok(out.result.diagnostic.input.sessionBlueprint);assert.ok(out.result.diagnostic.attempts[0].text.includes('invented'));
console.log(`PASS: ${cases} calendários/objetivos/recuperação/semanas parciais, montagem dentro dos limites, variedade obrigatória, slots ausentes/inventados e correção com retorno bruto preservado.`);
