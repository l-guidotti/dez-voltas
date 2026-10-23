import {validateProfile,validateSuggestion} from './training-contract.js';
export const PLAN_ARCHIVE_KEY='dez-voltas-active-plans-v1';
const empty=()=>({version:1,owner:null,plans:[]});
const clone=x=>JSON.parse(JSON.stringify(x));
function ownerId(x){if(typeof x!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(x))throw new Error('Conta do plano inválida.');return x;}
export function checkedSuggestion(raw){
 const profile=validateProfile(raw?.profile,raw?.profile?.startDate,{allowReview:true});
 const plan=validateSuggestion(raw?.plan,profile);
 if(typeof raw.generatedAt!=='string'||raw.generatedAt.length>80||!Number.isFinite(Date.parse(raw.generatedAt)))throw new Error('Data de geração inválida.');
 return {version:1,profile,plan,generatedAt:raw.generatedAt,model:String(raw.model||'Gemini').slice(0,120)};
}
function planId(result,owner){const text=owner+JSON.stringify(result);let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return 'ai-'+Date.parse(result.generatedAt).toString(36)+'-'+(h>>>0).toString(36);}
export function validatePlanArchive(raw){
 if(raw?.version!==1||!Array.isArray(raw.plans)||raw.plans.length>100)throw new Error('Arquivo de planos inválido.');
 const out={version:1,owner:raw.owner===null?null:ownerId(raw.owner),plans:[]},ids=new Set(),activeOwners=new Set();
 for(const entry of raw.plans){const result=checkedSuggestion(entry),owner=ownerId(entry.owner),id=planId(result,owner);if(entry.id!==id||ids.has(id))throw new Error('Identificação de plano inválida.');ids.add(id);const active=entry.active===true;if(active&&activeOwners.has(owner))throw new Error('Mais de um plano ativo para a conta.');if(active)activeOwners.add(owner);out.plans.push({...result,id,owner,active});}
 return out;
}
let archive=empty();try{const saved=JSON.parse(localStorage.getItem(PLAN_ARCHIVE_KEY)||'null');if(saved)archive=validatePlanArchive(saved);}catch{}
function persist(next){localStorage.setItem(PLAN_ARCHIVE_KEY,JSON.stringify(next));archive=next;if(typeof window!=='undefined')window.dispatchEvent(new Event('account-data-change'));}
export function setPlanOwner(owner){const id=owner===null?null:ownerId(owner);if(archive.owner===id)return;const next={...archive,owner:id};try{persist(next);}catch{archive=next;}}
export function getActivePlan(){return archive.plans.find(x=>x.owner===archive.owner&&x.active)||null;}
export function adoptSuggestion(owner,raw){owner=ownerId(owner);const result=checkedSuggestion(raw),id=planId(result,owner);const existing=archive.plans.find(x=>x.id===id);if(existing&&(existing.owner!==owner||JSON.stringify(checkedSuggestion(existing))!==JSON.stringify(result)))throw new Error('Identificação já utilizada por outro plano.');const plans=archive.plans.filter(x=>x.id!==id).map(x=>x.owner===owner?{...x,active:false}:x);plans.push({...result,id,owner,active:true});if(plans.length>100)throw new Error('Limite de planos locais atingido. Exporte um backup antes de continuar.');persist({version:1,owner,plans});return getActivePlan();}
export function useOriginalPlan(){persist({...archive,plans:archive.plans.map(x=>x.owner===archive.owner?{...x,active:false}:x)});}
export function exportPlanArchive(){return clone(archive);}
export function mergePlanArchive(raw){const incoming=validatePlanArchive(raw),plans=new Map(archive.plans.map(x=>[x.id,x]));for(const item of incoming.plans){if(item.active)for(const [id,p]of plans)if(p.owner===item.owner)plans.set(id,{...p,active:false});plans.set(item.id,item);}persist(validatePlanArchive({version:1,owner:archive.owner||incoming.owner,plans:[...plans.values()]}));}
export function sessionsForPlan(entry){return entry.plan.weeks.flatMap((w,i)=>w.sessions.map((s,j)=>({...s,id:`${entry.id}-w${i+1}s${j}`,week:i+1,generated:true,planId:entry.id})));}
export function allGeneratedSessions(raw=archive){return raw.plans.flatMap(sessionsForPlan);}
export function visibleGeneratedSessions(){return archive.plans.filter(x=>x.owner===archive.owner).flatMap(sessionsForPlan);}

export function replaceOwnerArchive(owner,raw){
 const incoming=validatePlanArchive(raw);
 if(incoming.owner!==owner||incoming.plans.some(p=>p.owner!==owner))throw new Error('Arquivo de outra conta.');
 persist(validatePlanArchive({version:1,owner,plans:[...archive.plans.filter(p=>p.owner!==owner),...incoming.plans]}));
}

export function suggestionId(raw,owner){return planId(checkedSuggestion(raw),ownerId(owner));}
