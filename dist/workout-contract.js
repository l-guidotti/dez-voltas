export const workoutTypes={recovery:'Regenerativo',easy:'Rodagem',long:'Longão',fartlek:'Fartlek',tempo:'Ritmo / tempo run',interval:'Intervalado'};
export const qualityTypes=['fartlek','tempo','interval'];
export function validateIntensity(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Confira os dados de intensidade.');
 const choice=(name,values)=>{if(!values.includes(raw[name]))throw Error('Confira os dados de intensidade e recuperação.');return raw[name];};
 const out={recentQuality:choice('recentQuality',['none','occasional','weekly','unspecified']),restriction:choice('restriction',['none','yes','unsure']),preference:choice('preference',['conservative','balanced'])};
 for(const name of ['fatigue','sleep']){const n=raw[name];if(n!==null&&(!Number.isInteger(n)||n<1||n>5))throw Error('Informe sono e fadiga de 1 a 5, ou deixe em aberto.');out[name]=n;}
 const n=raw.qualityWeeks;if(n!==null&&(!Number.isInteger(n)||n<0||n>104))throw Error('Confira as semanas recentes com treino de qualidade.');out.qualityWeeks=n;
 return out;
}
export function intensityPolicy(p){
 const d=p?.details||{},i=d.intensity,preparation=Number.isFinite(p.preparationDays)?p.preparationDays:(Date.parse(p.targetDate)-Date.parse(p.startDate))/86400000;
 const base={level:'base',allowedTypes:['recovery','easy','long'],maxPeakRpe:4,maxOverallRpe:4,maxQuality:0,maxHardMinutes:0,maxHardFraction:0,reason:'Priorizar base: complete os dados de experiência, qualidade recente e recuperação para avaliar outras sessões.'};
 if(!i||i.recentQuality==='unspecified'||p.pain!=='none'||i.restriction!=='none'||i.preference==='conservative'||i.fatigue==null||i.fatigue>2||i.sleep==null||i.sleep<3||p.weeklyKm<25||p.longestKm<5||p.weeksConsistent<8||!['regular','experienced'].includes(d.experience)||d.experienceMonths<6||d.experienceMonths==null||d.recentRuns<3||d.recentRuns==null||p.days.length<3||p.maxMinutes<30||!(preparation>21))return {...base,reason:i?'Base e recuperação atuais não sustentam uma sessão de qualidade neste bloco; não é liberação clínica para esforço.':base.reason};
 let policy={level:'intro',allowedTypes:[...base.allowedTypes,'fartlek'],maxPeakRpe:5,maxOverallRpe:4,maxQuality:1,maxHardMinutes:8,maxHardFraction:.1,reason:'Base regular permite avaliar fartlek moderado, com dose curta e maior parte do tempo fácil.'};
 if(i.recentQuality==='weekly'&&i.qualityWeeks>=4&&p.weeklyKm>=30&&p.weeksConsistent>=12&&d.experienceMonths>=12)policy={...policy,level:'regular',allowedTypes:[...base.allowedTypes,'fartlek','tempo'],maxPeakRpe:7,maxOverallRpe:5,maxHardMinutes:15,maxHardFraction:.15,reason:'Consistência e qualidade recente permitem avaliar fartlek e ritmo controlado.'};
 if(policy.level==='regular'&&i.qualityWeeks>=8&&p.weeklyKm>=35&&d.recentRuns>=4&&p.days.length>=4)policy={...policy,level:'experienced',allowedTypes:[...policy.allowedTypes,'interval'],maxPeakRpe:8,maxOverallRpe:6,maxHardMinutes:20,maxHardFraction:.2,reason:'Base e prática recente permitem avaliar intervalados controlados, sem tiros máximos.'};
 if(p.review){
  const q=p.review.quality;
  if(!q||p.review.decision==='reduce'||q.maxPeakRpe<=4)return {...base,reason:'A revisão atual pede recuperação ou não confirmou experiência recente com qualidade.'};
  const allowed=policy.allowedTypes.filter(t=>!qualityTypes.includes(t)||q.allowedTypes.includes(t));
  policy={...policy,allowedTypes:allowed,maxPeakRpe:Math.min(policy.maxPeakRpe,q.maxPeakRpe),maxOverallRpe:Math.min(policy.maxOverallRpe,p.review.maxRpe),maxHardMinutes:Math.min(policy.maxHardMinutes,q.maxHardMinutes)};
  if(!allowed.some(t=>qualityTypes.includes(t)))return {...base,reason:'A revisão não confirmou uma dose de qualidade compatível com a recuperação.'};
 }
 return policy;
}
export function validateReviewQuality(q){
 if(!q||typeof q!=='object'||!Array.isArray(q.allowedTypes)||q.allowedTypes.length>3||new Set(q.allowedTypes).size!==q.allowedTypes.length||q.allowedTypes.some(x=>!qualityTypes.includes(x))||!Number.isInteger(q.maxPeakRpe)||q.maxPeakRpe<4||q.maxPeakRpe>8||typeof q.maxHardMinutes!=='number'||q.maxHardMinutes<0||q.maxHardMinutes>20)throw Error('Limites de qualidade da revisão inválidos.');
 return {allowedTypes:[...q.allowedTypes],maxPeakRpe:q.maxPeakRpe,maxHardMinutes:q.maxHardMinutes};
}
const number=(x,min,max,field)=>{if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)throw Error('Etapas do treino: '+field+' deve ficar entre '+min+' e '+max+'.');return x;};
const text=(s,max)=>{if(typeof s!=='string'||!s.trim()||s.length>max)throw Error('Descrição do treino inválida.');return s;};
export function workoutStats(w){let minutes=0,hardMinutes=0,peak=0;for(const b of w.blocks){minutes+=b.repeats*(b.minutes+b.recoveryMinutes);if(b.rpe>=5)hardMinutes+=b.minutes*b.repeats;peak=Math.max(peak,b.rpe,b.recoveryRpe);}return {minutes,hardMinutes,peak};}
export function validateWorkout(raw,session,policy){
 if(!raw||!policy.allowedTypes.includes(raw.type)||!Array.isArray(raw.blocks)||raw.blocks.length<3||raw.blocks.length>8)throw Error('Tipo de treino incompatível com sua base ou etapas ausentes.');
 const quality=qualityTypes.includes(raw.type);
 if((raw.type==='long')!==session.long)throw Error('O tipo de sessão não corresponde à marcação de longo.');
 const blocks=raw.blocks.map((b,index)=>{
  if(!['warmup','work','cooldown'].includes(b.phase)||!Number.isInteger(b.repeats)||b.repeats<1||b.repeats>20||!Number.isInteger(b.rpe)||!Number.isInteger(b.recoveryRpe))throw Error('Etapa de treino inválida.');
  const block={phase:b.phase,repeats:b.repeats,minutes:number(b.minutes,.25,600,'minutes'),rpe:number(b.rpe,1,policy.maxPeakRpe,'rpe'),recoveryMinutes:number(b.recoveryMinutes,0,10,'recoveryMinutes'),recoveryRpe:number(b.recoveryRpe,1,3,'recoveryRpe')};
  if(index===0&&b.phase!=='warmup'||index===raw.blocks.length-1&&b.phase!=='cooldown'||index>0&&index<raw.blocks.length-1&&b.phase!=='work')throw Error('Ordene aquecimento, parte principal e desaquecimento.');
  if(b.phase!=='work'&&(b.repeats!==1||b.recoveryMinutes!==0||b.rpe>3||b.minutes<(quality?(b.phase==='warmup'?10:5):1)))throw Error('Aquecimento ou desaquecimento incompatível com a sessão.');
  if(['easy','recovery'].includes(raw.type)&&b.phase==='work'&&(b.repeats!==1||b.recoveryMinutes!==0))throw Error('Rodagem e regenerativo devem ter parte principal contínua.');
  if(!quality&&b.rpe>(raw.type==='recovery'?3:4))throw Error('Rodagem, regenerativo e longo devem permanecer confortáveis.');
  if(b.phase==='work'&&b.rpe>=5){
   if(raw.type==='interval'&&(b.rpe<7||b.minutes>4||b.repeats<2||b.recoveryMinutes<=0))throw Error('Intervalado deve ter repetições e recuperação explícita, sem tiros máximos.');
   if(raw.type==='tempo'&&(b.rpe<6||b.rpe>7||b.minutes<3||b.minutes>20))throw Error('Ritmo deve ter blocos fortes e sustentáveis.');
   if(raw.type==='fartlek'&&(b.minutes>(policy.level==='intro'?2:5)||b.recoveryMinutes<=0))throw Error('Fartlek deve alternar trechos controlados e recuperação explícita.');
  }
  return block;
 });
 const out={type:raw.type,purpose:text(raw.purpose,300),blocks},stats=workoutStats(out);
 if(Math.abs(stats.minutes-session.minutes)>.15)throw Error('A duração total deve incluir aquecimento, repetições, recuperações e desaquecimento.');
 if(quality&&(stats.hardMinutes<=0||stats.hardMinutes>policy.maxHardMinutes+.05||session.rpe<3)||session.rpe>policy.maxOverallRpe)throw Error('Dose ou esforço global incompatível com sua elegibilidade.');
 return out;
}
export function validateWorkoutSchedule(weeks,p,policy){
 const sessions=weeks.flatMap(w=>w.sessions),quality=sessions.filter(s=>s.workout&&qualityTypes.includes(s.workout.type));
 for(const w of weeks){const structured=w.sessions.filter(s=>s.workout),minutes=structured.reduce((n,s)=>n+s.minutes,0),hard=structured.reduce((n,s)=>n+workoutStats(s.workout).hardMinutes,0);if(structured.filter(s=>qualityTypes.includes(s.workout.type)).length>policy.maxQuality||hard>minutes*policy.maxHardFraction+.05)throw Error('A semana excedeu a dose de qualidade permitida; preserve a maior parte do tempo em esforço fácil.');}
 for(let i=1;i<weeks.length;i++){
  const current=weeks[i].sessions.filter(s=>s.workout),before=weeks[i-1].sessions.filter(s=>s.workout);
  if(!current.length||!before.length)continue;
  const stats=items=>({km:items.reduce((n,s)=>n+s.km,0),minutes:items.reduce((n,s)=>n+s.minutes,0),hard:items.reduce((n,s)=>n+workoutStats(s.workout).hardMinutes,0),peak:Math.max(...items.map(s=>workoutStats(s.workout).peak))});
  const a=stats(current),b=stats(before);
  if((a.km>b.km+.2||a.minutes>b.minutes+.2)&&(a.hard>b.hard+.05||a.peak>b.peak))throw Error('Não aumente volume e dose/intensidade de qualidade ao mesmo tempo.');
 }
 for(let i=0;i<quality.length;i++){
  const s=quality[i],remaining=(Date.parse(p.targetDate)-Date.parse(s.date))/86400000;
  if(remaining<=14)throw Error('Não inclua qualidade na janela final de recuperação deste bloco.');
  if(i&&(Date.parse(s.date)-Date.parse(quality[i-1].date))/86400000<7)throw Error('Mantenha no máximo uma sessão de qualidade a cada sete dias.');
  if(sessions.some(x=>x.long&&Math.abs(Date.parse(x.date)-Date.parse(s.date))/86400000<2))throw Error('Separe qualidade e longo por ao menos um dia sem sessão exigente.');
 }
}
export const workoutSchema={type:'object',properties:{type:{type:'string',enum:Object.keys(workoutTypes)},purpose:{type:'string'},blocks:{type:'array',minItems:3,maxItems:8,items:{type:'object',properties:{phase:{type:'string',enum:['warmup','work','cooldown']},repeats:{type:'integer',minimum:1,maximum:20},minutes:{type:'number',minimum:.25,maximum:600},rpe:{type:'integer',minimum:1,maximum:8},recoveryMinutes:{type:'number',minimum:0,maximum:10},recoveryRpe:{type:'integer',minimum:1,maximum:3}},required:['phase','repeats','minutes','rpe','recoveryMinutes','recoveryRpe'],additionalProperties:false}}},required:['type','purpose','blocks'],additionalProperties:false};
export function workoutLines(w){
 if(!w)return [];
 return [workoutTypes[w.type]+': '+w.purpose,...w.blocks.map(b=>{
  const label={warmup:'Aquecimento',work:'Parte principal',cooldown:'Desaquecimento'}[b.phase];
  const run=`${b.minutes} min em RPE ${b.rpe}/10`,recovery=b.recoveryMinutes?` + ${b.recoveryMinutes} min de trote/caminhada em RPE ${b.recoveryRpe}/10`:'';
  return `${label}: ${b.repeats>1?b.repeats+' × (':''}${run}${recovery}${b.repeats>1?')':''}.`;
 }),`Total: ${workoutStats(w).minutes} min, incluindo todas as recuperações.`];
}
export function renderWorkout(w){const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const lines=workoutLines(w);return w?`<div class="structured-workout"><strong>${esc(lines[0])}</strong><ol>${lines.slice(1,-1).map(x=>`<li>${esc(x)}</li>`).join('')}</ol><p class="field-help">${esc(lines.at(-1))} RPE das etapas orienta o esforço percebido; não corresponde a uma zona cardíaca medida.</p></div>`:'';}
