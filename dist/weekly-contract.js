import {intensityPolicy,qualityTypes,workoutStats} from './workout-contract.js';
import {validateProfile,dateOnly,addDate,daysBetween,localToday} from './training-contract.js';
export function validateWeeklyCheckin(raw){
 if(!raw||typeof raw!=='object')throw Error('Preencha o fechamento da semana.');
 const out={};for(const name of ['fatigue','sleep','readiness']){const n=raw[name];if(!Number.isInteger(n)||n<1||n>5)throw Error('Informe fadiga, sono e disposição de 1 a 5.');out[name]=n;}
 if(!['none','mild','stop'].includes(raw.pain))throw Error('Informe se houve dor na semana.');
 if(typeof raw.illness!=='boolean'||typeof raw.complete!=='boolean'||typeof raw.consent!=='boolean')throw Error('Confira as confirmações da semana.');
 if(!Array.isArray(raw.days)||raw.days.length>6||new Set(raw.days).size!==raw.days.length||raw.days.some(x=>!Number.isInteger(x)||x<0||x>6))throw Error('Escolha até 6 dias disponíveis.');
 for(const name of ['maxMinutes','longMinutes']){if(!Number.isInteger(raw[name])||raw[name]<20||raw[name]>(name==='maxMinutes'?360:600))throw Error('Confira os tempos disponíveis para a próxima semana.');out[name]=raw[name];}
 if(typeof raw.notes!=='string'||raw.notes.length>1000)throw Error('Use até 1000 caracteres na observação.');
 return {...out,pain:raw.pain,illness:raw.illness,complete:raw.complete,consent:raw.consent,days:[...raw.days].sort(),notes:raw.notes.trim()};
}
const sum=(items,fn)=>items.reduce((a,b)=>a+fn(b),0);
const floor=n=>Math.floor(Math.max(0,n)*10)/10;
export function prepareWeeklyReview(context,today=localToday()){
 if(!context||!Array.isArray(context.logs)||!Array.isArray(context.planned)||context.logs.length>100)throw Error('O histórico da semana está incompleto. Sincronize e revise seus registros.');
 const c=validateWeeklyCheckin(context.checkin),start=dateOnly(context.weekStart),end=dateOnly(context.weekEnd);
 if(daysBetween(start,end)!==6||today<=end||daysBetween(end,today)>7)throw Error('A revisão precisa de uma semana encerrada recentemente.');
 if(!c.consent)throw Error('Autorize o envio dos dados da semana ao Gemini.');
 if(c.pain!=='none'||c.illness||context.currentPain&&context.currentPain!=='none')throw Error('Há dor, doença ou retorno de lesão informado. Revise a preparação com um profissional antes de gerar novas cargas.');
 if(c.days.length<2)throw Error('Disponibilidade registrada. Com menos de dois dias, revise a rotina antes de gerar um novo bloco de corrida.');
 const logs=context.logs.map(x=>{
  const date=dateOnly(x.date),km=Number(x.km),minutes=Number(x.minutes),rpe=Number(x.rpe);
  if(!Number.isFinite(km)||km<0||km>150||!Number.isFinite(minutes)||minutes<=0||minutes>1440||!Number.isInteger(rpe)||rpe<1||rpe>10||!['none','mild','stop'].includes(x.pain))throw Error('Há um registro inválido no histórico.');
  return {id:String(x.id),date,km,minutes,rpe,pain:x.pain,notes:date>=start?String(x.notes||'').slice(0,1500):''};
 }).filter(x=>x.date>=addDate(end,-27)&&x.date<=end);
 const week=logs.filter(x=>x.date>=start),previous=logs.filter(x=>x.date>=addDate(start,-7)&&x.date<start);
 if(!week.length)throw Error('Não há treinos registrados na semana. Atualize o diário e a base recente antes de gerar novas cargas.');
 if(week.some(x=>x.pain!=='none'))throw Error('O diário contém dor nesta semana. Revise a recuperação com um profissional antes de gerar novas cargas.');
 const planned=context.planned.filter(x=>x.date>=start&&x.date<=end),ids=new Set(week.map(x=>x.id));
 const km=sum(week,x=>x.km),minutes=sum(week,x=>x.minutes),load=sum(week,x=>x.minutes*x.rpe),longest=Math.max(...week.map(x=>x.km)),duration=Math.max(...week.map(x=>x.minutes));
 const plannedKm=sum(planned,x=>Number(x.km)||0),plannedMinutes=sum(planned,x=>Number(x.minutes)||0),plannedLoad=sum(planned,x=>(Number(x.minutes)||0)*(Number(x.rpe)||0));
 const completion=planned.length?planned.filter(x=>ids.has(x.id)).length/planned.length:0;
 const prev=context.previousCheckin;
 const previousKm=sum(previous,x=>x.km),previousMinutes=sum(previous,x=>x.minutes),previousLoad=sum(previous,x=>x.minutes*x.rpe);
 const recentJump=previous.length>0&&(km>previousKm*1.2||minutes>previousMinutes*1.2||load>previousLoad*1.2);
 const previousGood=prev?.complete===true&&prev.pain==='none'&&prev.illness===false&&prev.fatigue<=2&&prev.sleep>=3&&prev.readiness>=4&&previous.length>0&&previous.every(x=>x.pain==='none'&&x.rpe<=6);
 const good=c.complete&&c.fatigue<=2&&c.sleep>=3&&c.readiness>=4&&completion>=.8&&plannedMinutes>0&&minutes>=plannedMinutes*.8&&minutes<=plannedMinutes*1.1&&load<=plannedLoad*1.1&&previousGood&&week.every(x=>x.rpe<=6)&&km<=previousKm*1.1&&minutes<=previousMinutes*1.1&&load<=previousLoad*1.1&&longest<=Math.max(...previous.map(x=>x.km))*1.1&&daysBetween(today,context.profile.targetDate)>14;
 const reduce=recentJump||c.fatigue>=4||c.sleep<=2||c.readiness<=2||completion<.6||!c.complete;
 const decision=reduce?'reduce':good?'increase':'hold',factor=reduce?.8:good?1.05:1;
 const reason=reduce?'A recuperação ou a cobertura dos registros pede redução e nova avaliação.':good?'Duas semanas com registros confirmados e boa recuperação permitem avaliar uma progressão pequena; aumentar não é obrigatório.':'Manter a carga é a referência. Ainda não há evidências suficientes para propor aumento.';
 // Ceilings, never mandatory targets. No compounding increases across the four proposed weeks.
 const review={sourcePlanId:context.sourcePlanId,weekStart:start,weekEnd:end,decision,reason,
  maxWeeklyKm:floor(Math.min(200,km*factor,plannedKm>0?plannedKm*(good?1.05:1):km*factor)),
  maxWeeklyMinutes:floor(Math.min(3600,minutes*factor,plannedMinutes>0?plannedMinutes*(good?1.05:1):minutes*factor)),
  maxSessionKm:floor(Math.min(150,longest*(good?1.05:1))),maxSessionMinutes:floor(Math.min(600,duration*(good?1.05:1))),
  maxRpe:good&&km>=20?5:4,maxLoad:floor(Math.min(36000,load*factor)),observedKm:floor(km),observedMinutes:floor(minutes)};
 const original=context.currentIntensity?{...context.profile,details:{...context.profile.details,intensity:context.currentIntensity}}:context.profile;
 // A weekly review can preserve quality already practiced; it cannot introduce a new peak while raising volume.
 if(original.details?.intensity){
  const updated={...original,weeklyKm:Math.min(200,km),preparationDays:daysBetween(today,original.targetDate),details:{...original.details,intensity:{...original.details.intensity,fatigue:c.fatigue,sleep:c.sleep}}};
  const candidate=intensityPolicy({...updated,review:undefined});
  const actualIds=new Set(week.map(x=>x.id));
  const practiced=planned.filter(x=>actualIds.has(x.id)&&x.workout&&qualityTypes.includes(x.workout.type)&&week.some(log=>log.id===x.id&&log.minutes>=Number(x.minutes)*.95&&log.rpe>=4&&(Number(x.km)===0||log.km>=Number(x.km)*.9)));
  const previousHasQuality=previous.some(x=>Number(x.rpe)>=4);
  if(!reduce&&previousGood&&c.complete&&candidate.maxQuality&&practiced.length&&previousHasQuality){
   const peak=Math.max(...practiced.map(x=>workoutStats(x.workout).peak));
   const dose=Math.max(...practiced.map(x=>workoutStats(x.workout).hardMinutes));
   review.quality={allowedTypes:candidate.allowedTypes.filter(x=>qualityTypes.includes(x)&&peak>=({fartlek:5,tempo:6,interval:7}[x])),maxPeakRpe:Math.min(candidate.maxPeakRpe,peak),maxHardMinutes:Math.min(candidate.maxHardMinutes,dose)};
   review.maxRpe=Math.min(candidate.maxOverallRpe,Math.max(...week.map(x=>x.rpe)));
  }
 }

 const profile=validateProfile({...original,startDate:today,weeklyKm:Math.min(200,km),longestKm:longest,days:c.days,maxMinutes:c.maxMinutes,longMinutes:c.longMinutes,consent:true,
  ...(original.details?{details:{...original.details,...(original.details.intensity?{intensity:{...original.details.intensity,fatigue:c.fatigue,sleep:c.sleep}}:{}),longDay:c.days.includes(original.details.longDay)?original.details.longDay:null}}:{}),review},today,{allowReview:true});
 const existingPhases=Array.isArray(context.existingPhases)?context.existingPhases.slice(0,12).map(x=>({start:x.start,end:x.end,title:String(x.title||'').slice(0,100),focus:String(x.focus||'').slice(0,500)})):[];
 const upcoming=Array.isArray(context.upcoming)?context.upcoming.slice(0,28).map(x=>({date:x.date,title:String(x.title||'').slice(0,120),km:Number(x.km),minutes:Number(x.minutes),rpe:Number(x.rpe),long:x.long===true})):[];
 const evidence={existingPhases,upcoming,weekStart:start,weekEnd:end,checkin:c,planned:planned.map(({id,...x})=>x),performed:logs.map(({id,...x})=>x),completion,plannedKm,plannedMinutes,performedKm:km,performedMinutes:minutes,perceivedLoad:load,limits:review};
 return {profile,evidence};
}
