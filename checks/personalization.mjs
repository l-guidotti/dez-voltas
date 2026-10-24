import {intensityPolicy,renderWorkout,workoutTypes} from '../dist/workout-contract.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as personalization from '../dist/goal-context.js';
import * as baseline from '../dist/plan.js';
import {sessionsForPlan} from '../dist/active-plan.js';
import {validateStoredProfile,addDate} from '../dist/training-contract.js';
const owner='fixture-runner',start='2026-10-20';
const profile=(goal='distance',target=5)=>validateStoredProfile({goal,target,startDate:start,targetDate:'2027-02-28',weeklyKm:12,longestKm:6,weeksConsistent:3,days:[2,5],maxMinutes:45,longMinutes:75,pain:'none',consent:false,details:{registrationCompleted:true,eventName:'Prova <personalizada>',terrain:'road',experience:'regular',longDay:5,finishMinutes:goal==='distance'?35:null}});
const activeFor=p=>({id:'fixture-plan',owner,profile:p,plan:{summary:'Consistência',feasibility:'Revisar conforme recuperação',warnings:[],reviewDate:addDate(start,28),phases:[],weeks:Array.from({length:4},(_,i)=>({start:addDate(start,7*i),totalKm:5,focus:'Confortável',sessions:[{date:addDate(start,3+7*i),title:'Treino da pessoa',km:5,minutes:35,rpe:3,long:false,instructions:'Conversa confortável'}]}))}});
const code=fs.readFileSync('dist/app.js','utf8').replace(/^import .*;\n/gm,'').replace('initProfile();','');
function app({active=null,saved=null,account=owner,date='2026-10-23',logs={}}={}){
 const elements=new Map(),store=new Map();let selected=active;
 if(saved)store.set('dez-voltas-draft-v1:'+account,JSON.stringify(saved));
 store.set('dez-voltas-v1',JSON.stringify({version:1,logs,checklist:{},timer:null}));
 const make=()=>({innerHTML:'',textContent:'',value:'',open:false,classList:{add(){},remove(){},toggle(){}},addEventListener(){},querySelectorAll(){return []},showModal(){},close(){},focus(){},click(){},remove(){}});
 const document={querySelector(s){if(!elements.has(s))elements.set(s,make());return elements.get(s)},querySelectorAll(){return []},addEventListener(){},createElement:make,body:make()};
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[date+'T15:00:00Z']));}static now(){return new Date(date+'T15:00:00Z').getTime();}}
 const ctx=vm.createContext({initPushSettings(){},refreshPushUI(){},pushSettingsEditing:()=>false,renderDailyRecovery:()=>'',initDailyRecovery(){},refreshRecoveryUI(){},dailyRecoveryEditing:()=>false,intensityPolicy,renderWorkout,workoutTypes,renderWeeklyReview:()=>'',initWeeklyReview(){},...personalization,...baseline,Date:FixedDate,Intl,JSON,Map,Set,Event,URL,Blob,document,localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},getActivePlan:()=>selected,sessionsForPlan,allGeneratedSessions:()=>selected?sessionsForPlan(selected):[],visibleGeneratedSessions:()=>selected?sessionsForPlan(selected):[],exportPlanArchive:()=>({version:1,owner:account,plans:selected?[selected]:[]}),renderAccountActions:()=>'',needsRegistration:()=>false,configureAccountSync(){},resumeAccountSync(){},renderProfile:()=>'',navigator:{onLine:true},window:{addEventListener(){},scrollTo(){}},location:{hash:'#hoje'},matchMedia:()=>({matches:false}),setTimeout:()=>1,clearTimeout(){},setInterval(){}});
 vm.runInContext(code,ctx);
 return {ctx,document,store,show(route){ctx.location.hash='#'+route;ctx.render();return document.querySelector('#main').innerHTML},setActive(value){selected=value}};
}
for(const [goal,target] of [['distance',5],['distance',21.1],['time',30],['backyard',6]]){
 const p=profile(goal,target),a=app({active:activeFor(p)});
 const home=a.show('hoje'),race=a.show('prova'),guide=a.show('guia');
 for(const html of [home,race,guide])assert.ok(!/Até Cair|Pelotas|2h10|35 km|abril|10 de abril|25 km/.test(html));
 assert.ok(home.includes('Seu treino de hoje'));assert.ok(home.includes('Treino da pessoa'));assert.ok(race.includes('Prova &lt;personalizada&gt;'));assert.ok(!race.includes('Prova <personalizada>'));
 assert.equal(race.includes('id="lap-minutes"'),goal==='backyard');assert.equal(guide.includes('Preparação para a backyard'),goal==='backyard');
 if(goal==='time'){assert.ok(race.includes('30 minutos'));assert.ok(home.includes('minutos registrados</span>'));assert.ok(!race.includes('DISTÂNCIA DA META'));assert.ok(guide.includes('Seu objetivo é correr por tempo'));}
 if(goal==='backyard'){assert.ok(race.includes('40,2 km'));assert.ok(!race.includes('67,1'));a.document.querySelector('#lap-minutes').value='52';a.ctx.updateLap();assert.ok(a.document.querySelector('#lap-result').innerHTML.includes('8 min'));}
 assert.equal(a.ctx.scheduledSessions().length,4);
}
const saved=profile(),noPlan=app({saved});assert.ok(noPlan.show('hoje').includes('5 km'));assert.ok(noPlan.show('hoje').includes('Nenhum plano em uso'));assert.ok(noPlan.show('prova').includes('Prova &lt;personalizada&gt;'));assert.ok(noPlan.show('guia').includes('12 km/semana'));assert.equal(noPlan.ctx.scheduledSessions().length,0);assert.ok(!noPlan.show('plano').includes('25 km'));
const nobody=app({account:null});for(const route of ['hoje','prova','guia','plano'])assert.ok(!/Até Cair|Pelotas|2h10|67,1|abril|35 km/.test(nobody.show(route)));assert.ok(nobody.show('hoje').includes('Defina seu próximo objetivo'));
const other=app({account:'other'});other.store.set('dez-voltas-draft-v1:'+owner,JSON.stringify(saved));assert.ok(!other.show('prova').includes('Prova &lt;personalizada&gt;'));
const current=activeFor(profile()),precedence=app({active:current,saved:profile('time',40)});assert.ok(precedence.show('prova').includes('completar <strong>5 km'));assert.ok(!precedence.show('prova').includes('40 minutos'));
const today=app({active:current,date:'2027-02-28'});assert.ok(today.show('hoje').includes('Hoje é o dia do seu objetivo'));assert.ok(today.show('prova').includes('Hoje'));assert.ok(!today.show('prova').includes('0 dias'));
const after=app({active:current,date:'2027-03-01'});assert.ok(after.show('prova').includes('DIAS DESDE O OBJETIVO'));assert.ok(after.show('hoje').includes('Revise seu próximo objetivo'));
const before=app({active:current,date:'2026-10-19'});assert.ok(before.show('hoje').includes('Sua próxima sessão'));assert.ok(before.show('hoje').includes('Hoje não há corrida no calendário'));
const completed=sessionsForPlan(current)[0];const logged=app({active:current,logs:{[completed.id]:{km:4.8,minutes:34,rpe:3,pain:'none',notes:'Realizado',date:completed.date,updatedAt:'2026-10-23T15:00:00Z'}}});assert.ok(logged.show('hoje').includes('Treino de hoje registrado'));assert.ok(logged.show('hoje').includes('4,8'));
for(const terrain of ['trail','mixed','treadmill']){const p=profile();p.details.terrain=terrain;const a=app({active:activeFor(p)});assert.ok(a.show('guia').includes(terrain==='treadmill'?'Treinar na esteira':'Terreno e desnível'));}
const pain=profile();pain.pain='current';assert.ok(app({saved:pain}).show('guia').includes('Antes de gerar novas cargas'));const updatedPain=app({active:current,saved:pain});assert.ok(updatedPain.show('hoje').includes('Você informou dor atual'));assert.ok(updatedPain.show('guia').includes('Antes de gerar novas cargas'));
console.log('PASS: Hoje/Objetivo/Guia para distância, tempo e backyard, cadastro sem plano, isolamento, datas passada/hoje/futura, registros do dia, terreno, dor e escape de texto.');
