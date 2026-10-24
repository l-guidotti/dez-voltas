import {dateOnly,addDate,localToday} from './training-contract.js';
export const recoveryActivities={none:'Nenhuma / descanso',strength:'Musculação / força',walk:'Caminhada',bike:'Bicicleta',swim:'Natação',other:'Outra atividade'};
export function validateRecovery(raw){
 if(!raw||typeof raw!=='object')throw Error('Preencha o check-in do dia.');
 const out={};for(const name of ['fatigue','sleep','readiness']){if(!Number.isInteger(raw[name])||raw[name]<1||raw[name]>5)throw Error('Informe fadiga, sono e disposição de 1 a 5.');out[name]=raw[name];}
 if(!['none','mild','stop'].includes(raw.pain)||typeof raw.illness!=='boolean')throw Error('Confira a situação de dores e doença.');
 for(const [field,max]of [['painLocation',100],['notes',500]]){if(typeof raw[field]!=='string'||raw[field].length>max)throw Error('Confira o local da dor e a observação do dia.');out[field]=raw[field].trim();}
 const a=raw.activity;if(!a||!Object.hasOwn(recoveryActivities,a.type))throw Error('Confira a atividade além das corridas registradas.');
 if(a.type!=='none'&&(!Number.isInteger(a.minutes)||a.minutes<1||a.minutes>600||!Number.isInteger(a.rpe)||a.rpe<1||a.rpe>10))throw Error('Informe duração de 1 a 600 minutos e esforço de 1 a 10 para a outra atividade.');
 return {...out,pain:raw.pain,illness:raw.illness,activity:a.type==='none'?{type:'none',minutes:0,rpe:null}:{type:a.type,minutes:a.minutes,rpe:a.rpe}};
}
export function recoveryDay(raw,today=localToday()){const day=dateOnly(raw);if(day>today||day<addDate(today,-27))throw Error('Registre hoje ou um dos últimos 27 dias.');return day;}
export function recoveryRecord(row){return {day:dateOnly(row.day),report:validateRecovery({fatigue:row.fatigue,sleep:row.sleep,readiness:row.readiness,pain:row.pain,illness:row.illness,painLocation:row.pain_location,notes:row.notes,activity:{type:row.activity_type,minutes:row.activity_minutes,rpe:row.activity_rpe}}),revision:row.revision,updatedAt:row.updated_at};}
export function recoverySummary(entries,start,end){
 const days=entries.filter(x=>x.day>=start&&x.day<=end);
 return {days:days.length,painDays:days.filter(x=>x.report.pain!=='none'||x.report.illness).length,activityMinutes:days.reduce((n,x)=>n+x.report.activity.minutes,0),fatigue:days.length?Math.round(days.reduce((n,x)=>n+x.report.fatigue,0)/days.length*10)/10:null};
}
