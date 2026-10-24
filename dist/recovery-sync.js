import {validateRecovery,recoveryDay} from './recovery-contract.js';
import {addDate,localToday} from './training-contract.js';
const clone=x=>JSON.parse(JSON.stringify(x)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function createRecoverySync({request,read,write,uuid,changed=()=>{},today=localToday}){
 let owner=null,epoch=0,running=null,ready=false,message='',data={records:{},pending:{},drafts:{}};
 const key=id=>'dez-voltas-recovery-v1:'+id;
 const emit=()=>changed();
 function persist(){if(!owner)return;write(key(owner),JSON.stringify({version:1,...data}));}
 function select(id){epoch++;owner=id;running=null;ready=false;data={records:{},pending:{},drafts:{}};message=id?'Conferindo os registros diários…':'Entre na conta para registrar sua recuperação.';
  if(id)try{const raw=read(key(id));if(raw){const saved=JSON.parse(raw);if(saved.version!==1)throw Error();for(const [day,r]of Object.entries(saved.records||{})){validateRecovery(r.report);if(!Number.isSafeInteger(r.revision)||r.revision<1||r.day!==day)throw Error();}for(const p of Object.values(saved.pending||{})){validateRecovery(p.report);if(p.nextReport)validateRecovery(p.nextReport);}data={records:saved.records||{},pending:saved.pending||{},drafts:saved.drafts||{}};}}catch{message='Não foi possível ler a cópia diária local. Confira os registros da conta antes de salvar.';}
  emit();
 }
 function entries(){const rows=clone(data.records);for(const [day,p]of Object.entries(data.pending))rows[day]={day,report:clone(p.nextReport||p.report),revision:p.baseRevision,pending:true,conflict:!!p.conflict};return Object.values(rows).sort((a,b)=>b.day.localeCompare(a.day));}
 function saveDraft(day,report){if(!owner)return;data.drafts[day]=clone(report);persist();}
 function save(day,report){if(!owner)throw Error('Entre na conta.');day=recoveryDay(day,today());report=validateRecovery(report);const p=data.pending[day];
  if(p?.started||p?.conflict)p.nextReport=report;else data.pending[day]={baseRevision:p?.baseRevision??data.records[day]?.revision??0,mutationId:uuid(),report,started:false};
  delete data.drafts[day];ready=false;persist();message='Check-in salvo neste aparelho. Aguardando sincronização…';emit();
 }
 function record(raw){if(!raw||!Number.isSafeInteger(raw.revision)||raw.revision<1||typeof raw.day!=='string')throw Error('Registro diário inválido na conta.');return {...raw,report:validateRecovery(raw.report)};}
 async function sync(){if(!owner)return;if(running)return running;const ticket=epoch,id=owner;ready=false;
  const work=(async()=>{try{
   const response=await request(id);if(ticket!==epoch)return;for(const raw of response.records||[]){const r=record(raw);data.records[r.day]=r;}
   for(let count=0;count<56;count++){
    const pair=Object.entries(data.pending).sort(([a],[b])=>a.localeCompare(b)).find(([,p])=>!p.conflict);if(!pair)break;
    const [day,p]=pair;p.started=true;persist();
    let response;
    try{response=await request(id,{day,report:p.report,revision:p.baseRevision,mutationId:p.mutationId});}
    catch(e){if(ticket!==epoch)return;if(e.status===409){if(e.record)data.records[day]=record(e.record);p.conflict=true;persist();continue;}throw e;}
    if(ticket!==epoch)return;const saved=record(response.record);data.records[day]=saved;
    const pending=data.pending[day];if(pending?.mutationId===p.mutationId){const next=pending.nextReport;if(next&&!same(next,p.report))data.pending[day]={baseRevision:saved.revision,mutationId:uuid(),report:next,started:false};else delete data.pending[day];}persist();
   }
   if(ticket!==epoch)return;
   for(const day of Object.keys(data.records))if(day<addDate(today(),-60)&&!data.pending[day])delete data.records[day];
   persist();ready=!Object.keys(data.pending).length;message=Object.values(data.pending).some(p=>p.conflict)?'Há um dia alterado nos dois aparelhos. Escolha qual registro manter.':ready?'Check-ins sincronizados com sua conta.':'Há check-ins aguardando envio.';
  }catch(e){if(ticket!==epoch)return;message=e.message||'Sem conexão. Seus check-ins continuam neste aparelho.';}finally{if(ticket===epoch){running=null;emit();}}})();running=work;return work;
 }
 function resolve(day,useLocal){const p=data.pending[day];if(!p?.conflict)return;if(useLocal)data.pending[day]={baseRevision:data.records[day]?.revision||0,mutationId:uuid(),report:clone(p.nextReport||p.report),started:false};else delete data.pending[day];delete data.drafts[day];ready=false;persist();emit();}
 return {select,owner:()=>owner,entries,save,sync,resolve,saveDraft,draft:day=>clone(data.drafts[day]||null),ready:()=>ready&&!running&&!Object.keys(data.pending).length,busy:()=>!!running,message:()=>message,conflict:day=>!!data.pending[day]?.conflict};
}
