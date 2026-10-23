import {validatePlanArchive,checkedSuggestion,allGeneratedSessions} from './active-plan.js';
import {validateStoredProfile} from './training-contract.js';
import {SESSIONS} from './plan.js';
export function validateAccountDocument(raw,owner){
 if(raw?.version!==1)throw new Error('Formato de sincronização inválido.');
 const archive=validatePlanArchive(raw.archive);
 if(archive.owner!==owner||archive.plans.some(p=>p.owner!==owner))throw new Error('Plano de outra conta.');
 let profile=null;
 if(raw.profile!==null){
  const p=raw.profile;
  if(p?.plan)profile=checkedSuggestion(p);
  else profile={profile:validateStoredProfile(p?.profile,p?.profile?.startDate)};
 }
 const sources=new Map([...SESSIONS,...allGeneratedSessions(archive)].map(s=>[s.id,s]));
 const logs={};
 if(!raw.state||typeof raw.state.logs!=='object'||!raw.state.logs||Array.isArray(raw.state.logs)||Object.keys(raw.state.logs).length>3000)throw new Error('Registros inválidos.');
 for(const [id,x] of Object.entries(raw.state.logs)){
  const s=sources.get(id);
  if(!s||!x||!Number.isFinite(x.km)||x.km<0||(!s.generated&&x.km===0)||x.km>150||!Number.isFinite(x.minutes)||x.minutes<=0||x.minutes>1440||!Number.isInteger(x.rpe)||x.rpe<1||x.rpe>10||!['none','mild','stop'].includes(x.pain)||typeof x.notes!=='string'||x.notes.length>1500||!Number.isFinite(Date.parse(x.updatedAt)))throw new Error('Registro de treino inválido.');
  logs[id]={km:x.km,minutes:x.minutes,rpe:x.rpe,pain:x.pain,notes:x.notes,date:s.date,updatedAt:x.updatedAt};
 }
 const checklist={};for(let i=0;i<8;i++)checklist[i]=raw.state.checklist?.[i]===true;
 const draft=raw.draft?validateStoredProfile(raw.draft,raw.draft.startDate):null;
 return {version:1,profile,draft,archive,state:{version:1,logs,checklist,timer:null}};
}
