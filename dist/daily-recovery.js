import {sessionFetch} from './session-client.js';
import {activeSyncOwner} from './account-sync.js';
import {localToday,addDate} from './training-contract.js';
import {validateRecovery,recoveryActivities} from './recovery-contract.js';
import {createRecoverySync} from './recovery-sync.js';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let historyOpen=new Set();
let owner=null,day=localToday(),editing=false,openRequested=false,feedback='',timer,initialized=false;
const changed=(force=false)=>{const event=new Event('daily-recovery-change');event.forceDaily=force===true;window.dispatchEvent(event);};
async function request(id,body){
 let response;try{response=await sessionFetch('/api/recovery/daily',{method:body?'POST':'GET',credentials:'same-origin',headers:{'x-account-id':id,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});}catch{throw Error('Sem conexão. O check-in salvo continua neste aparelho e será enviado quando houver acesso.');}
 const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'Não foi possível sincronizar o check-in.'),{status:response.status,record:data.record});return data;
}
const store=createRecoverySync({request,read:k=>localStorage.getItem(k),write:(k,v)=>localStorage.setItem(k,v),uuid:()=>crypto.randomUUID(),changed});
function identity(){
 const id=activeSyncOwner();
 if(id===owner)return id;
 owner=id;
 historyOpen=new Set();
 day=localToday();
 editing=false;
 openRequested=false;
 feedback='';
 const dialog=document.querySelector('#daily-recovery-dialog');
 if(dialog?.open)dialog.close();
 dialog?.replaceChildren();
 store.select(id);
 return id;
}
export function dailyRecoveryEditing(){return !!owner&&owner===activeSyncOwner()&&(editing||document.activeElement?.closest?.('#daily-checkin')?.dataset.owner===owner);}
export function dailyRecoveryReady(){return store.owner()===activeSyncOwner()&&store.ready();}
export async function synchronizeRecovery(){identity();await store.sync();}
export function currentRecoveryAlert(id){if(!id)return false;try{const saved=JSON.parse(localStorage.getItem('dez-voltas-recovery-v1:'+id)||'null');const rows={...(saved?.records||{})};for(const [date,p]of Object.entries(saved?.pending||{}))rows[date]={report:p.nextReport||p.report};const date=Object.keys(rows).filter(x=>x>=addDate(localToday(),-6)&&x<=localToday()).sort().at(-1);return !!date&&(rows[date].report.pain!=='none'||rows[date].report.illness===true);}catch{return false;}}
const empty=()=>({fatigue:'',sleep:'',readiness:'',pain:'',illness:false,painLocation:'',notes:'',activity:{type:'none',minutes:'',rpe:''}});
function historyMarkup(entries){
 const painLabels={none:'Nenhuma',mild:'Incômodo leve',stop:'Interferiu nas atividades / fez parar'};
 return `<div class="daily-history"><p class="field-help">Abra uma data para consultar o registro completo. Exibimos os últimos 28 dias disponíveis nesta conta; registros mais antigos deste aparelho também podem aparecer.</p>${entries.length?entries.map(x=>{const r=x.report,activity=r.activity;return `<details class="daily-history-entry" data-record-day="${esc(x.day)}" ${historyOpen.has(x.day)?'open':''}><summary>${esc(x.day.split('-').reverse().join('/'))}${x.pending?' · aguardando sincronização':''}${x.conflict?' · conflito':''}</summary><dl><dt>Disposição</dt><dd>${esc(r.readiness)}/5</dd><dt>Fadiga</dt><dd>${esc(r.fatigue)}/5</dd><dt>Qualidade do sono</dt><dd>${esc(r.sleep)}/5</dd><dt>Dor ou incômodo</dt><dd>${esc(painLabels[r.pain]||r.pain)}</dd>${r.painLocation?`<dt>Local do incômodo</dt><dd>${esc(r.painLocation)}</dd>`:''}<dt>Doença ou sintomas</dt><dd>${r.illness?'Sim':'Não'}</dd><dt>Outra atividade</dt><dd>${esc(recoveryActivities[activity.type])}${activity.type!=='none'?` · ${esc(activity.minutes)} min · RPE ${esc(activity.rpe)}/10`:''}</dd><dt>Como foi o dia</dt><dd class="daily-history-notes">${esc(r.notes||'Sem observação.')}</dd></dl>${x.day>=addDate(localToday(),-27)&&x.day<=localToday()?`<button type="button" class="secondary" data-recovery="day" data-day="${esc(x.day)}">Editar este dia</button>`:''}</details>`;}).join(''):'<p>Nenhum check-in salvo disponível neste aparelho. Use “Sincronizar check-ins” para consultar sua conta.</p>'}</div>`;
}
export function renderRecoveryHistory(){
 const id=identity();
 if(!id)return '<section id="daily-recovery-history" class="panel" aria-labelledby="diary-check-ins"><h2 id="diary-check-ins">Registros de check-in manual</h2><p>Entre na conta para consultar seus check-ins salvos.</p></section>';
 const existing=document.querySelector('#daily-recovery-history');
 if(existing?.dataset.owner===id){
  historyOpen=new Set([...existing.querySelectorAll('.daily-history-entry[open]')].map(item=>item.dataset.recordDay));
 }
 const entries=store.entries();
 return `<section id="daily-recovery-history" class="panel daily-recovery" data-owner="${esc(id)}" aria-labelledby="diary-check-ins"><div class="panel-top"><h2 id="diary-check-ins">Registros de check-in manual (${entries.length})</h2><button type="button" class="secondary" data-recovery="sync">Sincronizar check-ins</button></div>${historyMarkup(entries)}<p id="daily-history-feedback" class="notice" role="status">${esc(feedback||store.message())}</p></section>`;
}
export function renderDailyRecovery(){
 const id=identity();
 if(!id)return '';
 return `<section id="daily-recovery-region" class="panel home-check-in" data-owner="${esc(id)}">
  <div><h2>Como você está hoje?</h2><p>Registre como se sentiu e como está se recuperando.</p></div>
  <button type="button" class="secondary" data-recovery="open" aria-haspopup="dialog" aria-controls="daily-recovery-dialog">Abrir check-in</button>
 </section>`;
}
function renderRecoveryForm(logs){
 const id=identity();
 const saved=store.entries().find(x=>x.day===day),p=store.draft(day)||saved?.report||empty(),conflict=store.conflict(day);
 const scale=(name,label,low,high)=>`<label class="field">${label}<select name="${name}" required><option value="">Selecione</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${Number(p[name])===n?'selected':''}>${n}${n===1?' · '+low:n===5?' · '+high:''}</option>`).join('')}</select></label>`;
 const runs=Object.values(logs).filter(x=>x.date===day);
 return `<div class="modal-inner">
  <div class="modal-top"><h2 id="daily-recovery-title">Check-in diário</h2><button type="button" class="icon-button" data-recovery="close" aria-label="Fechar check-in">×</button></div>
  <p class="modal-intro">Registre como se sentiu ao longo do dia, inclusive nos dias de descanso.</p>
  ${saved?`<p class="field-help">Dia registrado · disposição ${esc(saved.report.readiness)}/5 · fadiga ${esc(saved.report.fatigue)}/5 · sono ${esc(saved.report.sleep)}/5.</p>`:''}<form id="daily-checkin" data-owner="${esc(id)}"><label class="field daily-date">Dia do registro<input type="date" name="day" value="${day}" min="${addDate(localToday(),-27)}" max="${localToday()}" required></label><p class="field-help" id="daily-runs">${runs.length?`${runs.length} corrida(s) já registrada(s) neste dia: ${esc(Math.round(runs.reduce((n,x)=>n+x.km,0)*10)/10)} km · ${esc(Math.round(runs.reduce((n,x)=>n+x.minutes,0)*10)/10)} min. Não repita essas corridas na outra atividade.`:'Nenhuma corrida registrada neste dia. Você pode preencher mesmo em descanso.'}</p><div class="profile-grid">${scale('readiness','Disposição','muito baixa','muito alta')}${scale('fatigue','Fadiga','muito baixa','muito alta')}${scale('sleep','Qualidade do sono','muito ruim','muito boa')}<label class="field">Dor ou incômodo<select name="pain" required><option value="">Selecione</option>${[['none','Nenhum'],['mild','Incômodo leve'],['stop','Interferiu nas atividades / fez parar']].map(([v,t])=>`<option value="${v}" ${p.pain===v?'selected':''}>${t}</option>`).join('')}</select></label></div><label class="field">Local da dor ou incômodo (opcional)<input name="painLocation" type="text" maxlength="100" value="${esc(p.painLocation)}"></label><label class="profile-consent"><input type="checkbox" name="illness" ${p.illness?'checked':''}> Tive doença ou sintomas que afetaram minha recuperação.</label><details class="daily-activity" ${p.activity.type!=='none'?'open':''}><summary>Atividade além das corridas registradas (opcional)</summary><p class="field-help">Informe a atividade principal do dia fora das corridas do diário. Outras atividades podem ser descritas na observação. Não somamos esses minutos aos quilômetros de corrida.</p><label class="field">Outra atividade<select name="activityType">${Object.entries(recoveryActivities).map(([v,t])=>`<option value="${v}" ${p.activity.type===v?'selected':''}>${t}</option>`).join('')}</select></label><div class="profile-grid daily-activity-fields" ${p.activity.type==='none'?'hidden':''}><label class="field">Duração (min)<input type="number" name="activityMinutes" min="1" max="600" step="1" value="${esc(p.activity.minutes)}" ${p.activity.type!=='none'?'required':'disabled'}></label><label class="field">Esforço da outra atividade (RPE)<select name="activityRpe" ${p.activity.type!=='none'?'required':'disabled'}><option value="">Selecione</option>${Array.from({length:10},(_,i)=>`<option value="${i+1}" ${Number(p.activity.rpe)===i+1?'selected':''}>${i+1} / 10</option>`).join('')}</select></label></div></details><label class="field">Como foi seu dia? (opcional)<textarea name="notes" maxlength="500" placeholder="Pernas pesadas, trabalho em pé, descanso, recuperação…">${esc(p.notes)}</textarea></label><p class="notice daily-pain" ${(p.pain&&p.pain!=='none'||p.illness)?'':'hidden'}>Seu registro será salvo. Dor ou doença pedem avaliação antes de gerar novas cargas; não oferecemos um plano de reabilitação por IA.</p><p class="field-help">Salvar este check-in não envia dados ao Gemini. Você poderá autorizar o uso dos registros diários no fechamento semanal. Um dia sem registro não comprova boa recuperação.</p><div class="profile-buttons"><button type="submit" class="primary">${saved?'Salvar alterações do dia':'Salvar check-in do dia'}</button><button type="button" class="secondary" data-recovery="sync">Sincronizar check-ins</button></div></form><div class="daily-conflict" ${conflict?'':'hidden'}><p class="notice">Este dia foi alterado nos dois aparelhos. O preenchimento local foi preservado.</p><button type="button" class="secondary" data-recovery="cloud">Usar registro da conta</button><button type="button" class="secondary" data-recovery="local">Manter meu registro</button></div><p id="daily-feedback" class="notice" role="status" aria-live="polite">${esc(feedback||store.message())}</p></div>`;
}
function read(form){const f=new FormData(form),type=f.get('activityType')||'none';return {readiness:Number(f.get('readiness')),fatigue:Number(f.get('fatigue')),sleep:Number(f.get('sleep')),pain:f.get('pain'),illness:f.get('illness')==='on',painLocation:String(f.get('painLocation')||''),notes:String(f.get('notes')||''),activity:{type,minutes:type==='none'?0:Number(f.get('activityMinutes')),rpe:type==='none'?null:Number(f.get('activityRpe'))}};}
function patch(){const node=document.querySelector('#daily-feedback, #daily-history-feedback');if(node)node.textContent=feedback||store.message();const box=document.querySelector('.daily-conflict');if(box)box.hidden=!store.conflict(day);}
export function refreshRecoveryUI(logs={},force=false){
 const history=document.querySelector('#daily-recovery-history');
 if(history){
  history.outerHTML=renderRecoveryHistory();
  return;
 }
 const card=document.querySelector('#daily-recovery-region');
 const dialog=document.querySelector('#daily-recovery-dialog');
 if(!card||!dialog||(!openRequested&&!dialog.open)||card.dataset.owner!==identity())return;
 if(!force&&dailyRecoveryEditing()){
  patch();
  return;
 }
 openRequested=false;
 dialog.innerHTML=renderRecoveryForm(logs);
 if(!dialog.open)dialog.showModal();
}
document.addEventListener('input',e=>{const form=e.target.closest('#daily-checkin');if(!form||form.dataset.owner!==identity()||e.target.name==='day')return;editing=true;feedback='Preenchimento guardado neste aparelho. Clique em salvar para registrar o dia.';try{store.saveDraft(day,read(form));}catch{feedback='Sem espaço para guardar o preenchimento. Mantenha a tela aberta até salvar.';}patch();});
document.addEventListener('change',e=>{const form=e.target.closest('#daily-checkin');if(!form||form.dataset.owner!==identity())return;if(e.target.name==='day'){day=e.target.value;editing=false;feedback='';changed(true);return;}const fields=form.querySelector('.daily-activity-fields'),active=form.elements.activityType.value!=='none';fields.hidden=!active;for(const name of ['activityMinutes','activityRpe']){form.elements[name].required=active;form.elements[name].disabled=!active;}form.querySelector('.daily-pain').hidden=!(form.elements.pain.value&&form.elements.pain.value!=='none'||form.elements.illness.checked);});
document.addEventListener('submit',async e=>{if(e.target.id!=='daily-checkin')return;e.preventDefault();if(e.target.dataset.owner!==identity())return;try{store.save(day,validateRecovery(read(e.target)));editing=false;feedback='';changed(true);await store.sync();}catch(error){feedback=error.message;patch();}});
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-recovery]');
 if(!button||!identity())return;
 const action=button.dataset.recovery;
 const dialog=document.querySelector('#daily-recovery-dialog');
 try{
  if(action==='close'){
   dialog.close();
   return;
  }
  if(action==='open'||action==='day'){
   day=action==='open'?localToday():button.dataset.day;
   editing=false;
   openRequested=true;
   feedback='';
   if(location.hash==='#diario')location.hash='#hoje';
   else changed(true);
   return;
  }
  if(action==='cloud'||action==='local'){
   store.resolve(day,action==='local');
   editing=false;
   feedback='';
   changed(true);
  }
  feedback='';
  await store.sync();
  changed();
 }catch(error){
  feedback=error.message;
  patch();
 }
});
export function initDailyRecovery(){
 if(initialized)return;
 initialized=true;
 const dialog=document.querySelector('#daily-recovery-dialog');
 dialog?.addEventListener('close',()=>{
  if(dialog.open)return;
  editing=false;
  dialog.replaceChildren();
 });
 window.addEventListener('hashchange',()=>{
  if(location.hash==='#hoje'&&openRequested)changed(true);
  else if(location.hash&&location.hash!=='#hoje'&&dialog?.open)dialog.close();
 });
 const refresh=()=>{identity();if(owner)void store.sync();};
 for(const name of ['active-plan-change','account-data-loaded','session-ended','session-expired','session-account-change','online','focus'])window.addEventListener(name,refresh);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
 timer=setInterval(refresh,60000);
 refresh();
}
