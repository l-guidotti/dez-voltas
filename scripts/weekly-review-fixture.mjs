import {addDate,localToday,validateStoredProfile} from '../dist/training-contract.js';
import {prepareWeeklyReview} from '../dist/weekly-contract.js';

// Synthetic data only. No account IDs, emails, production logs or medical history.
export function weeklyFixture(today=localToday(),scenario='hold'){
 if(!['hold','reduce','pain'].includes(scenario))throw Error('Cenário inválido: hold, reduce ou pain.');
 const start=addDate(today,-7),end=addDate(today,-1);
 const profile=validateStoredProfile({goal:'distance',target:10,startDate:addDate(today,-14),targetDate:addDate(today,56),weeklyKm:15,longestKm:5,weeksConsistent:8,days:[0,2,4],maxMinutes:45,longMinutes:60,pain:'none',consent:true});
 const checkin={fatigue:scenario==='reduce'?4:2,sleep:4,readiness:4,pain:scenario==='pain'?'mild':'none',illness:false,complete:true,consent:true,recoveryConsent:true,days:[0,2,4],maxMinutes:45,longMinutes:60,notes:'Cenário fictício para diagnóstico. Rotina disponível em três dias; sem compensar faltas.'};
 const logs=[0,2,4].map((n,i)=>({id:'fiction-session-'+i,date:addDate(start,n),km:5,minutes:35,rpe:3,pain:'none',notes:'Corrida fictícia em esforço confortável.'}));
 const dailyRecovery=Array.from({length:14},(_,i)=>({date:addDate(start,i-7),fatigue:checkin.fatigue,sleep:4,readiness:4,pain:'none',illness:false,painLocation:'',notes:'Registro fictício.',activity:{type:'none',minutes:0,rpe:null}}));
 return {label:'Semana fictícia · '+scenario,scenario,today,context:{sourcePlanId:'ai-fiction-weekly-test',profile,weekStart:start,weekEnd:end,checkin,currentPain:'none',previousCheckin:null,planned:logs.map(({pain,notes,...x})=>x),logs:[...logs.map(x=>({...x,id:'previous-'+x.id,date:addDate(x.date,-7)})),...logs],dailyRecoveryConsent:true,dailyRecovery,existingPhases:[{start:profile.startDate,end:profile.targetDate,title:'Preparação para 10 km',focus:'Manter continuidade e revisar pela recuperação.'}],upcoming:[0,2,4].map(n=>({date:addDate(today,n),title:'Rodagem prevista',km:5,minutes:35,rpe:3,long:false}))}};
}
export function prepareFixture(fixture){try{return {prepared:prepareWeeklyReview(fixture.context,fixture.today),preflightError:null};}catch(e){return {prepared:null,preflightError:e.message};}}
