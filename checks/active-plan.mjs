import {intensityPolicy,renderWorkout,workoutTypes} from '../dist/workout-contract.js';
import * as personalization from '../dist/goal-context.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as baseline from '../dist/plan.js';
import {addDate} from '../dist/training-contract.js';
import {exportWorkoutFit,workoutRecipe,workoutInstructions} from '../dist/workout-fit.js';
const store=new Map();
globalThis.localStorage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)};
let active=await import('../dist/active-plan.js?initial');
const start='2026-10-22';
function suggestion(at='2026-10-22T22:00:00Z'){
 const profile={goal:'backyard',target:10,startDate:start,targetDate:addDate(start,170),weeklyKm:10,longestKm:8,weeksConsistent:2,days:[0,2,3,5],maxMinutes:60,longMinutes:120,pain:'none',consent:true};
 return {version:1,profile,model:'simulado',generatedAt:at,plan:{summary:'Construir <base>',feasibility:'Rever a meta pela recuperação.',warnings:['Observar o corpo.'],phases:[{start,end:profile.targetDate,title:'Base',focus:'Consistência'}],weeks:Array.from({length:4},(_,i)=>({start:addDate(start,i*7),totalKm:5,focus:'Confortável',sessions:[{date:addDate(start,i*7+1),title:'Rodagem <leve>',km:5,minutes:35,rpe:3,long:false,instructions:'Conversa confortável. <b>Sem HTML</b>'}]}))}};
}
const first=active.adoptSuggestion('runner',suggestion());
assert.equal(active.sessionsForPlan(first).length,4);assert.equal(first.profile.startDate,start);
const firstId=active.sessionsForPlan(first)[0].id;
const code=fs.readFileSync('dist/app.js','utf8').replace(/^import .*;\n/gm,'').replace('initProfile();','');
function app(){
 const elements=new Map(),events={};
 const make=()=>({innerHTML:'',textContent:'',value:'',handlers:{},classList:{add(){},remove(){},toggle(){}},addEventListener(n,fn){this.handlers[n]=fn},querySelectorAll(){return []},focus(){},select(){},showModal(){this.open=true},close(){this.open=false},click(){},remove(){}});
 const document={querySelector(s){if(!elements.has(s))elements.set(s,make());return elements.get(s)},querySelectorAll(){return []},addEventListener:(n,fn)=>events[n]=fn,body:make(),createElement:make};
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-28T15:00:00Z']));}static now(){return new Date('2026-10-28T15:00:00Z').getTime();}}
 const ctx=vm.createContext({initPushSettings(){},refreshPushUI(){},pushSettingsEditing:()=>false,renderDailyRecovery:()=>'',initDailyRecovery(){},refreshRecoveryUI(){},dailyRecoveryEditing:()=>false,intensityPolicy,renderWorkout,workoutTypes,renderWeeklyReview:()=>'',initWeeklyReview(){},...personalization,renderAccountActions:()=>'<a href="#perfil">Entrar</a>',needsRegistration:()=>false,configureAccountSync(value){ctx.syncAdapter=value},resumeAccountSync(){},connectAccount:async()=>{},accountChanged(){},syncMessage:()=>'Sincronizado',hasSyncConflict:()=>false,synchronize:async()=>{},resolveSync:async()=>{},replaceOwnerArchive(){},...baseline,...active,console,document,renderProfile:()=>'<h1>Meu objetivo</h1>',localStorage:globalThis.localStorage,navigator:{onLine:true},location:{hash:'#plano'},window:{addEventListener(){},dispatchEvent(){},scrollTo(){}},matchMedia:()=>({matches:false}),setTimeout:()=>1,clearTimeout(){},setInterval(){},Date:FixedDate,Intl,URL,Blob,Event,FormData:class{constructor(form){this.data=form.data}get(k){return this.data[k]}},exportWorkoutFit,workoutRecipe,workoutInstructions});
 vm.runInContext(code,ctx);vm.runInContext('download=(content,name,type)=>{globalThis.downloaded={content,name,type}}',ctx);
 return {ctx,document,events,elements};
}
store.set('dez-voltas-v1',JSON.stringify({version:1,logs:{w1d0:{km:5,minutes:40,rpe:3,date:'2026-10-27',pain:'none',notes:'Registro original'}},checklist:{},timer:null}));
let a=app();
assert.ok(a.document.querySelector('#main').innerHTML.includes('Plano Gemini em uso'));
assert.ok(a.document.querySelector('#main').innerHTML.includes('Rodagem &lt;leve&gt;'));
assert.ok(!a.document.querySelector('#main').innerHTML.includes('Rodagem <leve>'));
a.ctx.openSession(firstId);assert.ok(a.document.querySelector('#session-content').innerHTML.includes('35 min · RPE 3/10'));
assert.ok(a.document.querySelector('#session-content').innerHTML.includes('&lt;b&gt;Sem HTML&lt;/b&gt;'));
a.events.submit({target:{id:'log-form',data:{km:'5.2',minutes:'36',rpe:'3',pain:'none',notes:'Treino gerado concluído'}},preventDefault(){}});
assert.equal(JSON.parse(store.get('dez-voltas-v1')).logs[firstId].km,5.2);
a.ctx.openSession(active.sessionsForPlan(first)[1].id);a.events.submit({target:{id:'log-form',data:{km:'5',minutes:'35',rpe:'3',pain:'none'}},preventDefault(){}});assert.ok(a.document.querySelector('#log-feedback').textContent.includes('futura'));
a.ctx.exportICS();assert.ok(a.ctx.downloaded.content.includes('RPE 3/10'));assert.equal((a.ctx.downloaded.content.match(/BEGIN:VEVENT/g)||[]).length,4);
const second=active.adoptSuggestion('runner',suggestion('2026-10-22T23:00:00Z'));
assert.notEqual(second.id,first.id);assert.equal(active.allGeneratedSessions().length,8);
active=await import('../dist/active-plan.js?reload');a=app();
assert.equal(vm.runInContext(`state.logs['${firstId}'].km`,a.ctx),5.2);
a.ctx.location.hash='#diario';a.ctx.render();assert.ok(a.document.querySelector('#main').innerHTML.includes('Treino gerado concluído'));assert.ok(a.document.querySelector('#main').innerHTML.includes('Registro original'));
a.ctx.exportJSON();const backup=JSON.parse(a.ctx.downloaded.content);assert.equal(backup.generatedPlans.plans.length,2);
store.clear();active=await import('../dist/active-plan.js?restore');a=app();assert.equal(active.getActivePlan(),null);
await a.elements.get('#import-file').handlers.change({target:{files:[{size:JSON.stringify(backup).length,text:async()=>JSON.stringify(backup)}],value:''}});
await a.events.click({target:{closest(){return {dataset:{action:'confirm-import'}}}}});
assert.equal(active.getActivePlan().id,second.id);assert.equal(JSON.parse(store.get('dez-voltas-v1')).logs[firstId].km,5.2);
active.useOriginalPlan();a.ctx.location.hash='#plano';a.ctx.render();assert.ok(a.document.querySelector('#main').innerHTML.includes('Nenhum plano em uso'));assert.equal(active.allGeneratedSessions().length,8);
active.setPlanOwner('other');assert.equal(active.getActivePlan(),null);assert.equal(active.visibleGeneratedSessions().length,0);assert.equal(active.allGeneratedSessions().length,8);
active.setPlanOwner('runner');active.adoptSuggestion('runner',suggestion('2026-10-22T23:00:00Z'));const before=active.getActivePlan();const savedSetter=globalThis.localStorage.setItem;globalThis.localStorage.setItem=()=>{throw Error('Storage full')};assert.throws(()=>active.adoptSuggestion('runner',suggestion('2026-10-23T00:00:00Z')));assert.equal(active.getActivePlan().id,before.id);globalThis.localStorage.setItem=savedSetter;
const bad=suggestion();bad.plan.phases=[];assert.throws(()=>active.adoptSuggestion('runner',bad));assert.equal(active.getActivePlan().id,before.id);
const timed=suggestion('2026-10-24T00:00:00Z');for(const w of timed.plan.weeks){w.totalKm=0;w.sessions[0].km=0;}
const timedPlan=active.adoptSuggestion('runner',timed);a=app();assert.ok(a.document.querySelector('#main').innerHTML.includes('Por tempo'));
const timedId=active.sessionsForPlan(timedPlan)[0].id;a.ctx.openSession(timedId);assert.ok(a.document.querySelector('#session-content').innerHTML.includes('disabled title="Defina uma distância'));
a.events.submit({target:{id:'log-form',data:{km:'0',minutes:'35',rpe:'3',pain:'none',notes:'Sessão por tempo'}},preventDefault(){}});assert.equal(JSON.parse(store.get('dez-voltas-v1')).logs[timedId].km,0);
console.log('PASS: adoção, calendário e detalhes, registro gerado, bloqueio de data futura, histórico após troca/reabertura, exportação ICS, backup/restauração completos, seleção por conta e falha de armazenamento (DOM simulado).');

globalThis.localStorage.removeItem=k=>store.delete(k);
const doc=a.ctx.syncAdapter.capture('runner');assert.ok(doc.archive.plans.every(p=>p.owner==='runner'));assert.ok(doc.state.logs[timedId]);assert.equal(doc.state.timer,null);
a.ctx.syncAdapter.select('runner',null);assert.equal(store.get('dez-voltas-legacy-owner'),'runner');assert.ok(store.get('dez-voltas-legacy-backup'));
a.ctx.syncAdapter.disconnect();assert.equal(Object.keys(JSON.parse(store.get('dez-voltas-v1')).logs).length,0);
a.ctx.syncAdapter.apply(doc,'runner');assert.ok(JSON.parse(store.get('dez-voltas-v1')).logs[timedId]);
a.ctx.syncAdapter.select('other',null);assert.equal(Object.keys(JSON.parse(store.get('dez-voltas-v1')).logs).length,0);
console.log('PASS: adaptador real do diário: migração com backup, captura por conta, saída, restauração e isolamento de conta nova.');
