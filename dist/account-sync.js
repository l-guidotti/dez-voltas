import {sessionFetch} from './session-client.js';
import {validateAccountDocument} from './sync-contract.js';
import {documentRows,rowsDocument,rowChanges,overlayRows,rowKey,same} from './relational-contract.js';
let adapter,owner=null,epoch=0,cursor=0,base=new Map(),conflicts=new Set(),legacy=null,busy=false,timer,message='Entre na conta para sincronizar.',applying=false;
const key=id=>'dez-voltas-cloud-v2:'+id;
const clone=x=>JSON.parse(JSON.stringify(x));
export function configureAccountSync(value){adapter=value;}
export function syncMessage(){return message;}
export function hasSyncConflict(){return conflicts.size>0;}
function report(text){message=text;window.dispatchEvent(new Event('sync-status'));}
function cache(){if(owner)localStorage.setItem(key(owner),JSON.stringify({cursor,rows:[...base.values()],conflicts:[...conflicts],legacy,document:adapter.capture(owner)}));}
async function request(body){const r=await sessionFetch('/api/account/sync'+(body?'':'?since='+cursor),{method:body?'POST':'GET',credentials:'same-origin',headers:{'x-account-id':owner,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok){const e=new Error(data.error||'Falha de sincronização.');e.status=r.status;throw e;}return data;}
function apply(document){applying=true;try{adapter.apply(validateAccountDocument(document,owner),owner);}finally{applying=false;}}
function receive(remote){
 const local=clone(adapter.capture(owner));let pending=rowChanges(base,local,owner);const next=overlayRows(base,remote.rows);
 if(legacy){
  pending=legacy.dirty?rowChanges(next,local,owner):[];
  if(legacy.dirty&&(legacy.revision!==remote.legacy_revision||remote.cursor>1))for(const row of pending)if(next.get(rowKey(row))?.data)conflicts.add(rowKey(row));
  legacy=null;
 }else for(const row of pending){const k=rowKey(row),latest=next.get(k);if(same(latest?.data??null,row.data)){conflicts.delete(k);continue;}if((latest?.revision||0)!==row.revision)conflicts.add(k);}
 const merged=overlayRows(next,pending);const doc=rowsDocument(merged,owner);
 base=next;cursor=remote.cursor;apply(doc);cache();
}
export async function connectAccount(id){
 const turn=++epoch;clearTimeout(timer);owner=id;cursor=0;base=new Map();conflicts=new Set();legacy=null;busy=false;
 if(!adapter)return;
 if(!id){try{localStorage.removeItem('dez-voltas-last-account');}catch{}applying=true;try{adapter.disconnect();}catch{}finally{applying=false;}report('Entre na conta para sincronizar.');return;}
 try{
  localStorage.setItem('dez-voltas-last-account',id);
  const saved=JSON.parse(localStorage.getItem(key(id))||'null'),old=saved?null:JSON.parse(localStorage.getItem('dez-voltas-cloud-v1:'+id)||'null');
  applying=true;try{adapter.select(id,saved?.document||old?.document||null);}finally{applying=false;}
  if(saved){cursor=saved.cursor;base=new Map(saved.rows.map(row=>[rowKey(row),row]));conflicts=new Set(saved.conflicts||[]);legacy=saved.legacy||null;}
  else{const d=adapter.capture(id);legacy={revision:old?.revision??null,dirty:old?old.dirty===true:!!(d.profile||d.draft||d.archive.plans.length||Object.keys(d.state.logs).length||Object.values(d.state.checklist).some(Boolean))};}
  cache();
 }catch{owner=null;report('Não foi possível preparar a cópia local. Exporte um backup antes de continuar.');return;}
 await synchronize(turn);
}
export function accountChanged(){if(!owner||!adapter||applying)return;try{const saved=JSON.parse(localStorage.getItem(key(owner))||'null');if(saved&&same(saved.document,adapter.capture(owner)))return;if(legacy)legacy.dirty=true;cache();report('Alterações salvas neste aparelho. Aguardando sincronização…');clearTimeout(timer);timer=setTimeout(()=>synchronize(epoch),1000);}catch{report('Sem espaço para a cópia local. Exporte um backup.');}}
export async function synchronize(turn=epoch){
 if(!owner||!adapter||busy||turn!==epoch)return;busy=true;
 try{
  report('Sincronizando…');const remote=await request();if(turn!==epoch)return;receive(remote);
  if(conflicts.size){report(`${conflicts.size} registro(s) com alterações nos dois aparelhos. Escolha quais valores manter no Perfil.`);return;}
  const changes=rowChanges(base,adapter.capture(owner),owner);
  if(changes.length){
   const saved=await request({cursor,changes});if(turn!==epoch)return;
   // Establish the acknowledged baseline before merging edits made during the request.
   base=overlayRows(base,changes.map(row=>({...row,revision:row.revision+1})));receive(saved);
  }
  report(conflicts.size?'Há registros em conflito. Resolva no Perfil.':rowChanges(base,adapter.capture(owner),owner).length?'Alterações locais aguardando envio…':'Sincronizado com sua conta.');
 }catch(e){if(turn!==epoch)return;report(e.status===401?'Sua sessão expirou. Entre novamente; os dados locais estão preservados.':e.status===409?'Um registro foi alterado durante o envio. Sincronize novamente para comparar.':'Não foi possível sincronizar. Sua cópia local está preservada; tente novamente online.');}
 finally{if(turn===epoch){busy=false;clearTimeout(timer);}}
}
export async function resolveSync(useLocal){
 if(!owner||busy)return;const turn=epoch;busy=true;
 try{
  const remote=await request();if(turn!==epoch)return;receive(remote);
  localStorage.setItem(key(owner)+':recovery',JSON.stringify(adapter.capture(owner)));
  if(!useLocal){const working=overlayRows(base,rowChanges(base,adapter.capture(owner),owner));for(const k of conflicts){if(base.has(k))working.set(k,base.get(k));else working.delete(k);}apply(rowsDocument(working,owner));}
  conflicts.clear();cache();
 }catch{report('Não foi possível resolver agora. As cópias foram preservadas.');return;}
 finally{if(turn===epoch)busy=false;}
 if(turn===epoch)await synchronize(turn);
}
window.addEventListener('account-data-change',accountChanged);
window.addEventListener('online',()=>synchronize());
window.addEventListener('focus',()=>synchronize());
setInterval(()=>synchronize(),60000);
export function resumeAccountSync(){try{const id=localStorage.getItem('dez-voltas-last-account');if(id&&(localStorage.getItem(key(id))||localStorage.getItem('dez-voltas-cloud-v1:'+id)))void connectAccount(id);}catch{report('Armazenamento local indisponível.');}}
