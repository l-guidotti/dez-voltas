import {validateIntensity,intensityPolicy,validateWorkout,validateWorkoutSchedule,validateReviewQuality} from './workout-contract.js';
export function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Data inválida.');
  const d = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(+d) || d.toISOString().slice(0,10) !== value) throw new Error('Data inválida.');
  return value;
}
export function addDate(date, days) { return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10); }
export function daysBetween(a,b) { return Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000); }
export function localToday() { return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
const finite = (x,min,max,label) => { if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max) throw new Error('Confira '+label+'.'); return x; };
export function validateProfile(raw, today=localToday(), {requireConsent=true,allowReview=false}={}) {
  if (!raw || typeof raw !== 'object') throw new Error('Preencha seu perfil.');
  if(raw.review!==undefined&&!allowReview)throw new Error('Use o fechamento semanal para revisar um plano existente.');
  const review=raw.review===undefined?null:validateReviewLimits(raw.review);
  const startDate=dateOnly(raw.startDate),targetDate=dateOnly(raw.targetDate);
  if(startDate<today || daysBetween(today,startDate)>90) throw new Error('Escolha um início entre hoje e os próximos 90 dias.');
  const preparationDays=daysBetween(startDate,targetDate);
  if(preparationDays<(review?1:14)||preparationDays>730) throw new Error('A preparação precisa ter entre 14 dias e dois anos.');
  if(!['distance','time','backyard'].includes(raw.goal)) throw new Error('Selecione o objetivo.');
  const target=finite(raw.target,1,raw.goal==='time'?1440:raw.goal==='backyard'?48:200,'a meta');
  if(raw.goal==='backyard'&&!Number.isInteger(target)) throw new Error('Informe um número inteiro de voltas.');
  const weeklyKm=finite(raw.weeklyKm,0,200,'o volume médio recente');
  const longestKm=finite(raw.longestKm,0,150,'o maior treino recente');
  const weeksConsistent=finite(raw.weeksConsistent,0,520,'as semanas de consistência');
  if(!Number.isInteger(weeksConsistent)) throw new Error('Informe semanas inteiras.');
  const days=raw.days;
  if(!Array.isArray(days)||days.length<2||days.length>6||new Set(days).size!==days.length||days.some(d=>!Number.isInteger(d)||d<0||d>6)) throw new Error('Escolha de 2 a 6 dias da semana.');
  const maxMinutes=finite(raw.maxMinutes,20,360,'o tempo disponível por sessão');
  const longMinutes=finite(raw.longMinutes,review?20:30,600,'o tempo disponível para o longo');
  if(!['none','current','return'].includes(raw.pain)) throw new Error('Informe a situação de dores.');
  if(requireConsent&&raw.consent!==true) throw new Error('Autorize o envio dos dados de treino ao Gemini.');
  return {...(review?{review}:{}),goal:raw.goal,target,startDate,targetDate,preparationDays,weeklyKm,longestKm,weeksConsistent,days:[...days].sort(),maxMinutes,longMinutes,pain:raw.pain,consent:raw.consent===true,...(raw.details!==undefined?{details:validateDetails(raw.details,days,raw.goal)}:{})};
}
export function validateStoredProfile(raw,today=raw?.startDate||localToday()){return validateProfile(raw,today,{requireConsent:false,allowReview:true});}
function validateReviewLimits(raw){
 if(!raw||typeof raw!=='object'||typeof raw.sourcePlanId!=='string'||!/^ai-[a-z0-9-]{1,100}$/.test(raw.sourcePlanId)||!['increase','hold','reduce'].includes(raw.decision)||typeof raw.reason!=='string'||!raw.reason||raw.reason.length>500)throw new Error('Referência da revisão inválida.');
 const weekStart=dateOnly(raw.weekStart),weekEnd=dateOnly(raw.weekEnd);if(daysBetween(weekStart,weekEnd)!==6)throw new Error('Semana de revisão inválida.');
 const out={sourcePlanId:raw.sourcePlanId,weekStart,weekEnd,decision:raw.decision,reason:raw.reason};
 for(const [name,max]of Object.entries({maxWeeklyKm:200,maxWeeklyMinutes:3600,maxSessionKm:150,maxSessionMinutes:600,maxRpe:6,maxLoad:36000,observedKm:15000,observedMinutes:144000}))out[name]=finite(raw[name],0,max,'os limites da revisão');
 if(!Number.isInteger(out.maxRpe)||out.maxRpe<1)throw new Error('Esforço de revisão inválido.');if(raw.quality!==undefined)out.quality=validateReviewQuality(raw.quality);return out;
}
function validateDetails(raw,days,goal){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Confira as informações adicionais.');
 const optionalNumber=(v,min,max,label,integer=false)=>{if(v===null||v===undefined)return null;const n=finite(v,min,max,label);if(integer&&!Number.isInteger(n))throw new Error('Informe um número inteiro para '+label+'.');return n;};
 const choice=(v,options,label)=>{v=v||'unspecified';if(!options.includes(v))throw new Error('Confira '+label+'.');return v;};
 const eventName=raw.eventName??'';if(typeof eventName!=='string'||eventName.length>120||/[\x00-\x1f]/.test(eventName))throw new Error('Nome da prova inválido.');
 const longDay=optionalNumber(raw.longDay,0,6,'o dia do longo',true);if(longDay!==null&&!days.includes(longDay))throw new Error('O dia do longo precisa estar entre seus dias disponíveis.');
 const finishMinutes=optionalNumber(raw.finishMinutes,5,3000,'o tempo desejado de conclusão');if(finishMinutes!==null&&goal!=='distance')throw new Error('O tempo desejado de conclusão se aplica à meta de distância.');
 if(raw.registrationCompleted!==undefined&&typeof raw.registrationCompleted!=='boolean')throw new Error('Estado do cadastro inválido.');
 return {...(raw.intensity!==undefined?{intensity:validateIntensity(raw.intensity)}:{}),registrationCompleted:raw.registrationCompleted===true,eventName:eventName.trim(),terrain:choice(raw.terrain,['unspecified','road','trail','mixed','treadmill'],'o terreno'),elevationM:optionalNumber(raw.elevationM,0,20000,'o desnível positivo'),experience:choice(raw.experience,['unspecified','beginner','returning','regular','experienced'],'sua experiência'),experienceMonths:optionalNumber(raw.experienceMonths,0,600,'os meses de experiência',true),recentRuns:optionalNumber(raw.recentRuns,0,7,'os dias recentes de corrida',true),longDay,finishMinutes};
}
const text = (value,max=1500) => { if(typeof value!=='string'||!value.trim()||value.length>max) throw new Error('A sugestão contém texto inválido.');return value; };
export function validateSuggestion(raw,p,{requireWorkouts=false}={}) {
  const policy=intensityPolicy(p);
  if(!raw||!Array.isArray(raw.phases)||!Array.isArray(raw.weeks)||!Array.isArray(raw.warnings)) throw new Error('O Gemini não retornou um plano válido.');
  const detailedDays=Math.min(28,p.preparationDays), count=Math.ceil(detailedDays/7);
  if(raw.weeks.length!==count||raw.phases.length<1||raw.phases.length>12||raw.warnings.length>12) throw new Error('O período retornado está incompleto.');
  let expected=p.startDate;
  const phases=raw.phases.map(x=>{ const start=dateOnly(x.start),end=dateOnly(x.end);if(start!==expected||end<start||end>p.targetDate)throw new Error('As fases não cobrem o período de preparação.');expected=addDate(end,1);return {start,end,title:text(x.title,100),focus:text(x.focus)}; });
  if(expected!==addDate(p.targetDate,1)) throw new Error('Faltam fases até a prova.');
  const seen=new Set();
  const weeks=raw.weeks.map((w,i)=>{
    const start=addDate(p.startDate,i*7),end=addDate(p.startDate,Math.min((i+1)*7,detailedDays)-1);
    if(w.start!==start) throw new Error(`Semana ${i+1}: o início deve ser ${start}. O Gemini retornou uma semana em data diferente.`);
    if(!Array.isArray(w.sessions)) throw new Error(`Semana ${i+1}: lista de sessões inválida.`);
    if(w.sessions.length>p.days.length) throw new Error(`Semana ${i+1}: o Gemini retornou ${w.sessions.length} sessões, mas seu limite é ${p.days.length} dias.`);
    let total=0;
    const sessions=w.sessions.map(s=>{
      const date=dateOnly(s.date),day=new Date(date+'T12:00:00Z').getUTCDay();
      if(date<start||date>end||date>=p.targetDate||!p.days.includes(day)||seen.has(date)) throw new Error('Sessão em data indisponível.');seen.add(date);
      const km=finite(s.km,0,150,'a distância sugerida'),minutes=finite(s.minutes,1,600,'a duração sugerida');
      if(s.long&&p.details?.longDay!==null&&p.details?.longDay!==undefined&&day!==p.details.longDay)throw new Error('O longo foi marcado fora do dia escolhido.');
      if(typeof s.long!=='boolean'||minutes>(s.long?p.longMinutes:p.maxMinutes)) throw new Error('Sessão excede seu tempo disponível.');
      const rpe=finite(s.rpe,1,10,'o esforço sugerido');
      if(!Number.isInteger(rpe)) throw new Error('Esforço inválido.');
      if(p.weeklyKm<20&&rpe>4) throw new Error('A sugestão contém esforço incompatível com a base recente.');
      const session={date,km,minutes,rpe,long:s.long,title:text(s.title,120),instructions:text(s.instructions)};
      if(requireWorkouts&&s.workout===undefined)throw new Error('Faltam os tipos e as etapas dos treinos.');
      if(s.workout!==undefined)session.workout=validateWorkout(s.workout,session,policy);
      total+=km;return session;
    });
    if(sessions.filter(s=>s.long).length>1) throw new Error('Mais de um longo na mesma semana.');
    if(Math.abs(finite(w.totalKm,0,300,'o total semanal')-total)>.15) throw new Error('O total semanal não corresponde às sessões.');
    // Product guardrails for initial suggestions, not a universal injury-prevention formula.
    if(total>(p.review?p.review.maxWeeklyKm:Math.max(p.weeklyKm,6)*Math.pow(1.15,i))+(p.review?.05:.2)) throw new Error('A sugestão aumentou demais o volume recente. Gere outra sugestão ou revise seu perfil.');
    if(sessions.some(s=>s.km>(p.review?p.review.maxSessionKm:Math.max(p.longestKm,3)*Math.pow(1.15,i))+(p.review?.05:.2))) throw new Error('O longo sugerido excede o limite inicial do perfil.');
    if(p.review&&(sessions.some(s=>s.minutes>p.review.maxSessionMinutes+.05||s.rpe>p.review.maxRpe)||sessions.reduce((n,s)=>n+s.minutes,0)>p.review.maxWeeklyMinutes+.05||sessions.reduce((n,s)=>n+s.minutes*s.rpe,0)>p.review.maxLoad+.05))throw new Error('A sugestão excede os limites de recuperação da revisão semanal.');
    return {start,totalKm:Math.round(total*10)/10,focus:text(w.focus),sessions:sessions.sort((a,b)=>a.date.localeCompare(b.date))};
  });
  validateWorkoutSchedule(weeks,p,policy);
  return {summary:text(raw.summary),feasibility:text(raw.feasibility),phases,weeks,warnings:raw.warnings.map(x=>text(x)),reviewDate:addDate(p.startDate,detailedDays)};
}
const str={type:'string'};
export const suggestionSchema={type:'object',properties:{summary:str,feasibility:str,warnings:{type:'array',items:str},phases:{type:'array',items:{type:'object',properties:{start:str,end:str,title:str,focus:str},required:['start','end','title','focus']}},weeks:{type:'array',items:{type:'object',properties:{start:str,totalKm:{type:'number'},focus:str,sessions:{type:'array',items:{type:'object',properties:{date:str,title:str,km:{type:'number'},minutes:{type:'number'},rpe:{type:'integer'},long:{type:'boolean'},instructions:str},required:['date','title','km','minutes','rpe','long','instructions']}}},required:['start','totalKm','focus','sessions']}}},required:['summary','feasibility','warnings','phases','weeks']};
