import {sessionFetch} from './session-client.js';
import {getActivePlan} from './active-plan.js';
import {activeSyncOwner,synchronize,hasSyncConflict,accountSyncReady} from './account-sync.js';
import {validateWeeklyCheckin} from './weekly-contract.js';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=null,owner=null,planId=null,message='',busy=false,reading=false,draft=null,serial=0;
const changed=()=>window.dispatchEvent(new Event('weekly-review-change'));
function identity(){const p=getActivePlan();return p&&p.owner===activeSyncOwner()?p:null;}
async function request(body,expectedOwner){
 const r=await sessionFetch('/api/training/weekly-review',{method:body?'POST':'GET',credentials:'same-origin',headers:{'x-account-id':expectedOwner,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
 const data=await r.json();if(!r.ok)throw Error(data.error||'Não foi possível consultar o fechamento semanal.');return data;
}
export async function refreshWeeklyReview(manual=false){
 const p=identity();if(!p){serial++;state=null;owner=null;planId=null;draft=null;changed();return;}
 if(reading)return;reading=true;const ticket=++serial;
 try{const data=await request(null,p.owner);if(ticket!==serial||identity()?.id!==p.id||identity()?.owner!==p.owner)return;
  if(data.planId!==p.id){message='Sincronize o plano em uso antes de fechar a semana.';state=null;owner=p.owner;planId=p.id;changed();return;}
  const reset=owner!==p.owner||planId!==p.id||state?.weekStart!==data.weekStart||state?.checkin?.revision!==data.checkin?.revision;
  owner=p.owner;planId=p.id;state=data;if(reset)draft=data.checkin?.report||null;
  if(manual)message='Fechamento atualizado com os dados da conta.';changed();
 }catch(e){if(ticket===serial&&identity()?.id===p.id){owner=p.owner;planId=p.id;message=e.name==='TimeoutError'?'A consulta demorou. Tente atualizar novamente.':'Sem acesso ao fechamento. '+e.message;changed();}}
 finally{reading=false;if(ticket!==serial&&identity())void refreshWeeklyReview();}
}
export function renderWeeklyReview(){
 const p=identity();if(!p)return '';
 if(owner!==p.owner||planId!==p.id||!state)return `<section class="panel" id="weekly-review"><h2>Evolução da sua preparação</h2><p>Feche cada semana para revisar os próximos treinos com o que você realizou e como se recuperou.</p><button type="button" class="secondary" data-weekly="refresh">Consultar fechamento semanal</button><p role="status">${owner===p.owner?esc(message):''}</p></section>`;
 const saved=state.checkin,report=draft||saved?.report||{fatigue:'',sleep:'',readiness:'',pain:'',illness:false,complete:false,consent:false,days:p.profile.days,maxMinutes:p.profile.maxMinutes,longMinutes:p.profile.longMinutes,notes:''};
 const locked=!!saved?.job_id,disabled=busy||locked||!state.canSave;
 const scale=(name,label,low,high)=>`<label class="field">${label}<select name="${name}" required ${disabled?'disabled':''}><option value="">Selecione</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${report[name]===n?'selected':''}>${n}${n===1?' · '+low:n===5?' · '+high:''}</option>`).join('')}</select></label>`;
 return `<section class="panel" id="weekly-review"><span class="eyebrow muted">EVOLUÇÃO DO TREINO</span><h2>Como foi sua semana?</h2><p><strong>${esc(state.weekStart)} a ${esc(state.weekEnd)}</strong> · semanas de 7 dias contadas a partir do início do bloco.</p><div class="notice">No diário sincronizado: ${esc(state.stats.registered)} registro(s), ${esc(state.stats.km)} km e ${esc(state.stats.minutes)} min. ${esc(state.planned)} sessão(ões) planejada(s) para esta semana. Registros ausentes não comprovam recuperação nem treino concluído.</div>${!state.canSave?'<p class="field-help">O fechamento fica disponível no último dia da semana, enquanto houver preparação pela frente. A revisão é enfileirada depois que a semana terminar.</p>':''}${locked?'<p class="notice">Fechamento enviado. Acompanhe o processamento e a sugestão na sua conta. Este retrato da semana fica preservado.</p><a class="primary" href="#perfil">Acompanhar revisão e ver sugestão</a>':''}${saved?.queue_error?`<p class="notice">${esc(saved.queue_error)}</p>`:''}<form id="weekly-checkin" data-plan="${esc(planId)}" data-week="${esc(state.weekStart)}"><div class="profile-grid">${scale('fatigue','Fadiga ao final da semana','muito baixa','muito alta')}${scale('sleep','Qualidade do sono na semana','muito ruim','muito boa')}${scale('readiness','Disposição para treinar','muito baixa','muito alta')}<label class="field">Dor ou incômodo na semana<select name="pain" required ${disabled?'disabled':''}><option value="">Selecione</option>${[['none','Sem dor'],['mild','Incômodo leve'],['stop','Dor que pediu parar']].map(([v,t])=>`<option value="${v}" ${report.pain===v?'selected':''}>${t}</option>`).join('')}</select></label></div><label class="profile-consent"><input type="checkbox" name="illness" ${report.illness?'checked':''} ${disabled?'disabled':''}> Tive doença ou sintomas que afetaram os treinos.</label><label class="profile-consent"><input type="checkbox" name="complete" ${report.complete?'checked':''} ${disabled?'disabled':''}> Registrei todos os treinos realizados nesta semana. Os treinos sem registro não foram realizados.</label><fieldset class="profile-days"><legend>Dias disponíveis na próxima semana (até 6)</legend>${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map((day,i)=>`<label><input type="checkbox" name="days" value="${i}" ${report.days.includes(i)?'checked':''} ${disabled?'disabled':''}> ${day}</label>`).join('')}</fieldset><div class="profile-grid"><label class="field">Tempo por treino comum (min)<input name="maxMinutes" type="number" min="20" max="360" value="${esc(report.maxMinutes)}" required ${disabled?'disabled':''}></label><label class="field">Tempo para o longo (min)<input name="longMinutes" type="number" min="20" max="600" value="${esc(report.longMinutes)}" required ${disabled?'disabled':''}></label></div><label class="field">O que afetou os treinos ou muda na próxima semana?<textarea name="notes" maxlength="1000" ${disabled?'disabled':''} placeholder="Rotina, recuperação, viagem ou motivo de treinos não realizados…">${esc(report.notes)}</textarea></label><label class="profile-consent"><input type="checkbox" name="consent" ${report.consent?'checked':''} ${disabled?'disabled':''}> Autorizo enviar ao Google Gemini este fechamento e os registros de treino dos últimos 28 dias, incluindo esforço, dores e observações da semana, para revisar os próximos treinos. O envio ocorrerá automaticamente após encerrar esta semana. Meu e-mail não será enviado.</label><p class="field-help">Sem autorização, somente o fechamento é salvo. Cumprir os treinos não obriga aumento: dados insuficientes, fadiga, sono ruim ou dor impedem progressão. Dor e doença pedem avaliação antes de gerar cargas. A revisão usa a mesma fila e os mesmos limites diários da geração de planos.</p><div class="profile-buttons"><button type="submit" class="primary" ${disabled?'disabled':''}>${busy?'Salvando…':'Salvar fechamento semanal'}</button><button type="button" class="secondary" data-weekly="refresh" ${busy?'disabled':''}>Atualizar dados</button></div><p id="weekly-feedback" class="notice" role="status" aria-live="polite">${esc(message)}</p></form>${state.history?.length?`<details><summary>Seus fechamentos anteriores</summary>${state.history.map(x=>`<p>${esc(x.week_start)} a ${esc(x.week_end)} · ${x.job_id?'Revisão enviada':x.queue_error?esc(x.queue_error):'Fechamento salvo'}</p>`).join('')}</details>`:''}</section>`;
}
function read(form){const f=new FormData(form);return {fatigue:Number(f.get('fatigue')),sleep:Number(f.get('sleep')),readiness:Number(f.get('readiness')),pain:f.get('pain'),illness:f.get('illness')==='on',complete:f.get('complete')==='on',consent:f.get('consent')==='on',days:f.getAll('days').map(Number),maxMinutes:Number(f.get('maxMinutes')),longMinutes:Number(f.get('longMinutes')),notes:String(f.get('notes')||'')};}
document.addEventListener('input',e=>{const form=e.target.closest('#weekly-checkin');if(form)draft=read(form);});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='weekly-checkin')return;e.preventDefault();if(busy)return;const p=identity();if(!p||p.owner!==owner||p.id!==planId||!state?.canSave||state.checkin?.job_id)return;
 let report;try{report=validateWeeklyCheckin(read(e.target));}catch(error){message=error.message;changed();return;}
 draft=report;const week=state.weekStart,revision=state.checkin?.revision||0;busy=true;message='Sincronizando os registros antes de salvar o fechamento…';changed();
 try{
  await synchronize();if(hasSyncConflict())throw Error('Resolva os registros em conflito antes de enviar a semana.');if(!accountSyncReady(p.owner))throw Error('Aguarde a sincronização terminar ou reconecte antes de enviar a semana. Os dados deste aparelho precisam estar na conta.');
  if(identity()?.id!==p.id||identity()?.owner!==p.owner)throw Error('A conta ou o plano mudou. Atualize o fechamento.');
  // synchronize() must confirm there are no pending/offline changes before a snapshot is scheduled.
  const data=await request({planId:p.id,weekStart:week,report,revision},p.owner);
  if(identity()?.id!==p.id||identity()?.owner!==p.owner)return;
  state={...state,checkin:data.checkin};message=report.consent?'Fechamento salvo. Depois que a semana encerrar, a revisão entra na fila automaticamente. Veja o andamento em Minha conta.':'Fechamento salvo sem envio ao Gemini.';
 }catch(error){if(identity()?.owner===p.owner)message=error.message;}finally{busy=false;changed();}
});
document.addEventListener('click',e=>{if(e.target.closest('[data-weekly="refresh"]'))void refreshWeeklyReview(true);});
export function initWeeklyReview(){
 for(const event of ['active-plan-change','session-ended','session-expired','session-account-change'])window.addEventListener(event,()=>{if(identity()?.id!==planId||identity()?.owner!==owner){serial++;state=null;draft=null;message='';}void refreshWeeklyReview();});
 window.addEventListener('online',()=>{void refreshWeeklyReview();});
 window.addEventListener('hashchange',()=>{if(location.hash==='#plano')void refreshWeeklyReview();});
 void refreshWeeklyReview();
}
