import {synchronizeRecovery,dailyRecoveryReady} from './daily-recovery.js';
import {sessionFetch} from './session-client.js';
import {checkedSuggestion,getActivePlan} from './active-plan.js';
import {activeSyncOwner,synchronize,hasSyncConflict,accountSyncReady} from './account-sync.js';
import {validateWeeklyCheckin} from './weekly-contract.js';
import {localToday} from './training-contract.js';
import {applyPlanSuggestion,renderResult} from './profile.js';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=null,owner=null,planId=null,message='',busy=false,reading=false,draft=null,serial=0,weeklyTimer=null;
const retryRequests=new Map();
let selectedJob=null,proposal=null;
const changed=()=>window.dispatchEvent(new Event('weekly-review-change'));
function identity(){const p=getActivePlan();return p&&p.owner===activeSyncOwner()?p:null;}
const reviewing=()=>location.hash==='#revisao';
const onHome=()=>!location.hash||location.hash==='#hoje';
function currentJob(){
 if(state?.reviewJob?.status!=='completed'||!state.checkin?.job_id)return null;
 return {id:state.checkin.job_id,sourcePlanId:state.planId};
}
async function loadProposal(job,plan,force=false){
 if(!job||!plan||(!force&&proposal?.id===job.id&&proposal.planId===plan.id&&proposal.owner===plan.owner))return;
 const loading={id:job.id,planId:plan.id,owner:plan.owner};
 proposal=loading;
 changed();
 try{
  const response=await sessionFetch('/api/training/jobs?id='+encodeURIComponent(job.id),{
   credentials:'same-origin',headers:{'x-dv-training-format':'4','x-account-id':plan.owner},signal:AbortSignal.timeout(25000)
  });
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Não foi possível abrir a revisão.');
  if(data.job?.id!==job.id||data.job.kind!=='weekly_review'||data.job.status!=='completed')throw Error('Esta revisão ainda não está disponível.');
  const result=checkedSuggestion(data.job.result);
  if(result.profile.review?.sourcePlanId!==job.sourcePlanId)throw Error('A proposta não corresponde a este fechamento.');
  if(proposal===loading&&identity()?.id===plan.id&&identity()?.owner===plan.owner){loading.result=result;changed();}
 }catch(error){
  if(proposal===loading&&identity()?.id===plan.id&&identity()?.owner===plan.owner){loading.error=error.message;changed();}
 }
}
function displayedProposal(job){
 const plan=identity();
 return job&&plan&&proposal?.id===job.id&&proposal.owner===plan.owner&&proposal.planId===plan.id?proposal:null;
}
export function renderWeeklyHomeNotice(){
 const plan=identity();
 if(!plan||owner!==plan.owner||planId!==plan.id||!state)return '';
 const job=currentJob();
 if(job){
  const summary=displayedProposal(job)?.result?.plan.summary;
  return `<section class="weekly-home-card weekly-home-ready" role="status"><span class="eyebrow">REVISÃO SEMANAL</span><h2>Sua sugestão da semana está pronta</h2><p>${esc(summary||'Veja os ajustes sugeridos para os próximos treinos e decida se quer aplicá-los.')}</p><a class="primary" href="#revisao">Ver minha revisão</a></section>`;
 }
 if(state.canSave&&!state.checkin?.job_id&&(!state.checkin||state.checkin.report?.consent!==true)){
  const title=state.checkin?'Confirme o envio da sua revisão semanal':'É hora de fechar sua semana';
  return `<section class="weekly-home-card" role="status"><span class="eyebrow">REVISÃO SEMANAL</span><h2>${title}</h2><p>Confira os treinos registrados e conte como você se sentiu para receber os ajustes do seu plano.</p><a class="primary" href="#revisao">Preencher fechamento semanal</a></section>`;
 }
 if(state.checkin?.report?.consent===true){
  const error=state.checkin.queue_error||state.reviewJob?.error;
  const failed=!!state.checkin.queue_error||state.reviewJob?.status==='failed';
  const waiting=!state.checkin.job_id&&localToday()<=state.weekEnd&&!failed;
  const title=failed?'Sua revisão precisa de atenção':waiting?'Fechamento semanal salvo':'Sua revisão semanal está em andamento';
  const detail=failed?error||'Abra a revisão para consultar o que aconteceu.':waiting?'A sugestão entra na fila depois da meia-noite, no horário de Brasília.':'A sugestão aparecerá aqui assim que estiver pronta.';
  return `<section class="weekly-home-card" role="status"><span class="eyebrow">REVISÃO SEMANAL</span><h2>${title}</h2><p>${esc(detail)}</p><a class="secondary" href="#revisao">Acompanhar revisão</a></section>`;
 }
 return '';
}
async function request(body,expectedOwner,action=''){
 const r=await sessionFetch('/api/training/weekly-review'+action,{method:body?'POST':'GET',credentials:'same-origin',headers:{'x-dv-training-format':'4','x-account-id':expectedOwner,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
 const data=await r.json();if(!r.ok)throw Error(data.error||'Não foi possível consultar o fechamento semanal.');return data;
}
export async function refreshWeeklyReview(manual=false){
 const p=identity();if(!p){serial++;state=null;owner=null;planId=null;draft=null;selectedJob=null;proposal=null;clearTimeout(weeklyTimer);changed();return;}
 if(reading)return;reading=true;const ticket=++serial;
 try{const data=await request(null,p.owner);if(ticket!==serial||identity()?.id!==p.id||identity()?.owner!==p.owner)return;
  if(data.planId!==p.id){message='Sincronize o plano em uso antes de fechar a semana.';state=null;owner=p.owner;planId=p.id;changed();return;}
  const reset=owner!==p.owner||planId!==p.id||state?.weekStart!==data.weekStart||state?.checkin?.revision!==data.checkin?.revision;
  const updated=JSON.stringify(state)!==JSON.stringify(data);
  if(owner!==p.owner||planId!==p.id){selectedJob=null;proposal=null;}
  owner=p.owner;planId=p.id;state=data;if(reset)draft=data.checkin?.report||null;
  if(manual)message='Fechamento atualizado com os dados da conta.';
  if(updated||manual)changed();
  if(reviewing()||onHome())void loadProposal(reviewing()?(selectedJob||currentJob()):currentJob(),p,manual);
 }catch(e){if(ticket===serial&&identity()?.id===p.id){owner=p.owner;planId=p.id;message=e.name==='TimeoutError'?'A consulta demorou. Tente atualizar novamente.':'Sem acesso ao fechamento. '+e.message;changed();}}
 finally{reading=false;if(ticket!==serial&&identity())void refreshWeeklyReview();
  clearTimeout(weeklyTimer);
  if(document.visibilityState==='visible'&&(onHome()||reviewing())&&identity()){
   const waiting=state?.checkin?.report?.consent===true&&!state.checkin.queue_error&&localToday()>state.weekEnd&&(!state.checkin.job_id||!state.reviewJob||['queued','processing','retrying'].includes(state.reviewJob.status));
   weeklyTimer=setTimeout(()=>void refreshWeeklyReview(),waiting?15000:60000);
  }
 }
}
function retryControls(row){
 const pending=['queued','processing','retrying'].includes(row.status);
 const view=row.job_id&&row.status==='completed'?`<button type="button" class="secondary" data-weekly="result" data-job="${esc(row.job_id)}">Ver esta proposta</button>`:'';
 const button=row.can_retry?`<button type="button" class="primary" data-weekly="retry" data-week="${esc(row.week_start)}" data-revision="${esc(row.revision)}" ${busy?'disabled':''}>${busy?'Solicitando…':'Solicitar nova revisão ao Gemini'}</button>`:pending?'<button type="button" class="secondary" disabled>Revisão em andamento</button>':'';
 return `<div class="weekly-retry"><div class="profile-buttons">${button}${view}</div>${row.can_retry?'<p class="field-help">Envia novamente o fechamento autorizado e os registros sincronizados ao Google Gemini. A proposta anterior fica preservada; a nova só entra no calendário se você escolher usá-la. Disponível nos 7 dias após o encerramento da semana, para o plano em uso.</p>':''}</div>`;
}
export function renderWeeklyReview(){
 const p=identity();if(!p)return '<section class="panel"><p>Ative um plano para fazer seu fechamento semanal.</p><a class="secondary" href="#plano">Ver meu plano</a></section>';
 if(owner!==p.owner||planId!==p.id||!state)return `<section class="panel" id="weekly-review"><h2>Evolução da sua preparação</h2><p>Feche cada semana para revisar os próximos treinos com o que você realizou e como se recuperou.</p><button type="button" class="secondary" data-weekly="refresh">Consultar fechamento semanal</button><p role="status">${owner===p.owner?esc(message):''}</p></section>`;
 const history=(state.history||[]).filter(x=>x.week_start!==state.weekStart||x.source_plan_id!==p.id);
 const saved=state.checkin,report=draft||saved?.report||{fatigue:'',sleep:'',readiness:'',pain:'',illness:false,complete:false,consent:false,days:p.profile.days,maxMinutes:p.profile.maxMinutes,longMinutes:p.profile.longMinutes,notes:''};
 const locked=!!saved?.job_id,disabled=busy||locked||!state.canSave;
 const job=state.reviewJob;
 const chosen=selectedJob||currentJob();
 const suggestion=displayedProposal(chosen);
 const preview=suggestion?.result?renderResult(suggestion.result,true):suggestion?.error?`<section class="panel"><p role="status">${esc(suggestion.error)}</p><button type="button" class="secondary" data-weekly="refresh">Tentar novamente</button></section>`:chosen?'<p class="notice" role="status">Abrindo sua proposta…</p>':'';
 const progress=job?.status==='failed'?'A revisão não foi concluída. '+(job.error||'Tente solicitar a revisão novamente quando estiver disponível.'):job?.status==='completed'?'Sua revisão está pronta. Confira a sugestão e escolha se quer aplicá-la aos próximos treinos.':job?.status==='processing'?'O Gemini está revisando seus registros.':job?.status==='retrying'?'A revisão aguarda uma nova tentativa automática.':'Fechamento enviado. A revisão aguarda processamento na fila.';
 const scale=(name,label,low,high)=>`<label class="field">${label}<select name="${name}" required ${disabled?'disabled':''}><option value="">Selecione</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${report[name]===n?'selected':''}>${n}${n===1?' · '+low:n===5?' · '+high:''}</option>`).join('')}</select></label>`;
 return `${preview}<section class="panel" id="weekly-review"><span class="eyebrow muted">EVOLUÇÃO DO TREINO</span><h2>Como foi sua semana?</h2><p><strong>${esc(state.weekStart)} a ${esc(state.weekEnd)}</strong> · semanas de 7 dias contadas a partir do início do bloco.</p><div class="notice">No diário sincronizado: ${esc(state.stats.registered)} registro(s), ${esc(state.stats.km)} km e ${esc(state.stats.minutes)} min. ${esc(state.planned)} sessão(ões) planejada(s) para esta semana. Registros ausentes não comprovam recuperação nem treino concluído.</div>${state.recoveryStats?`<div class="notice">Check-ins diários sincronizados: ${esc(state.recoveryStats.days)}/7 dias · ${esc(state.recoveryStats.activityMinutes)} min de outras atividades. Ausências não comprovam recuperação.</div>`:''}${!state.canSave?'<p class="field-help">O fechamento fica disponível no último dia da semana, enquanto houver preparação pela frente. A revisão é enfileirada depois que a semana terminar.</p>':''}${locked?'<p class="notice">'+esc(progress)+' Este retrato da semana fica preservado.</p>':''}${saved?retryControls({...saved,week_start:state.weekStart,can_retry:state.canRetry,status:job?.status}):''}${saved?.queue_error?`<p class="notice">${esc(saved.queue_error)}</p>`:''}<form id="weekly-checkin" data-plan="${esc(planId)}" data-week="${esc(state.weekStart)}"><div class="profile-grid">${scale('fatigue','Fadiga ao final da semana','muito baixa','muito alta')}${scale('sleep','Qualidade do sono na semana','muito ruim','muito boa')}${scale('readiness','Disposição para treinar','muito baixa','muito alta')}<label class="field">Dor ou incômodo na semana<select name="pain" required ${disabled?'disabled':''}><option value="">Selecione</option>${[['none','Sem dor'],['mild','Incômodo leve'],['stop','Dor que pediu parar']].map(([v,t])=>`<option value="${v}" ${report.pain===v?'selected':''}>${t}</option>`).join('')}</select></label></div><label class="profile-consent"><input type="checkbox" name="illness" ${report.illness?'checked':''} ${disabled?'disabled':''}> Tive doença ou sintomas que afetaram os treinos.</label><label class="profile-consent"><input type="checkbox" name="complete" ${report.complete?'checked':''} ${disabled?'disabled':''}> Registrei todos os treinos realizados nesta semana. Os treinos sem registro não foram realizados.</label><fieldset class="profile-days"><legend>Dias disponíveis na próxima semana (até 6)</legend>${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map((day,i)=>`<label><input type="checkbox" name="days" value="${i}" ${report.days.includes(i)?'checked':''} ${disabled?'disabled':''}> ${day}</label>`).join('')}</fieldset><div class="profile-grid"><label class="field">Tempo por treino comum (min)<input name="maxMinutes" type="number" min="20" max="360" value="${esc(report.maxMinutes)}" required ${disabled?'disabled':''}></label><label class="field">Tempo para o longo (min)<input name="longMinutes" type="number" min="20" max="600" value="${esc(report.longMinutes)}" required ${disabled?'disabled':''}></label></div><label class="field">O que afetou os treinos ou muda na próxima semana?<textarea name="notes" maxlength="1000" ${disabled?'disabled':''} placeholder="Rotina, recuperação, viagem ou motivo de treinos não realizados…">${esc(report.notes)}</textarea></label><label class="profile-consent"><input type="checkbox" name="consent" ${report.consent?'checked':''} ${disabled?'disabled':''}> Autorizo enviar ao Google Gemini este fechamento e os registros de treino e check-ins diários de recuperação dos últimos 28 dias, incluindo sono, fadiga, disposição, dores, doença, outras atividades e observações da semana, para revisar os próximos treinos. A geração é liberada às 0h do dia seguinte ao fim da semana, no horário de Brasília. Meu e-mail não será enviado.</label><p class="field-help">Sem autorização, somente o fechamento é salvo. Cumprir os treinos não obriga aumento: dados insuficientes, fadiga, sono ruim ou dor impedem progressão. Dor e doença pedem avaliação antes de gerar cargas. Os registros diários ajudam a confirmar a recuperação. As próximas semanas podem trazer progressão projetada e variedade, sujeitas à execução e ao próximo fechamento. Preencher não garante aumento. A revisão usa a mesma fila e os mesmos limites diários da geração de planos.</p><div class="profile-buttons"><button type="submit" class="primary" ${disabled?'disabled':''}>${busy?'Salvando…':'Salvar fechamento semanal'}</button><button type="button" class="secondary" data-weekly="refresh" ${busy?'disabled':''}>Atualizar dados</button></div><p id="weekly-feedback" class="notice" role="status" aria-live="polite">${esc(message)}</p></form>${history.length?`<details><summary>Seus fechamentos anteriores</summary>${history.map(x=>`<article><p>${esc(x.week_start)} a ${esc(x.week_end)} · ${x.status==='completed'?'Proposta disponível':x.status==='failed'?'Revisão anterior não concluída':x.job_id?'Revisão enviada':x.queue_error?esc(x.queue_error):'Fechamento salvo'}</p>${retryControls(x)}</article>`).join('')}</details>`:''}</section>`;
}
function read(form){const f=new FormData(form);return {recoveryConsent:f.get('consent')==='on',fatigue:Number(f.get('fatigue')),sleep:Number(f.get('sleep')),readiness:Number(f.get('readiness')),pain:f.get('pain'),illness:f.get('illness')==='on',complete:f.get('complete')==='on',consent:f.get('consent')==='on',days:f.getAll('days').map(Number),maxMinutes:Number(f.get('maxMinutes')),longMinutes:Number(f.get('longMinutes')),notes:String(f.get('notes')||'')};}
document.addEventListener('input',e=>{const form=e.target.closest('#weekly-checkin');if(form)draft=read(form);});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='weekly-checkin')return;e.preventDefault();if(busy)return;const p=identity();if(!p||p.owner!==owner||p.id!==planId||!state?.canSave||state.checkin?.job_id)return;
 let report;try{report=validateWeeklyCheckin(read(e.target));}catch(error){message=error.message;changed();return;}
 draft=report;const week=state.weekStart,revision=state.checkin?.revision||0;busy=true;message='Sincronizando os registros antes de salvar o fechamento…';changed();
 try{
  await synchronize();await synchronizeRecovery();if(!dailyRecoveryReady())throw Error('Sincronize os check-ins diários e resolva os conflitos antes de fechar a semana.');if(hasSyncConflict())throw Error('Resolva os registros em conflito antes de enviar a semana.');if(!accountSyncReady(p.owner))throw Error('Aguarde a sincronização terminar ou reconecte antes de enviar a semana. Os dados deste aparelho precisam estar na conta.');
  if(identity()?.id!==p.id||identity()?.owner!==p.owner)throw Error('A conta ou o plano mudou. Atualize o fechamento.');
  // synchronize() must confirm there are no pending/offline changes before a snapshot is scheduled.
  const data=await request({planId:p.id,weekStart:week,report,revision},p.owner);
  if(identity()?.id!==p.id||identity()?.owner!==p.owner)return;
  state={...state,checkin:data.checkin};message=report.consent?'Fechamento salvo. A revisão entra na fila depois da meia-noite, no horário de Brasília. A proposta aparecerá em Hoje assim que estiver pronta.':'Fechamento salvo sem envio ao Gemini.';
 }catch(error){if(identity()?.owner===p.owner)message=error.message;}finally{busy=false;changed();}
});
async function retryWeeklyReview(week,revision){
 const p=identity();if(busy||!p||p.owner!==owner||p.id!==planId)return;
 const row=state?.history?.find(x=>x.week_start===week&&x.source_plan_id===p.id);
 const allowed=week===state?.weekStart?state.canRetry:row?.can_retry;if(!allowed)return;
 const key=[p.owner,p.id,week,revision].join(':');
 if(!retryRequests.has(key))retryRequests.set(key,crypto.randomUUID());
 busy=true;message='Sincronizando os registros para solicitar a nova revisão…';changed();
 try{
  await synchronize();await synchronizeRecovery();
  if(!dailyRecoveryReady()||hasSyncConflict()||!accountSyncReady(p.owner))throw Error('Sincronize os registros e resolva os conflitos antes de solicitar a revisão.');
  if(identity()?.id!==p.id||identity()?.owner!==p.owner)throw Error('A conta ou o plano mudou. Atualize o fechamento.');
  await request({planId:p.id,weekStart:week,revision,requestId:retryRequests.get(key)},p.owner,'/retry');
  if(identity()?.id!==p.id||identity()?.owner!==p.owner)return;
  serial++;await refreshWeeklyReview();message='Nova revisão solicitada. Acompanhe o processamento aqui ou em Hoje. Seu plano continua em uso até você adotar a nova proposta.';
 }catch(error){if(identity()?.id===p.id&&identity()?.owner===p.owner)message=error.message;}
 finally{busy=false;changed();}
}
document.addEventListener('click',async e=>{
 const button=e.target.closest('[data-weekly]');if(!button)return;
 if(button.dataset.weekly==='refresh')await refreshWeeklyReview(true);
 if(button.dataset.weekly==='retry')await retryWeeklyReview(button.dataset.week,Number(button.dataset.revision));
 if(button.dataset.weekly==='result'&&reviewing()){
  const id=button.dataset.job;
  const previous=state?.history?.find(row=>row.job_id===id&&row.status==='completed');
  const current=currentJob();
  const chosen=current?.id===id?current:previous?{id,sourcePlanId:previous.source_plan_id}:null;
  if(!chosen)return;
  selectedJob=chosen;
  await loadProposal(chosen,identity());
  changed();
  document.querySelector('#profile-result')?.focus();
 }
 if(button.dataset.weekly==='adopt'&&reviewing()){
  const plan=identity();
  const suggestion=displayedProposal(selectedJob||currentJob())?.result;
  if(!plan||!suggestion)return;
  try{
   applyPlanSuggestion(plan.owner,suggestion);
   location.hash='#plano';
   window.dispatchEvent(new Event('active-plan-change'));
  }catch(error){
   const status=document.querySelector('#weekly-apply-status');
   if(status)status.textContent=error.message;
  }
 }
});
export function initWeeklyReview(){
 document.addEventListener('visibilitychange',()=>{clearTimeout(weeklyTimer);if(document.visibilityState==='visible'&&(onHome()||reviewing()))void refreshWeeklyReview();});
 for(const event of ['active-plan-change','session-ended','session-expired','session-account-change'])window.addEventListener(event,()=>{if(identity()?.id!==planId||identity()?.owner!==owner){serial++;state=null;draft=null;selectedJob=null;proposal=null;message='';changed();}void refreshWeeklyReview();});
 for(const event of ['online','focus'])window.addEventListener(event,()=>{if(onHome()||reviewing())void refreshWeeklyReview();});
 window.addEventListener('hashchange',()=>{
  clearTimeout(weeklyTimer);
  if(!reviewing())selectedJob=null;
  if(onHome()||reviewing())void refreshWeeklyReview();
 });
 void refreshWeeklyReview();
}
