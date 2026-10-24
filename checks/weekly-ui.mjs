import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateWeeklyCheckin} from '../dist/weekly-contract.js';
const events={},windowEvents={};let active={id:'ai-weekly-1',owner:'owner-a',profile:{days:[0,2,4],maxMinutes:60,longMinutes:90}},ready=true,conflict=false,posts=[];
const state={planId:active.id,profile:active.profile,weekStart:'2026-10-16',weekEnd:'2026-10-22',canSave:true,checkin:null,stats:{registered:3,km:15,minutes:105},planned:3,history:[]};
let fields={fatigue:'2',sleep:'4',readiness:'4',pain:'none',illness:null,complete:'on',consent:null,days:['0','2','4'],maxMinutes:'60',longMinutes:'90',notes:'<script>alert(1)</script>'};
const context=vm.createContext({synchronizeRecovery:async()=>{},dailyRecoveryReady:()=>true,console,validateWeeklyCheckin,sessionFetch:async(path,options)=>{if(options.method==='POST'){const body=JSON.parse(options.body);posts.push(body);return Response.json({checkin:{id:'checkin-1',revision:1,report:body.report}});}return Response.json(state);},getActivePlan:()=>active,activeSyncOwner:()=>active?.owner||null,synchronize:async()=>{},hasSyncConflict:()=>conflict,accountSyncReady:()=>ready,AbortSignal,Event,FormData:class{get(k){return fields[k]}getAll(k){return fields[k]||[]}},document:{addEventListener:(name,fn)=>events[name]=fn},window:{addEventListener:(name,fn)=>windowEvents[name]=fn,dispatchEvent(){}},location:{hash:'#plano'}});
vm.runInContext(fs.readFileSync('dist/weekly-review.js','utf8').replace(/^import .*;\n/gm,'').replace(/export /g,''),context);
await context.refreshWeeklyReview();let html=context.renderWeeklyReview();assert.match(html,/15 km e 105 min/);assert.match(html,/Autorizo enviar/);assert.match(html,/fadiga|Fadiga/);
const submit=()=>events.submit({target:{id:'weekly-checkin'},preventDefault(){}});
ready=false;await submit();assert.equal(posts.length,0);assert.match(context.renderWeeklyReview(),/sincronização terminar/);
ready=true;conflict=true;await submit();assert.equal(posts.length,0);conflict=false;
await submit();assert.equal(posts.length,1);assert.equal(posts[0].report.consent,false);assert.match(context.renderWeeklyReview(),/salvo sem envio ao Gemini/);assert.ok(!context.renderWeeklyReview().includes('<script>'));
fields.consent='on';await submit();assert.equal(posts[1].report.consent,true);assert.match(context.renderWeeklyReview(),/entra na fila automaticamente/);
state.checkin={id:'checkin-1',job_id:'job-1',revision:2,report:posts[1].report};await context.refreshWeeklyReview();assert.match(context.renderWeeklyReview(),/Fechamento enviado/);const before=posts.length;await submit();assert.equal(posts.length,before);
// An account switch cannot accept a late result for the old account.
let release;context.sessionFetch=()=>new Promise(resolve=>release=resolve);const pending=context.refreshWeeklyReview();active=null;await context.refreshWeeklyReview();release(Response.json(state));await pending;assert.equal(context.renderWeeklyReview(),'');
console.log('PASS: fechamento semanal, autorização separada, bloqueio offline/conflito, escape, envio único, estado congelado e conta trocada durante consulta (DOM simulado).');
