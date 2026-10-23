import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateAccountDocument} from '../dist/sync-contract.js';
import {validateProfile,localToday,addDate} from '../dist/training-contract.js';
import {adoptSuggestion,exportPlanArchive,allGeneratedSessions} from '../dist/active-plan.js';
import {SESSIONS} from '../dist/plan.js';
import {handleApi} from '../server/api.js';
const A='bfe7c1f8-ad46-4a01-8b5a-24788b26c8fd',B='00000000-0000-0000-0000-000000000002';
const copy=x=>JSON.parse(JSON.stringify(x));
const empty=id=>({version:1,profile:null,draft:null,archive:{version:1,owner:id,plans:[]},state:{version:1,logs:{},checklist:{},timer:null}});
const id=SESSIONS[0].id;
const log=notes=>({km:5,minutes:35,rpe:3,pain:'none',notes,date:SESSIONS[0].date,updatedAt:new Date().toISOString()});
let remote=null,offline=false;
function device(storage=new Map()){
 let doc=empty(A),selected=A;const events={};
 const context=vm.createContext({validateAccountDocument,JSON,Event,AbortSignal,console,setTimeout:()=>1,clearTimeout(){},setInterval(){},localStorage:{getItem:k=>storage.get(k),removeItem:k=>storage.delete(k),setItem:(k,v)=>storage.set(k,v)},window:{addEventListener:(k,fn)=>events[k]=fn,dispatchEvent(){}},fetch:async(path,options)=>{
  if(offline)throw Error('offline');assert.equal(path,'/api/account/data');
  if(options.method==='POST'){const body=JSON.parse(options.body);if(body.revision!==(remote?.revision||0))return Response.json({error:'conflict'},{status:409});remote={revision:(remote?.revision||0)+1,document:copy(body.document)};}
  return Response.json({record:copy(remote)});
 }});
 vm.runInContext(fs.readFileSync('dist/account-sync.js','utf8').replace(/^import .*;\n/gm,'').replace(/export /g,''),context);
 context.configureAccountSync({capture:()=>doc,select(owner,saved){selected=owner;doc=saved?copy(saved):empty(owner)},apply(next,owner){assert.equal(owner,selected);doc=copy(next)},disconnect(){doc=empty(null)}});
 return {context,storage,get doc(){return doc},change(notes){doc.state.logs[id]=log(notes);context.accountChanged();}};
}
// Generated plan definitions and corresponding diary entries travel together.
globalThis.localStorage={getItem:()=>null,setItem(){}};
const start=localToday(),profile=validateProfile({goal:'backyard',target:10,startDate:start,targetDate:addDate(start,80),weeklyKm:10,longestKm:8,weeksConsistent:2,days:[0,2,3,5],maxMinutes:60,longMinutes:120,pain:'none',consent:true});
const plan={summary:'Base',feasibility:'Revisar',warnings:[],phases:[{start,end:profile.targetDate,title:'Preparação',focus:'Base'}],weeks:Array.from({length:4},(_,i)=>{const begin=addDate(start,i*7),date=Array.from({length:7},(_,j)=>addDate(begin,j)).find(d=>profile.days.includes(new Date(d+'T12:00:00Z').getUTCDay()));return {start:begin,totalKm:5,focus:'Confortável',sessions:[{date,title:'Rodagem',km:5,minutes:35,rpe:3,long:false,instructions:'Conversa confortável'}]};})};
adoptSuggestion(A,{version:1,profile,plan,generatedAt:new Date().toISOString(),model:'simulado'});
const generated=empty(A);generated.profile={version:1,profile,plan,generatedAt:new Date().toISOString(),model:'simulado'};generated.archive=exportPlanArchive();const gs=allGeneratedSessions(generated.archive)[0];generated.state.logs[gs.id]={...log('Diário do plano gerado'),date:gs.date};
assert.equal(validateAccountDocument(generated,A).state.logs[gs.id].notes,'Diário do plano gerado');
remote={revision:1,document:generated};const generatedDevice=device();await generatedDevice.context.connectAccount(A);assert.equal(generatedDevice.doc.archive.plans[0].active,true);assert.equal(generatedDevice.doc.state.logs[gs.id].notes,'Diário do plano gerado');remote=null;
const one=device();await one.context.connectAccount(A);one.change('Treino no primeiro aparelho');await one.context.synchronize();assert.equal(remote.revision,1);
const two=device();await two.context.connectAccount(A);assert.equal(two.doc.state.logs[id].notes,'Treino no primeiro aparelho');assert.equal(two.context.hasSyncConflict(),false);
offline=true;two.change('Registro offline');await two.context.synchronize();assert.ok(two.context.syncMessage().includes('preservada'));offline=false;
const reopened=device(two.storage);offline=true;reopened.context.resumeAccountSync();await new Promise(resolve=>setImmediate(resolve));reopened.change('Registro offline');offline=false;await reopened.context.synchronize();assert.equal(remote.document.state.logs[id].notes,'Registro offline');
one.change('Edição simultânea');await one.context.synchronize();assert.equal(one.context.hasSyncConflict(),true);assert.equal(remote.document.state.logs[id].notes,'Registro offline');
await one.context.resolveSync(false);assert.equal(one.doc.state.logs[id].notes,'Registro offline');assert.ok(one.storage.get('dez-voltas-cloud-v1:'+A+':recovery').includes('Edição simultânea'));
// Choosing local is explicit and still uses compare-and-swap.
one.change('Escolha local');await one.context.synchronize();reopened.change('Escolha de outro aparelho');await reopened.context.synchronize();assert.equal(reopened.context.hasSyncConflict(),true);await reopened.context.resolveSync(true);assert.equal(remote.document.state.logs[id].notes,'Escolha de outro aparelho');
await one.context.connectAccount(null);assert.equal(Object.keys(one.doc.state.logs).length,0);
remote=null;await one.context.connectAccount(B);assert.equal(one.doc.archive.owner,B);assert.equal(Object.keys(one.doc.state.logs).length,0);
assert.throws(()=>validateAccountDocument({...empty(A),archive:{version:1,owner:B,plans:[]}},A),/outra conta/);
const bad=empty(A);bad.state.logs[id]={...log(''),minutes:-1};assert.throws(()=>validateAccountDocument(bad,A),/inválido/);
// Server must use the authenticated user's token and id, never caller ownership.
const originalFetch=globalThis.fetch;let wrote=false;
globalThis.fetch=async(url,options)=>{
 if(url.endsWith('/auth/v1/user'))return Response.json({id:A,email:'runner@example.com',email_confirmed_at:'2026-01-01'});
 assert.equal(options.headers.Authorization,'Bearer private-session');assert.equal(options.headers.apikey,'publishable');
 if(url.includes('/rest/v1/account_data?')){assert.ok(url.includes('user_id=eq.'+A));return Response.json([]);}
 assert.ok(url.endsWith('/rest/v1/rpc/save_account_data'));const b=JSON.parse(options.body);assert.equal(b.expected_revision,0);assert.equal(b.new_document.archive.owner,A);assert.equal(b.new_document.state.timer,null);wrote=true;return Response.json([{revision:1,document:b.new_document}]);
};
const env={SUPABASE_URL:'https://supabase.example',SUPABASE_ANON_KEY:'publishable',APP_ORIGIN:'https://app.example'};
const req=body=>new Request('https://app.example/api/account/data',{method:body?'POST':'GET',headers:{origin:'https://app.example','content-type':'application/json',cookie:'__Host-dv-access=private-session'},...(body?{body:JSON.stringify(body)}:{})});
assert.equal((await handleApi(req(),env)).status,200);
assert.equal((await handleApi(req({revision:0,document:empty(B)}),env)).status,400);assert.equal(wrote,false);
assert.equal((await handleApi(req({revision:0,document:empty(A)}),env)).status,200);assert.equal(wrote,true);
assert.equal((await handleApi(new Request('https://app.example/api/account/data'),env)).status,401);
globalThis.fetch=originalFetch;
console.log('PASS: sincronização entre aparelhos, diário offline/reabertura, conflito sem sobrescrita, recuperação, troca de conta, validação e API autenticada (simulados).');
