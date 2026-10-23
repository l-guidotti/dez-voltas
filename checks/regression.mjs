import {intensityPolicy,renderWorkout,workoutTypes} from '../dist/workout-contract.js';
import * as personalization from '../dist/goal-context.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PLAN,SESSIONS,START,RACE} from '../dist/plan.js';
import {exportWorkoutFit,workoutRecipe,workoutInstructions} from '../dist/workout-fit.js';
assert.deepEqual(PLAN.map(w=>w.total),[25,25,20,27,29,31,23,32]);
assert.equal(SESSIONS.length,32);
assert.equal(SESSIONS[0].date,'2026-10-27');
assert.equal(SESSIONS.at(-1).date,'2026-12-20');
assert.equal(new Set(SESSIONS.map(s=>s.id)).size,32);
for(const w of PLAN){const ss=SESSIONS.filter(s=>s.week===w.week);assert.equal(ss.reduce((n,s)=>n+s.km,0),w.total);assert.deepEqual(ss.map(s=>new Date(s.date+'T12:00:00Z').getUTCDay()),[2,3,5,0]);}
const manifest=JSON.parse(fs.readFileSync('dist/manifest.webmanifest','utf8'));
assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');
for(const i of manifest.icons){assert.ok(fs.existsSync('dist'+i.src));const png=fs.readFileSync('dist'+i.src);assert.equal(png.readUInt32BE(16),Number(i.sizes.split('x')[0]));}
const code=fs.readFileSync('dist/app.js','utf8').replace(/^import .*;\n/gm,'').replace('initProfile();','');
function appContext(seed=null,date='2026-10-28T15:00:00Z'){
 const elements=new Map(),events={},store=new Map();if(seed)store.set('dez-voltas-v1',JSON.stringify(seed));
 const make=()=>({innerHTML:'',textContent:'',value:'',open:false,classList:{add(){},remove(){},toggle(){}},addEventListener(){},querySelectorAll(){return []},focus(){},select(){},showModal(){this.open=true;},close(){this.open=false;},click(){},remove(){},append(){},getBoundingClientRect(){return {left:0,top:0,right:500,bottom:500}}});
 const document={querySelector(s){if(!elements.has(s))elements.set(s,make());return elements.get(s)},querySelectorAll(){return []},addEventListener(n,fn){events[n]=fn},body:make(),createElement:make};
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[date]));}static now(){return new Date(date).getTime();}}
 const ctx=vm.createContext({intensityPolicy,renderWorkout,workoutTypes,renderWeeklyReview:()=>'',initWeeklyReview(){},...personalization,renderAccountActions:()=>'<a href="#perfil">Entrar</a>',needsRegistration:()=>false,configureAccountSync(){},resumeAccountSync(){},connectAccount:async()=>{},accountChanged(){},syncMessage:()=>'Sincronizado',hasSyncConflict:()=>false,synchronize:async()=>{},resolveSync:async()=>{},replaceOwnerArchive(){},getActivePlan:()=>null,allGeneratedSessions:()=>[],visibleGeneratedSessions:()=>[],sessionsForPlan:()=>[],exportPlanArchive:()=>({version:1,owner:null,plans:[]}),console,document,renderProfile:()=>'<h1>Meu objetivo</h1>',localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},navigator:{onLine:true},location:{hash:''},window:{addEventListener(){},scrollTo(){}},matchMedia:()=>({matches:false}),setTimeout:()=>1,clearTimeout(){},setInterval(){},Date:FixedDate,Intl,URL,Blob,FormData:class{constructor(form){this.data=form.data;}get(k){return this.data[k]}},exportWorkoutFit,workoutRecipe,workoutInstructions,...awaitlessPlan()});
 vm.runInContext(code,ctx);return {ctx,document,elements,events,store};
}
function awaitlessPlan(){return {PLAN,START,RACE,YARD:6.7056,MILESTONES:[],SESSIONS,addDays:(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)}}}
let a=appContext();assert.ok(a.document.querySelector('#main').innerHTML.includes('Seu próximo'));
for(const route of ['plano','diario','prova','guia']){a.ctx.location.hash='#'+route;a.ctx.render();assert.ok(a.document.querySelector('#main').innerHTML.length>300);}
a.ctx.openSession('w1d0');assert.equal(a.document.querySelector('#session-dialog').open,true);
a.events.submit({target:{id:'log-form',data:{km:'5',minutes:'38',rpe:'3',pain:'none',notes:'Confortável'}},preventDefault(){}});
let persisted=JSON.parse(a.store.get('dez-voltas-v1'));assert.equal(persisted.logs.w1d0.km,5);assert.equal(persisted.logs.w1d0.notes,'Confortável');
a=appContext(persisted);assert.equal(vm.runInContext('state.logs.w1d0.minutes',a.ctx),38);assert.equal(vm.runInContext('storageAvailable',a.ctx),true);
a.ctx.openSession('w8d3');a.events.submit({target:{id:'log-form',data:{km:'12',minutes:'90',rpe:'3',pain:'none',notes:''}},preventDefault(){}});assert.ok(a.document.querySelector('#log-feedback').textContent.includes('futura'));assert.equal(JSON.parse(a.store.get('dez-voltas-v1')).logs.w8d3,undefined);
assert.throws(()=>a.ctx.cleanState({logs:{w1d0:{km:5,minutes:30,rpe:99}}}));
a.ctx.toggleTimer();assert.ok(vm.runInContext('state.timer.running',a.ctx));a.ctx.toggleTimer();assert.equal(vm.runInContext('state.timer.running',a.ctx),false);
assert.equal(a.ctx.esc('<script>'), '&lt;script&gt;');
a.document.querySelector('#zepp-warmup').value='5';a.document.querySelector('#zepp-cooldown').value='5';a.ctx.openZepp('w1d0');assert.ok(a.document.querySelector('#info-content').innerHTML.includes('configuração manual'));
vm.runInContext('download=(content,name,type)=>{globalThis.capturedDownload={content,name,type}}',a.ctx);a.ctx.downloadZeppText();assert.ok(a.ctx.capturedDownload.content.includes('5 km'));assert.ok(a.ctx.capturedDownload.content.includes('Configure estas etapas manualmente'));assert.ok(a.ctx.capturedDownload.name.endsWith('-zepp.txt'));assert.equal(a.ctx.capturedDownload.type,'text/plain;charset=utf-8');
assert.equal(JSON.parse(a.store.get('dez-voltas-v1')).logs.w8d3,undefined);
const handlers={},cacheMap=new Map();let offline=false;
const responseFile=async path=>new Response(fs.readFileSync(path==='/'?'dist/index.html':'dist'+path),{headers:{'content-type':path.endsWith('.html')||path==='/'?'text/html':'application/octet-stream'}});
const caches={async open(key){if(!cacheMap.has(key))cacheMap.set(key,new Map());const map=cacheMap.get(key);return {async put(k,r){map.set(k,r.clone())},async match(k){return map.get(k)?.clone()}}},async keys(){return [...cacheMap.keys()]},async delete(k){return cacheMap.delete(k)}};
const sw=vm.createContext({self:{location:{origin:'https://app.example'},addEventListener:(n,fn)=>handlers[n]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}},caches,URL,Response,Request:class{constructor(path){this.url='https://app.example'+path;}},fetch:async req=>{if(offline)throw new Error('offline');return responseFile(new URL(req.url).pathname)}});
vm.runInContext(fs.readFileSync('dist/sw.js','utf8'),sw);let pending;
handlers.install({waitUntil:p=>pending=p});await pending;
assert.equal(cacheMap.get('dez-voltas-v21').size,23);
handlers.activate({waitUntil:p=>pending=p});await pending;
offline=true;let result;
handlers.fetch({request:{method:'GET',mode:'navigate',url:'https://app.example/'},respondWith:p=>result=p});const fallback=await result;assert.ok((await fallback.text()).includes('<!doctype html>'));
handlers.fetch({request:{method:'GET',mode:'cors',url:'https://app.example/plan.js'},respondWith:p=>result=p});assert.ok((await (await result).text()).includes('25 km'));
console.log('PASS: 32 sessões, totais e datas; manifesto e ícones; 5 telas; registro e recarga; bloqueio de registro futuro; validação de backup; cronômetro; cache e navegação offline.');
