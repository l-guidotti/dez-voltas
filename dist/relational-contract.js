import {validateAccountDocument} from './sync-contract.js';
import {checkedSuggestion,suggestionId,sessionsForPlan} from './active-plan.js';
import {SESSIONS} from './plan.js';
export const kinds=['profiles','plans','sessions','diary','settings'];
export const rowKey=row=>row.kind+':'+row.id;
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const same=(a,b)=>canonical(a)===canonical(b);
export function documentRows(input,owner){
 const doc=validateAccountDocument(input,owner),rows=new Map();
 const put=(kind,id,data)=>rows.set(kind+':'+id,{kind,id,data});
 const entries=new Map(doc.archive.plans.map(p=>[p.id,p]));
 let suggestion=null;
 if(doc.profile?.plan){suggestion=suggestionId(doc.profile,owner);if(!entries.has(suggestion))entries.set(suggestion,{...checkedSuggestion(doc.profile),id:suggestion,owner,active:false});}
 put('profiles','profile',{draft:doc.draft,form_profile:doc.profile&&!doc.profile.plan?doc.profile.profile:null,suggestion_id:suggestion});
 put('settings','settings',{active_plan_id:doc.archive.plans.find(p=>p.active)?.id||null,checklist:doc.state.checklist});
 for(const entry of entries.values()){
  const adopted=doc.archive.plans.some(p=>p.id===entry.id);
  put('plans',entry.id,{profile:entry.profile,plan:{...entry.plan,weeks:entry.plan.weeks.map(({sessions,...week})=>week)},generated_at:entry.generatedAt,model:entry.model,adopted});
  for(const session of sessionsForPlan(entry))put('sessions',session.id,{plan_id:entry.id,week:session.week,date:session.date,title:session.title,km:session.km,minutes:session.minutes,rpe:session.rpe,long_run:session.long,instructions:session.instructions});
 }
 for(const [id,log]of Object.entries(doc.state.logs)){
  if(!rows.has('sessions:'+id)){const s=SESSIONS.find(s=>s.id===id);if(!s)throw new Error('Sessão desconhecida.');put('sessions',id,{plan_id:null,week:s.week,date:s.date,title:s.title,km:s.km,minutes:null,rpe:null,long_run:s.long,instructions:''});}
  put('diary',id,{km:log.km,minutes:log.minutes,rpe:log.rpe,pain:log.pain,notes:log.notes,recorded_at:log.updatedAt,session_date:log.date});
 }
 return rows;
}
export function rowsDocument(rows,owner){
 const alive=[...rows.values()].filter(r=>r.data!==null),profiles=rows.get('profiles:profile')?.data||{},settings=rows.get('settings:settings')?.data||{};
 const sessions=alive.filter(r=>r.kind==='sessions');const entries=new Map();
 for(const row of alive.filter(r=>r.kind==='plans')){
  const d=row.data,plan={...d.plan,weeks:d.plan.weeks.map((week,i)=>({...week,sessions:sessions.filter(s=>s.data.plan_id===row.id&&s.data.week===i+1).sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true})).map(s=>{const x=s.data;return {date:x.date,title:x.title,km:x.km,minutes:x.minutes,rpe:x.rpe,long:x.long_run,instructions:x.instructions};})}))};
  const result=checkedSuggestion({version:1,profile:d.profile,plan,generatedAt:d.generated_at,model:d.model});
  if(suggestionId(result,owner)!==row.id)throw new Error('Identificação de plano inválida no banco.');
  entries.set(row.id,{...result,id:row.id,owner,active:row.id===settings.active_plan_id});
 }
 const plans=alive.filter(r=>r.kind==='plans'&&r.data.adopted).map(r=>entries.get(r.id));
 if(settings.active_plan_id&&!plans.some(p=>p.id===settings.active_plan_id))throw new Error('Plano ativo ausente.');
 let profile=profiles.form_profile?{profile:profiles.form_profile}:null;
 if(profiles.suggestion_id){const entry=entries.get(profiles.suggestion_id);if(!entry)throw new Error('Sugestão ausente.');profile=checkedSuggestion(entry);}
 const logs={};for(const row of alive.filter(r=>r.kind==='diary')){const d=row.data;logs[row.id]={km:d.km,minutes:d.minutes,rpe:d.rpe,pain:d.pain,notes:d.notes,updatedAt:d.recorded_at};}
 return validateAccountDocument({version:1,profile,draft:profiles.draft||null,archive:{version:1,owner,plans},state:{version:1,logs,checklist:settings.checklist||{},timer:null}},owner);
}
export function rowChanges(base,doc,owner){
 const desired=documentRows(doc,owner),changes=[];
 for(const [key,row]of desired){const before=base.get(key);if(!same(before?.data??null,row.data))changes.push({...row,revision:before?.revision||0});}
 // Plans and session definitions remain as historical artifacts; only diary rows are removed.
 for(const [key,row]of base)if(row.data!==null&&!desired.has(key)&&row.kind==='diary')changes.push({kind:row.kind,id:row.id,revision:row.revision,data:null});
 return changes;
}
export function overlayRows(base,changes){const next=new Map(base);for(const row of changes)next.set(rowKey(row),row);return next;}
export function validateChanges(raw){
 if(!Array.isArray(raw)||raw.length>6000)throw new Error('Lista de alterações inválida.');const seen=new Set();
 for(const row of raw){if(!row||!kinds.includes(row.kind)||typeof row.id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(row.id)||!Number.isSafeInteger(row.revision)||row.revision<0||row.data!==null&&(!row.data||typeof row.data!=='object'||Array.isArray(row.data))||seen.has(rowKey(row)))throw new Error('Alteração de registro inválida.');if(['profiles','settings'].includes(row.kind)&&row.id!==(row.kind==='profiles'?'profile':'settings'))throw new Error('Identificação de registro inválida.');seen.add(rowKey(row));}
 return raw;
}
