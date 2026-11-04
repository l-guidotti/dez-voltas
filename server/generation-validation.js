import {validateSuggestion,reviewWeekLimits} from '../dist/training-contract.js';
import {validateWorkout,workoutStats,intensityPolicy,validateWorkoutSchedule,qualityTypes} from '../dist/workout-contract.js';

// Only at the provider boundary: blocks are the source of truth for duration.
// Never resize blocks, change efforts/dates, or relax a constraint to make a plan pass.
export function assessGeneratedPlan(raw,profile){
 const proposal=structuredClone(raw),issues=[],policy=intensityPolicy(profile),audit=[];
 const add=(path,message)=>{if(issues.length<40)issues.push({path,message});};
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 let workoutsValid=true;
 for(const [i,week] of (Array.isArray(proposal?.weeks)?proposal.weeks:[]).entries()){
  const path=`weeks[${i}]`,limits=reviewWeekLimits(profile,i);
  if(!Array.isArray(week?.sessions))continue;
  for(const [j,s] of week.sessions.entries()){
   try{
    const blocks=s?.workout?.blocks;
    if(!Array.isArray(blocks)||!blocks.length||!blocks.every(b=>b&&['minutes','repeats','recoveryMinutes'].every(k=>finite(b[k]))))throw Error('Etapas ausentes ou números inválidos.');
    s.minutes=workoutStats(s.workout).minutes;
    validateWorkout(s.workout,s,policy);
   }catch(e){workoutsValid=false;add(`${path}.sessions[${j}].workout`,e instanceof TypeError?'Etapas inválidas.':e.message);}
   if(s&&finite(s.minutes)&&s.minutes>Math.min(s.long?profile.longMinutes:profile.maxMinutes,limits?.maxSessionMinutes??Infinity)+.05)add(`${path}.sessions[${j}]`,'A soma dos blocos excede o tempo disponível por sessão.');
   if(limits&&s&&finite(s.km)&&s.km>limits.maxSessionKm+.05)add(`${path}.sessions[${j}].km`,`Distância excede ${limits.maxSessionKm} km por sessão.`);
  }
  const sum=fn=>week.sessions.every(s=>s&&finite(fn(s)))?week.sessions.reduce((n,s)=>n+fn(s),0):null;
  const totals={week:i+1,km:sum(s=>s.km),minutes:sum(s=>s.minutes),load:sum(s=>finite(s.minutes)&&finite(s.rpe)?s.minutes*s.rpe:NaN)};
  audit.push(totals);
  const kmCeiling=limits?.maxWeeklyKm??Math.max(profile.weeklyKm,6)*1.15**i;
  if(totals.km!==null&&totals.km>kmCeiling+.05)add(path,`Distância ${totals.km.toFixed(2)} km excede ${kmCeiling.toFixed(2)} km.`);
  if(limits){
   if(totals.minutes!==null&&totals.minutes>limits.maxWeeklyMinutes+.05)add(path,`Duração ${totals.minutes.toFixed(2)} min excede ${limits.maxWeeklyMinutes.toFixed(2)} min.`);
   if(totals.load!==null&&totals.load>limits.maxLoad+.05)add(path,`Carga minutos×RPE ${totals.load.toFixed(2)} excede ${limits.maxLoad.toFixed(2)}.`);
  }
 }
 const sessions=(Array.isArray(proposal?.weeks)?proposal.weeks:[]).flatMap(w=>Array.isArray(w?.sessions)?w.sessions:[]).filter(Boolean);
 for(const s of sessions.filter(s=>qualityTypes.includes(s.workout?.type))){
  const conflicts=sessions.filter(x=>x.long&&Math.abs(Date.parse(x.date)-Date.parse(s.date))/86400000<2);
  if(conflicts.length)add('weeks',`Qualidade em ${s.date} deve ficar a pelo menos 2 dias do longo em ${conflicts.map(x=>x.date).join(', ')}.`);
 }
 if(workoutsValid&&Array.isArray(proposal?.weeks)&&proposal.weeks.every(w=>Array.isArray(w?.sessions))){
  try{validateWorkoutSchedule(proposal.weeks,profile,policy);}catch(e){add('weeks',e instanceof TypeError?'Calendário inválido.':e.message);}
 }
 let plan=null;
 try{plan=validateSuggestion(proposal,profile,{requireWorkouts:true,deriveTotals:true});}catch(e){add('plan',e instanceof TypeError?'Formato do plano inválido.':e.message);}
 // The existing validator is authoritative, including its numeric tolerances.
 return {proposal,plan,issues:plan?[]:issues,audit};
}
