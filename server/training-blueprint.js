import {reviewWeekLimits,daysBetween} from '../dist/training-contract.js';
import {intensityPolicy} from '../dist/workout-contract.js';

const floor=n=>Math.floor((n+1e-8)*10)/10;
// Capped proportional allocation, rounded down so no sum can exceed its budget.
function allocate(total,weights,caps){
 const out=weights.map(()=>0);let remaining=Math.min(total,caps.reduce((a,b)=>a+b,0));
 for(let pass=0;pass<=weights.length&&remaining>1e-8;pass++){
  const open=weights.map((_,i)=>i).filter(i=>caps[i]-out[i]>1e-8),weight=open.reduce((n,i)=>n+weights[i],0);
  if(!weight)break;
  const portions=open.map(i=>[i,Math.min(caps[i]-out[i],remaining*weights[i]/weight)]);
  for(const [i,amount]of portions){out[i]+=amount;remaining-=amount;}
 }
 return out.map(floor);
}
export function trainingBlueprint(profile,calendar){
 const policy=intensityPolicy(profile);
 const longs=calendar.map(w=>w.longDates.at(-1)||null);
 let previousQuality=null;
 const weeks=calendar.map((w,i)=>{
  const limits=reviewWeekLimits(profile,i);
  const qualityDate=policy.maxQuality?w.qualityDates.find(date=>longs.every(long=>!long||Math.abs(daysBetween(date,long))>=2)&&(!previousQuality||daysBetween(previousQuality,date)>=7)):null;
  if(qualityDate)previousQuality=qualityDate;
  const recovery=w.availableDates.filter(date=>date!==longs[i]&&date!==qualityDate).at(-1);
  const slots=w.availableDates.map((date,j)=>({id:`w${i+1}s${j+1}`,date,role:date===longs[i]?'long':date===qualityDate?'quality':date===recovery?'recovery':'easy'}));
  const weights=slots.map(s=>({long:2,quality:1.2,easy:1,recovery:.7}[s.role]));
  const kms=allocate(limits.maxWeeklyKm,weights,slots.map(()=>limits.maxSessionKm));
  let minutes=allocate(limits.maxWeeklyMinutes,weights,slots.map(s=>s.role==='long'?w.longMinutes:w.maxMinutes));
  const rpes=slots.map(s=>Math.min(s.role==='quality'||s.role==='long'?3:s.role==='recovery'?1:2,limits.maxRpe,policy.maxOverallRpe));
  const load=minutes.reduce((n,m,j)=>n+m*rpes[j],0),scale=Math.min(1,limits.maxLoad/(load||1));
  minutes=minutes.map(m=>floor(m*scale));
  return {week:i+1,start:w.start,condition:limits.condition,slots:slots.map((s,j)=>({...s,km:kms[j],minutes:minutes[j],rpe:rpes[j]}))};
 });
 // A fixed dose/pico across the block prevents accidental intensity growth as volume rises.
 const qualityWeeks=weeks.filter(w=>w.slots.some(s=>s.role==='quality'));
 const dose=Math.floor(Math.min(8,policy.maxHardMinutes));
 const types=policy.allowedTypes.filter(t=>['fartlek','interval','tempo'].includes(t)&&(t!=='tempo'||policy.maxPeakRpe>=6));
 const canQuality=qualityWeeks.length>0&&types.length>0&&dose>=6&&qualityWeeks.every(w=>w.slots.find(s=>s.role==='quality').minutes>=15+dose*1.5&&dose<=w.slots.reduce((n,s)=>n+s.minutes,0)*policy.maxHardFraction);
 for(const w of weeks)for(const s of w.slots){
  if(s.role==='quality'&&!canQuality)s.role='easy';
  if(s.minutes<3)throw Error('A disponibilidade e os limites não comportam este calendário. Revise o fechamento.');
  s.allowedTypes=s.role==='quality'?types:[s.role];
 }
 return {version:1,source:'server',qualityDoseMinutes:canQuality?dose:0,qualityPeakRpe:Math.min(6,policy.maxPeakRpe),qualityReason:canQuality?'Dose e pico constantes enquanto o volume progride.':policy.maxQuality?'O calendário ou orçamento do bloco não comporta a dose estruturada de qualidade.':policy.reason,weeks};
}
export const blueprintSchema={type:'object',properties:{summary:{type:'string'},feasibility:{type:'string'},warnings:{type:'array',items:{type:'string'}},phases:{type:'array',items:{type:'object',properties:{title:{type:'string'},focus:{type:'string'}},required:['title','focus'],additionalProperties:false}},weeks:{type:'array',items:{type:'object',properties:{focus:{type:'string'},sessions:{type:'array',items:{type:'object',properties:{slotId:{type:'string'},type:{type:'string',enum:['easy','long','recovery','fartlek','interval','tempo']},title:{type:'string'},purpose:{type:'string'},instructions:{type:'string'}},required:['slotId','type','title','purpose','instructions'],additionalProperties:false}}},required:['focus','sessions'],additionalProperties:false}}},required:['summary','feasibility','warnings','phases','weeks'],additionalProperties:false};

export function compileBlueprintResponse(raw,blueprint){
 if(!Array.isArray(raw?.weeks)||raw.weeks.length!==blueprint.weeks.length)throw Error('Retorne todas as semanas de sessionBlueprint.');
 const qualityTypes=[];
 const block=(phase,minutes,rpe,repeats=1,recoveryMinutes=0)=>({phase,minutes,rpe,repeats,recoveryMinutes,recoveryRpe:1});
 const weeks=blueprint.weeks.map((w,i)=>{
  const source=raw.weeks[i];if(!Array.isArray(source?.sessions)||source.sessions.length!==w.slots.length)throw Error(`Semana ${i+1}: retorne cada slot exatamente uma vez.`);
  const used=new Set();
  const sessions=w.slots.map(slot=>{
   const matches=source.sessions.filter(s=>s?.slotId===slot.id);
   if(matches.length!==1)throw Error(`Retorne o slot ${slot.id} exatamente uma vez.`);
   const s=matches[0];used.add(s.slotId);
   if(!slot.allowedTypes.includes(s.type))throw Error(`Slot ${slot.id}: escolha somente ${slot.allowedTypes.join(', ')}.`);
   let blocks;
   if(slot.role==='quality'){
    qualityTypes.push(s.type);
    const dose=blueprint.qualityDoseMinutes,peak=blueprint.qualityPeakRpe;
    const repeats=s.type==='fartlek'?dose:s.type==='interval'?4:2,minutes=dose/repeats,recoveryMinutes=dose*.5/repeats;
    const rest=slot.minutes-15-dose*1.5;
    blocks=[block('warmup',10,2),block('work',minutes,peak,repeats,recoveryMinutes),...(rest>=.25?[block('work',rest,2)]:[]),block('cooldown',5+(rest<.25?rest:0),1)];
   }else{
    const warm=Math.min(5,Math.max(1,slot.minutes/4)),cool=warm;
    blocks=[block('warmup',warm,1),block('work',slot.minutes-warm-cool,slot.rpe),block('cooldown',cool,1)];
   }
   return {date:slot.date,km:slot.km,minutes:slot.minutes,rpe:slot.rpe,long:slot.role==='long',title:s.title,instructions:s.instructions,workout:{type:s.type,purpose:s.purpose,blocks}};
  });
  if(used.size!==source.sessions.length)throw Error('Há slots desconhecidos no retorno.');
  return {start:w.start,focus:source.focus,sessions};
 });
 const eligible=blueprint.weeks.flatMap(w=>w.slots).filter(s=>s.role==='quality');
 if(qualityTypes.length>=2&&eligible.some(s=>s.allowedTypes.length>=2)&&new Set(qualityTypes).size<2)throw Error('Varie pelo menos dois tipos de qualidade entre as semanas, conforme os allowedTypes dos slots.');
 return {...raw,weeks};
}
