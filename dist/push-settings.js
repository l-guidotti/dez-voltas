import {sessionFetch} from './session-client.js';
import {activeSyncOwner} from './account-sync.js';
import {validatePushSettings} from './push-contract.js';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BINDING='dez-voltas-push-device-v1';
let owner=null,config=null,device=null,busy=false,reading=false,message='',browserSubscribed=false,initialized=false,dirty=false,operation=0;
const changed=(force=false)=>{const event=new Event('push-settings-change');event.force=force===true;window.dispatchEvent(event);};
const binding=()=>{try{return JSON.parse(localStorage.getItem(BINDING)||'null');}catch{return null;}};
const timeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Sao_Paulo';
const ios=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
const installed=()=>navigator.standalone===true||window.matchMedia?.('(display-mode: standalone)').matches;
const supported=()=>typeof Notification!=='undefined'&&'serviceWorker' in navigator&&typeof PushManager!=='undefined';
const permission=()=>typeof Notification!=='undefined'?Notification.permission:'unsupported';
const zoneName=zone=>new Intl.DateTimeFormat('pt-BR',{timeZone:zone,timeZoneName:'long'}).formatToParts(new Date()).find(p=>p.type==='timeZoneName')?.value||zone;
function defaults(){return {training:true,diary:true,trainingTime:'07:00',diaryTime:'20:00',timeZone:timeZone()};}
async function api(id,body,test=false){
 const r=await sessionFetch('/api/push/'+(test?'test':'settings')+(body?'':binding()?.owner===id?'?deviceId='+encodeURIComponent(binding().deviceId):''),{method:body?'POST':'GET',credentials:'same-origin',headers:{'x-account-id':id,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 const data=await r.json();if(!r.ok)throw Error(data.error||'Não foi possível atualizar os lembretes.');return data;
}
async function unsubscribeBrowser(){if(!('serviceWorker' in navigator))return;const registration=await navigator.serviceWorker.getRegistration();const subscription=await registration?.pushManager?.getSubscription();if(subscription)await subscription.unsubscribe();}
export async function disconnectPushForLogout(){operation++;const old=binding();try{await unsubscribeBrowser();}catch{}if(old?.owner===activeSyncOwner())try{await api(old.owner,{deviceId:old.deviceId,disable:true});}catch{}try{localStorage.removeItem(BINDING);}catch{}device=null;browserSubscribed=false;dirty=false;}
export function pushSettingsEditing(){return dirty||!!document.activeElement?.closest?.('#push-preferences');}
export function renderPushSettings(expectedOwner){
 if(!expectedOwner)return '';const same=expectedOwner===owner,p=same&&device?.settings||defaults(),active=same&&device?.enabled&&browserSubscribed&&permission()==='granted';
 const requiresInstall=ios()&&!installed(),canUse=supported()&&!requiresInstall;
 return `<section id="push-settings-region" class="panel push-settings" data-owner="${esc(expectedOwner)}"><h2>Lembretes no celular</h2><p>Receba avisos de treino pendente e de check-in diário, mesmo com o PWA fechado. A ativação é opcional e vale para este aparelho.</p>${requiresInstall?'<div class="notice">No iPhone/iPad, use iOS 16.4 ou mais recente. No Safari, toque em Compartilhar → Adicionar à Tela de Início. Abra o app pelo ícone instalado e volte aqui para ativar.</div>':!canUse?'<div class="notice">Este navegador não oferece Web Push. Use um navegador compatível ou o PWA instalado.</div>':''}${permission()==='denied'?'<div class="notice">As notificações estão bloqueadas. Altere a permissão do site/app nas configurações do aparelho e volte para ativar.</div>':''}<p class="push-current">${active?'Lembretes ativados neste aparelho.':same&&config?.ready===false?'Preparando o serviço de notificações…':'Lembretes não ativados neste aparelho.'}</p><form id="push-preferences" data-owner="${esc(expectedOwner)}"><label class="profile-consent"><input name="training" type="checkbox" ${p.training?'checked':''}> Avisar sobre treino pendente em dia programado.</label><label class="field">Horário do lembrete de treino<input name="trainingTime" type="time" value="${esc(p.trainingTime)}" required></label><label class="profile-consent"><input name="diary" type="checkbox" ${p.diary?'checked':''}> Lembrar do check-in diário, inclusive em descanso.</label><label class="field">Horário do check-in diário<input name="diaryTime" type="time" value="${esc(p.diaryTime)}" required></label><p class="field-help">Horários no fuso deste aparelho: ${esc(zoneName(timeZone()))}. ${device?.settings?.timeZone&&device.settings.timeZone!==timeZone()?'O fuso mudou; salve para atualizar os horários. ':''}Os avisos são aproximados e dependem da conexão e das configurações do sistema. Não repetimos o aviso quando o respectivo registro já está concluído.</p><p class="field-help">Ao ativar, você autoriza guardar a assinatura de notificações deste navegador e estas preferências. As mensagens são genéricas: não exibem dados de saúde ou detalhes do plano na tela bloqueada.</p><div class="profile-buttons"><button type="submit" class="primary" ${busy||!canUse||permission()==='denied'||!same||!config?.ready||!config?.enabled?'disabled':''}>${busy?'Aguarde…':active?'Salvar horários e preferências':'Ativar lembretes neste aparelho'}</button>${active?'<button type="button" class="secondary" data-push="test">Enviar um lembrete de teste</button>':''}${same&&binding()?.owner===expectedOwner?'<button type="button" class="secondary" data-push="disable">Desativar neste aparelho</button>':''}</div></form><p id="push-feedback" class="notice" role="status" aria-live="polite">${same?esc(message):'Conferindo notificações…'}</p></section>`;
}
function read(form){const f=new FormData(form);return validatePushSettings({training:f.get('training')==='on',diary:f.get('diary')==='on',trainingTime:f.get('trainingTime'),diaryTime:f.get('diaryTime'),timeZone:timeZone()});}
export function refreshPushUI(force=false){const node=document.querySelector('#push-settings-region');if(!node)return;if(!force&&node.dataset.owner===owner&&pushSettingsEditing()){const feedback=document.querySelector('#push-feedback');if(feedback)feedback.textContent=message;return;}node.outerHTML=renderPushSettings(node.dataset.owner);}
export async function refreshPushSettings(){
 const id=activeSyncOwner();if(id!==owner){operation++;const old=binding();owner=id;config=null;device=null;dirty=false;message='';if(old&&id&&old.owner!==id){try{await unsubscribeBrowser();}catch{}localStorage.removeItem(BINDING);}}
 if(!id||reading)return;reading=true;
 try{const data=await api(id);if(activeSyncOwner()!==id)return;config=data.config;device=data.device;
  const registration='serviceWorker' in navigator?await navigator.serviceWorker.getRegistration():null;browserSubscribed=!!(await registration?.pushManager?.getSubscription());
  if(device?.enabled&&permission()==='denied'){await disconnectPushForLogout();message='Lembretes desativados porque a permissão foi bloqueada no aparelho.';}
 }catch(e){if(activeSyncOwner()===id)message='Sem acesso às preferências de lembretes. Tente novamente online.';}finally{reading=false;changed();}
}
async function activate(settings){
 const id=activeSyncOwner(),ticket=operation;if(!id||id!==owner)throw Error('Entre na conta antes de ativar lembretes.');if(!settings.training&&!settings.diary)throw Error('Selecione ao menos um aviso, ou use Desativar neste aparelho.');
 // The permission request is the first await, directly inside the user's click/submit gesture (Safari requirement).
 const granted=permission()==='granted'?'granted':await Notification.requestPermission();if(ticket!==operation||activeSyncOwner()!==id)throw Error('A conta mudou. Ative novamente na conta atual.');if(granted!=='granted')throw Error('Permissão não concedida. Você pode ativar as notificações quando quiser.');
 const registration=await navigator.serviceWorker.ready;if(activeSyncOwner()!==id||ticket!==operation)throw Error('A conta mudou. Ative novamente na conta atual.');
 const raw=config.publicKey.replace(/-/g,'+').replace(/_/g,'/'),key=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
 let subscription=await registration.pushManager.getSubscription();if(subscription&&[404,410].includes(device?.lastStatus)){await subscription.unsubscribe();subscription=null;}subscription||=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
 if(activeSyncOwner()!==id||ticket!==operation){await subscription.unsubscribe();throw Error('A conta mudou. Ative novamente na conta atual.');}
 const old=binding(),deviceId=old?.owner===id?old.deviceId:crypto.randomUUID();localStorage.setItem(BINDING,JSON.stringify({owner:id,deviceId}));
 const saved=await api(id,{deviceId,settings,subscription:subscription.toJSON()});if(activeSyncOwner()!==id||ticket!==operation){await unsubscribeBrowser();throw Error('A conta mudou. Ative novamente na conta atual.');}
 device=saved.device;browserSubscribed=true;message='Lembretes ativados. Os horários valem para este aparelho. Você pode enviar um teste agora.';
}
document.addEventListener('input',e=>{if(e.target.closest('#push-preferences'))dirty=true;});
document.addEventListener('submit',async e=>{if(e.target.id!=='push-preferences')return;e.preventDefault();if(busy)return;let settings;try{settings=read(e.target);}catch(error){message=error.message;changed();return;}
 busy=true;try{await activate(settings);dirty=false;}catch(error){message=error.message;}finally{busy=false;changed(!dirty);}});
document.addEventListener('click',async e=>{const action=e.target.closest('[data-push]')?.dataset.push;if(!action||busy)return;const id=activeSyncOwner();busy=true;
 try{if(action==='disable'){await disconnectPushForLogout();message='Lembretes desativados neste aparelho.';dirty=false;}if(action==='test'){const b=binding();if(b?.owner!==id)throw Error('Ative os lembretes nesta conta primeiro.');const data=await api(id,{deviceId:b.deviceId},true);message=data.queued?'Teste na fila. Confira a notificação neste aparelho; o recebimento depende do serviço de push e do sistema.':'Já existe um teste aguardando processamento.';}}
 catch(error){message=error.message;}finally{busy=false;changed(!dirty);}
});
export function initPushSettings(){if(initialized)return;initialized=true;for(const event of ['active-plan-change','session-account-change','session-restored','online','focus'])window.addEventListener(event,()=>{void refreshPushSettings();});for(const event of ['session-ended','session-expired'])window.addEventListener(event,()=>{void disconnectPushForLogout().then(()=>refreshPushSettings());});void refreshPushSettings();}
