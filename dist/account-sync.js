import {validateAccountDocument} from './sync-contract.js';
let adapter,owner=null,epoch=0,revision=0,dirty=false,conflict=false,busy=false,timer,message='Entre na conta para sincronizar.',applying=false,sequence=0;
const key=id=>'dez-voltas-cloud-v1:'+id;
const clone=x=>JSON.parse(JSON.stringify(x));
export function configureAccountSync(value){adapter=value;}
export function syncMessage(){return message;}
export function hasSyncConflict(){return conflict;}
function report(text){message=text;window.dispatchEvent(new Event('sync-status'));}
function cache(){if(!owner)return;localStorage.setItem(key(owner),JSON.stringify({revision,dirty,document:adapter.capture(owner)}));}
async function request(body){const r=await fetch('/api/account/data',{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'content-type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok){const e=new Error(data.error||'Falha de sincronização.');e.status=r.status;throw e;}return data.record;}
function apply(document){applying=true;try{adapter.apply(validateAccountDocument(document,owner),owner);}finally{applying=false;}}
export async function connectAccount(id){
 const turn=++epoch;clearTimeout(timer);owner=id;revision=0;dirty=false;conflict=false;busy=false;
 if(!adapter)return;
 if(!id){try{localStorage.removeItem('dez-voltas-last-account');}catch{}applying=true;try{adapter.disconnect();}catch{}finally{applying=false;}report('Entre na conta para sincronizar.');return;}
 try{
  localStorage.setItem('dez-voltas-last-account',id);
  const saved=JSON.parse(localStorage.getItem(key(id))||'null');
  applying=true;try{adapter.select(id,saved?.document||null);}finally{applying=false;}
  if(saved){revision=saved.revision;dirty=saved.dirty===true;}else {const doc=adapter.capture(id);dirty=!!(doc.profile||doc.draft||doc.archive.plans.length||Object.keys(doc.state.logs).length||Object.values(doc.state.checklist).some(Boolean));}
  sequence++;cache();
 }catch{owner=null;report('Não foi possível preparar a cópia local. Exporte um backup antes de continuar.');return;}
 await synchronize(turn);
}
export function accountChanged(){if(!owner||!adapter||applying)return;try{const saved=JSON.parse(localStorage.getItem(key(owner))||'null');if(saved&&JSON.stringify(saved.document)===JSON.stringify(adapter.capture(owner)))return;sequence++;dirty=true;cache();report('Alterações salvas neste aparelho. Aguardando sincronização…');clearTimeout(timer);timer=setTimeout(()=>synchronize(epoch),1000);}catch{report('Sem espaço para a cópia local. Exporte um backup.');}}
export async function synchronize(turn=epoch){
 if(!owner||!adapter||busy||turn!==epoch)return;
 if(conflict){report('Há alterações em outro aparelho. Escolha qual cópia manter abaixo.');return;}
 busy=true;const id=owner;
 try{
  report('Sincronizando…');const remote=await request();if(turn!==epoch)return;
  if(remote&&remote.revision!==revision){
   if(dirty){conflict=true;report('Há alterações em outro aparelho. Escolha qual cópia manter abaixo.');return;}
   apply(remote.document);revision=remote.revision;cache();
  }
  if(dirty){const captured=sequence,document=validateAccountDocument(clone(adapter.capture(id)),id);const saved=await request({revision,document});if(turn!==epoch)return;revision=saved.revision;dirty=sequence!==captured;cache();}
  report(dirty?'Alterações locais aguardando envio…':'Sincronizado com sua conta.');
 }catch(e){if(turn!==epoch)return;if(e.status===409)conflict=true;report(e.status===401?'Sua sessão expirou. Entre novamente; os dados locais estão preservados.':e.status===409?'Há alterações em outro aparelho. Escolha qual cópia manter abaixo.':'Não foi possível sincronizar. Sua cópia local está preservada; tente novamente online.');}
 finally{if(turn===epoch){busy=false;if(dirty&&!conflict)clearTimeout(timer);}}
}
export async function resolveSync(useLocal){
 if(!owner||busy)return;const turn=epoch;busy=true;
 try{
  const remote=await request();if(turn!==epoch)return;
  if(!useLocal){localStorage.setItem(key(owner)+':recovery',JSON.stringify(adapter.capture(owner)));if(remote)apply(remote.document);else throw new Error('Sem cópia remota.');dirty=false;}
  else dirty=true;
  revision=remote?.revision||0;conflict=false;sequence++;cache();
 }catch{report('Não foi possível resolver agora. As cópias foram preservadas.');return;}
 finally{if(turn===epoch)busy=false;}
 if(turn===epoch)await synchronize(turn);
}
window.addEventListener('account-data-change',accountChanged);
window.addEventListener('online',()=>synchronize());
window.addEventListener('focus',()=>synchronize());
setInterval(()=>synchronize(),60000);

export function resumeAccountSync(){try{const id=localStorage.getItem('dez-voltas-last-account');if(id&&localStorage.getItem(key(id)))void connectAccount(id);}catch{report('Armazenamento local indisponível.');}}
