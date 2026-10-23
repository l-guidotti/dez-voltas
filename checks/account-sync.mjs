import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateAccountDocument} from '../dist/sync-contract.js';
import * as relational from '../dist/relational-contract.js';
import {validateProfile,localToday,addDate} from '../dist/training-contract.js';
import {adoptSuggestion,exportPlanArchive,allGeneratedSessions} from '../dist/active-plan.js';
import {SESSIONS} from '../dist/plan.js';
import {handleApi} from '../server/api.js';
const {documentRows,rowsDocument,rowChanges,overlayRows,rowKey,same}=relational;
const A='bfe7c1f8-ad46-4a01-8b5a-24788b26c8fd',B='00000000-0000-0000-0000-000000000002';
const copy=x=>JSON.parse(JSON.stringify(x));
const empty=id=>({version:1,profile:null,draft:null,archive:{version:1,owner:id,plans:[]},state:{version:1,logs:{},checklist:{},timer:null}});
const id=SESSIONS[0].id,id2=SESSIONS[1].id;
const log=(notes,session=id)=>({km:5,minutes:35,rpe:3,pain:'none',notes,date:SESSIONS.find(s=>s.id===session).date,updatedAt:new Date().toISOString()});
let offline=false,posted=[],writeHook=null,loseAck=false;const stores=new Map();
function store(owner,doc=empty(owner),legacyRevision=0){const state={cursor:1,legacy_revision:legacyRevision,rows:new Map([...documentRows(doc,owner)].map(([k,r])=>[k,{...r,revision:1,sync_version:1}]))};stores.set(owner,state);return state;}
function response(owner,since){const s=stores.get(owner)||store(owner);return {initialized:true,cursor:s.cursor,legacy_revision:s.legacy_revision,rows:copy([...s.rows.values()].filter(r=>r.sync_version>since).map(({sync_version,...r})=>r))};}
function device(storage=new Map(),owner=A){
 let doc=empty(owner),selected=owner;
 const context=vm.createContext({sessionFetch:(...args)=>context.fetch(...args),...relational,Map,Set,validateAccountDocument,JSON,Event,AbortSignal,console,setTimeout:()=>1,clearTimeout(){},setInterval(){},localStorage:{getItem:k=>storage.get(k),removeItem:k=>storage.delete(k),setItem:(k,v)=>storage.set(k,v)},window:{addEventListener(){},dispatchEvent(){}},fetch:async(path,options)=>{
  if(offline)throw Error('offline');assert.ok(path.startsWith('/api/account/sync'));const s=stores.get(selected)||store(selected);
  if(options.method==='POST'){
   const body=JSON.parse(options.body);posted.push(body);for(const r of body.changes)if((s.rows.get(rowKey(r))?.revision||0)!==r.revision)return Response.json({error:'conflict'},{status:409});
   s.cursor++;for(const r of body.changes)s.rows.set(rowKey(r),{...r,revision:r.revision+1,sync_version:s.cursor});
   if(writeHook){const fn=writeHook;writeHook=null;fn();}if(loseAck){loseAck=false;throw Error('response lost');}
   return Response.json(response(selected,body.cursor));
  }
  return Response.json(response(selected,Number(new URL(path,'https://app.example').searchParams.get('since'))));
 }});
 vm.runInContext(fs.readFileSync('dist/account-sync.js','utf8').replace(/^import .*;\n/gm,'').replace(/export /g,''),context);
 context.configureAccountSync({capture:()=>doc,select(next,saved){selected=next;doc=saved?copy(saved):empty(next)},apply(next,owner){assert.equal(owner,selected);doc=copy(next)},disconnect(){doc=empty(null)}});
 return {context,storage,get doc(){return doc},change(notes,session=id){doc.state.logs[session]=log(notes,session);context.accountChanged();},remove(session=id){delete doc.state.logs[session];context.accountChanged();}};
}
globalThis.localStorage={getItem:()=>null,setItem(){}};
const start=localToday(),profile=validateProfile({goal:'backyard',target:10,startDate:start,targetDate:addDate(start,80),weeklyKm:10,longestKm:8,weeksConsistent:2,days:[0,2,3,5],maxMinutes:60,longMinutes:120,pain:'none',consent:true});
const plan={summary:'Base',feasibility:'Revisar',warnings:[],phases:[{start,end:profile.targetDate,title:'Preparação',focus:'Base'}],weeks:Array.from({length:4},(_,i)=>{const begin=addDate(start,i*7),date=Array.from({length:7},(_,j)=>addDate(begin,j)).find(d=>profile.days.includes(new Date(d+'T12:00:00Z').getUTCDay()));return {start:begin,totalKm:5,focus:'Confortável',sessions:[{date,title:'Rodagem',km:5,minutes:35,rpe:3,long:false,instructions:'Conversa confortável'}]};})};
adoptSuggestion(A,{version:1,profile,plan,generatedAt:new Date().toISOString(),model:'simulado'});
const generated=empty(A);generated.profile={version:1,profile,plan,generatedAt:new Date().toISOString(),model:'simulado'};generated.archive=exportPlanArchive();const gs=allGeneratedSessions(generated.archive)[0];generated.state.logs[gs.id]={...log('Treino do plano gerado'),date:gs.date};
const normalized=documentRows(generated,A);assert.deepEqual(rowsDocument(normalized,A),validateAccountDocument(generated,A));assert.ok([...normalized.values()].filter(r=>r.kind==='plans').every(r=>r.data.plan.weeks.every(w=>!('sessions'in w))));
store(A,generated,1);const generatedDevice=device();await generatedDevice.context.connectAccount(A);assert.ok(generatedDevice.doc.state.logs[gs.id]);assert.equal(generatedDevice.doc.archive.plans[0].active,true);
stores.clear();const one=device();await one.context.connectAccount(A);one.change('Primeiro aparelho');await one.context.synchronize();assert.ok(posted.at(-1).changes.every(r=>['sessions','diary'].includes(r.kind)));
const two=device();await two.context.connectAccount(A);
one.change('Edição no primeiro');two.change('Outro treino no segundo',id2);await one.context.synchronize();await two.context.synchronize();assert.equal(two.context.hasSyncConflict(),false);assert.equal(two.doc.state.logs[id].notes,'Edição no primeiro');assert.equal(two.doc.state.logs[id2].notes,'Outro treino no segundo');
const last=posted.at(-1).changes;assert.equal(last.filter(r=>r.kind==='diary').length,1);assert.equal(last.find(r=>r.kind==='diary').id,id2);
await one.context.synchronize();one.change('Conflito local');two.change('Conflito remoto');await two.context.synchronize();await one.context.synchronize();assert.equal(one.context.hasSyncConflict(),true);await one.context.resolveSync(false);assert.equal(one.doc.state.logs[id].notes,'Conflito remoto');assert.ok(one.doc.state.logs[id2]);assert.ok(one.storage.get('dez-voltas-cloud-v2:'+A+':recovery').includes('Conflito local'));
one.change('Local escolhido');two.change('Remoto concorrente');await two.context.synchronize();await one.context.synchronize();assert.equal(one.context.hasSyncConflict(),true);await one.context.resolveSync(true);assert.equal(rowsDocument(stores.get(A).rows,A).state.logs[id].notes,'Local escolhido');
one.remove(id2);await one.context.synchronize();await two.context.synchronize();assert.equal(two.doc.state.logs[id2],undefined);assert.equal(stores.get(A).rows.get('diary:'+id2).data,null);
offline=true;two.change('Offline persistido',id2);await two.context.synchronize();assert.equal(two.context.accountSyncReady(A),false);const resumed=device(two.storage);resumed.context.resumeAccountSync();await new Promise(r=>setImmediate(r));assert.ok(resumed.doc.state.logs[id2]);offline=false;await resumed.context.synchronize();assert.equal(rowsDocument(stores.get(A).rows,A).state.logs[id2].notes,'Offline persistido');assert.equal(resumed.context.accountSyncReady(A),true);assert.equal(resumed.context.accountSyncReady(B),false);
resumed.change('Pedido enviado');writeHook=()=>resumed.change('Editado durante o envio');await resumed.context.synchronize();assert.equal(resumed.doc.state.logs[id].notes,'Editado durante o envio');await resumed.context.synchronize();assert.equal(rowsDocument(stores.get(A).rows,A).state.logs[id].notes,'Editado durante o envio');
resumed.change('Resposta perdida');loseAck=true;await resumed.context.synchronize();await resumed.context.synchronize();assert.equal(resumed.context.hasSyncConflict(),false);assert.equal(resumed.doc.state.logs[id].notes,'Resposta perdida');
const noOp=posted.length;resumed.context.accountChanged();await resumed.context.synchronize();assert.equal(posted.length,noOp);
await resumed.context.connectAccount(null);assert.equal(Object.keys(resumed.doc.state.logs).length,0);await resumed.context.connectAccount(B);assert.equal(Object.keys(resumed.doc.state.logs).length,0);
// Existing clean v1 caches load the migrated server; dirty v1 caches preserve local changes.
const original=empty(A);original.state.logs[id]=log('Legado');store(A,original,7);const cache=new Map([['dez-voltas-cloud-v1:'+A,JSON.stringify({revision:7,dirty:true,document:{...original,state:{...original.state,logs:{[id]:log('Legado offline')}}}})]]);const migrated=device(cache);await migrated.context.connectAccount(A);assert.equal(migrated.doc.state.logs[id].notes,'Legado offline');assert.equal(migrated.context.hasSyncConflict(),false);
assert.throws(()=>validateAccountDocument({...empty(A),archive:{version:1,owner:B,plans:[]}},A),/outra conta/);
// API validates authorization, migration, changed-row ownership and legacy retirement.
const originalFetch=globalThis.fetch;let db=null,legacyReads=0,dbChanges=[];
globalThis.fetch=async(url,options)=>{
 if(url.endsWith('/auth/v1/user'))return Response.json({id:A,email:'runner@example.com',email_confirmed_at:'2026-01-01'});
 assert.equal(options.headers.Authorization,'Bearer private-session');assert.equal(options.headers.apikey,'publishable');const body=options.body?JSON.parse(options.body):null;
 if(url.includes('/rest/v1/account_data?')){legacyReads++;assert.ok(url.includes('user_id=eq.'+A));return Response.json([{revision:7,document:original}]);}
 if(url.endsWith('/rpc/initialize_training_store')){assert.equal(body.expected_legacy_revision,7);db=new Map(body.initial_rows.map(r=>[rowKey(r),{...r,revision:1}]));return Response.json({initialized:true,cursor:1,legacy_revision:7,rows:[...db.values()]});}
 if(url.endsWith('/rpc/read_training_store'))return Response.json(db?{initialized:true,cursor:1,legacy_revision:7,rows:[...db.values()]}:{initialized:false,cursor:0,rows:[]});
 if(url.endsWith('/rpc/apply_training_changes')){dbChanges=body.changes;for(const r of body.changes)db.set(rowKey(r),{...r,revision:r.revision+1});return Response.json({});}throw Error(url);
};
const env={SUPABASE_URL:'https://supabase.example',SUPABASE_ANON_KEY:'publishable',APP_ORIGIN:'https://app.example'};
const req=(body,path='sync')=>new Request('https://app.example/api/account/'+path,{method:body?'POST':'GET',headers:{origin:'https://app.example','content-type':'application/json',cookie:'__Host-dv-access=private-session'},...(body?{body:JSON.stringify(body)}:{})});
let api=await handleApi(req(),env);assert.equal(api.status,200);assert.equal(legacyReads,1);assert.ok((await api.json()).rows.some(r=>r.kind==='diary'));
const proposed=copy(original);proposed.state.logs[id].notes='API editada';const delta=rowChanges(db,proposed,A);assert.equal(delta.length,1);assert.equal((await handleApi(req({cursor:1,changes:delta}),env)).status,200);assert.equal(dbChanges.length,1);assert.equal(dbChanges[0].kind,'diary');
assert.equal((await handleApi(req({cursor:1,changes:delta}),env)).status,409);assert.equal((await handleApi(req(undefined,'data'),env)).status,426);assert.equal((await handleApi(new Request('https://app.example/api/account/sync'),env)).status,401);
assert.equal((await handleApi(req({cursor:1,changes:[{kind:'diary',id:'unknown',revision:0,data:log('invalid')}]}),env)).status,400);
globalThis.fetch=originalFetch;
console.log('PASS: banco relacional, migração v1/v2, envio de um registro, combinação de treinos diferentes, conflito no mesmo treino, exclusão, offline, edição em voo, resposta perdida, isolamento e API autenticada.');
