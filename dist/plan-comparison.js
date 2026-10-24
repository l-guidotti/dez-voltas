import {addDate,daysBetween} from './training-contract.js';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const round=x=>Math.round((x+Number.EPSILON)*10)/10;
const fmt=x=>Number(x).toLocaleString('pt-BR',{maximumFractionDigits:1});
const date=x=>x.split('-').reverse().join('/');
const metrics=[['km','Volume de corrida','km'],['minutes','Tempo de treino','min'],['rpe','Esforço médio previsto','RPE / 10'],['sessions','Sessões de corrida','sessões']];
function coverage(entry){
 const p=entry?.profile,weeks=entry?.plan?.weeks;
 if(!p||!Array.isArray(weeks)||!weeks.length)return [];
 const days=Math.min(28,daysBetween(p.startDate,p.targetDate));
 if(days<1)return [];
 const end=addDate(p.startDate,days-1);
 return weeks.map(w=>({start:w.start,end:[addDate(w.start,6),end].sort()[0]})).filter(w=>w.start<=w.end);
}
function contains(ranges,date){return ranges.some(r=>date>=r.start&&date<=r.end);}
function stats(entry,dates){
 const sessions=entry.plan.weeks.flatMap(w=>w.sessions).filter(s=>dates.has(s.date));
 const minutes=sessions.reduce((n,s)=>n+s.minutes,0);
 return {km:round(sessions.reduce((n,s)=>n+s.km,0)),minutes:round(minutes),rpe:minutes?round(sessions.reduce((n,s)=>n+s.minutes*s.rpe,0)/minutes):null,sessions:sessions.length};
}
export function metricChange(before,after){
 if(before===null||after===null)return {direction:'unknown',delta:null,percent:null};
 const delta=round(after-before);
 return {direction:delta>0?'up':delta<0?'down':'same',delta,percent:before>0?round(delta/before*100):null};
}
export function compareWeeklyPlans(suggestion,{owner,plans=[],activePlan=null}={}){
 const review=suggestion?.profile?.review;if(!review)return null;
 // A weekly review always refers to its actual source; never substitute another account or plan.
 const previous=owner&&plans.find(p=>p.owner===owner&&p.id===review.sourcePlanId);
 if(!previous)return {status:'missing'};
 const sourceRanges=coverage(previous),newRanges=coverage(suggestion);
 if(!sourceRanges.length||!newRanges.length)return {status:'unavailable'};
 const start=newRanges[0].start,end=newRanges.at(-1).end;
 const allDates=Array.from({length:daysBetween(start,end)+1},(_,i)=>addDate(start,i)).filter(d=>contains(newRanges,d));
 const common=allDates.filter(d=>contains(sourceRanges,d));
 const adopted=activePlan?.owner===owner&&activePlan.generatedAt===suggestion.generatedAt&&JSON.stringify(activePlan.plan)===JSON.stringify(suggestion.plan);
 const stale=activePlan?.id!==previous.id&&!adopted;
 const summarize=dates=>({start:dates[0],end:dates.at(-1),days:dates.length,before:stats(previous,new Set(dates)),after:stats(suggestion,new Set(dates))});
 const weeks=newRanges.map((range,i)=>{
  const dates=common.filter(d=>d>=range.start&&d<=range.end),fullDays=daysBetween(range.start,range.end)+1;
  return {number:i+1,start:range.start,end:range.end,fullDays,comparison:dates.length?summarize(dates):null};
 });
 return {status:common.length?'ready':'no-overlap',stale,adopted,days:allDates.length,comparedDays:common.length,uncomparedDays:allDates.length-common.length,total:common.length?summarize(common):null,weeks};
}
function changeText(change,unit){
 if(change.direction==='unknown')return 'Sem base comparável para o esforço médio.';
 if(change.direction==='same')return 'Sem alteração';
 return `${change.direction==='up'?'Aumento':'Redução'} de ${fmt(Math.abs(change.delta))} ${unit}${change.percent===null?'':` (${change.delta>0?'+':'−'}${fmt(Math.abs(change.percent))}%)`}`;
}
function metricCards(comparison){return `<div class="plan-compare-metrics">${metrics.map(([key,title,unit])=>{
 const before=comparison.before[key],after=comparison.after[key],change=metricChange(before,after);
 const oldTone=change.direction==='up'?'lower':change.direction==='down'?'higher':'neutral';
 const newTone=change.direction==='up'?'higher':change.direction==='down'?'lower':'neutral';
 const value=n=>n===null?'Sem sessões':`${fmt(n)} <small>${esc(key==='sessions'&&n===1?'sessão':unit)}</small>`;
 const difference=key==='rpe'?{...change,percent:null}:change;
 const deltaUnit=key==='rpe'?(Math.abs(change.delta)===1?'ponto de RPE':'pontos de RPE'):key==='sessions'&&Math.abs(change.delta)===1?'sessão':unit;
 return `<article class="plan-compare-metric"><h4>${esc(title)}</h4><dl class="plan-compare-values"><div class="compare-${oldTone}"><dt>Plano anterior</dt><dd>${value(before)}</dd></div><div class="compare-${newTone}"><dt>Nova sugestão</dt><dd>${value(after)}</dd></div></dl><p class="plan-compare-delta" data-direction="${change.direction}"><span aria-hidden="true">${{up:'↑',down:'↓',same:'=',unknown:'—'}[change.direction]}</span> ${esc(changeText(difference,deltaUnit))}</p></article>`;
 }).join('')}</div>`;}
export function renderPlanComparison(suggestion,context){
 const c=compareWeeklyPlans(suggestion,context);if(!c)return '';
 const heading='<span class="eyebrow muted">ANTES DE DECIDIR</span><h3>O que muda no seu plano?</h3>';
 const missing=c.status==='missing'||c.status==='unavailable';
 if(missing)return `<section class="plan-comparison" aria-label="Comparação com o plano anterior">${heading}<p>O plano que originou esta revisão não está disponível neste aparelho. Sincronize sua conta para recuperar a comparação. Nenhuma diferença foi calculada.</p></section>`;
 const state=c.adopted?'<p class="notice">Esta sugestão já está em uso. A comparação continua mostrando o plano que originou a revisão.</p>':c.stale?'<p class="notice">O plano em uso mudou desde esta revisão. Esta comparação usa o plano anterior de origem; faça uma nova revisão antes de substituir o plano atual.</p>':'';
 const legend='<p class="field-help">Verde indica o maior valor e vermelho o menor valor em cada comparação. As setas e os números mostram aumento ou redução. Reduzir a carga pode ser adequado para recuperação ou polimento.</p>';
 const coverage=c.uncomparedDays?`<p class="notice">${c.uncomparedDays} de ${c.days} dias da nova sugestão não têm detalhamento correspondente no plano anterior e ficam fora dos cálculos. Ausência de planejamento não é descanso nem volume zero.</p>`:'';
 const total=c.total?`<p><strong>${esc(changeText(metricChange(c.total.before.km,c.total.after.km),'km'))}</strong> nos ${c.total.days} dias comparáveis, de ${date(c.total.start)} a ${date(c.total.end)}.</p>${metricCards(c.total)}`:'<p>Os planos não têm dias detalhados em comum. Não é possível afirmar aumento ou redução comparando períodos diferentes.</p>';
 const weeks=`<details class="plan-compare-weeks"><summary>Conferir as diferenças por semana</summary>${c.weeks.map(w=>`<section class="plan-compare-week"><h4>Semana ${w.number} · ${date(w.start)} a ${date(w.end)}</h4>${w.comparison?`${w.comparison.days<w.fullDays?`<p class="field-help">Comparação parcial: ${w.comparison.days} de ${w.fullDays} dias, de ${date(w.comparison.start)} a ${date(w.comparison.end)}.</p>`:''}${metricCards(w.comparison)}`:'<p>Sem detalhamento anterior para comparar esta semana.</p>'}</section>`).join('')}</details>`;
 return `<section class="plan-comparison" aria-label="Comparação com o plano anterior">${heading}${state}${legend}${total}${coverage}${weeks}<p class="field-help">RPE médio previsto = soma de minutos × RPE das sessões, dividida pelo tempo total. É uma estimativa do plano; o esforço real fica no diário. As diferenças são calculadas a partir dos treinos, sem uma nova chamada à IA.</p><p>A sugestão só altera seu calendário quando você escolher <strong>Usar este plano</strong>. Você pode continuar com o plano anterior.</p></section>`;
}
