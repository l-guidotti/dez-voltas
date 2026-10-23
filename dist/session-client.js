// Only session metadata reaches this module. Tokens remain in HttpOnly cookies.
let renewing=null,queue=Promise.resolve(),generation=0,paused=false,last=null,timer;
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('dez-voltas-session'):null;
const sessionError=(message,status)=>Object.assign(new Error(message),{status});
function notify(name,detail){window.dispatchEvent(new CustomEvent(name,{detail}));}
function schedule(){clearTimeout(timer);if(paused||!last?.session?.canRefresh)return;const remaining=last.session.expiresAt-Date.now()-120000;timer=setTimeout(()=>renewSession().catch(()=>{if(!paused)timer=setTimeout(()=>renewSession().catch(()=>{}),60000);}),Number.isFinite(remaining)?Math.max(30000,Math.min(remaining,3600000)):1800000);}
function observe(data){if(!data?.user)return;const previous=last?.user?.id;last=data;paused=false;schedule();if(previous&&previous!==data.user.id)notify('session-account-change',data.user);}
function lock(fn){if(typeof navigator!=='undefined'&&navigator.locks?.request)return navigator.locks.request('dez-voltas-session',fn);const task=queue.then(fn,fn);queue=task.catch(()=>{});return task;}
async function raw(path,options={}){return fetch(path,{credentials:'same-origin',signal:AbortSignal.timeout(20000),...options});}
export async function renewSession(){
 if(paused)throw sessionError('Entre novamente na sua conta.',401);if(renewing)return renewing;const turn=generation;
 const work=lock(async()=>{
  if(paused||turn!==generation)throw sessionError('A sessão foi encerrada.',401);
  const checked=await raw('/api/auth/me');let current=null;if(checked.ok)current=await checked.json();else if(checked.status!==401)throw sessionError('Não foi possível conferir a sessão agora.',checked.status);
  if(current?.user&&(!current.session?.canRefresh||current.session.expiresAt>Date.now()+120000)){if(turn===generation)observe(current);return current;}
  if(checked.ok&&!current?.user&&current.session?.canRefresh===false){paused=true;last=null;clearTimeout(timer);notify('session-expired');throw sessionError('Entre novamente na sua conta.',401);}
  const response=await raw('/api/auth/refresh',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),data=await response.json();
  if(turn!==generation)throw sessionError('A sessão foi encerrada.',401);
  if(!response.ok){if(response.status===401){paused=true;clearTimeout(timer);last=null;notify('session-expired');}throw sessionError(data.error||'Não foi possível renovar a sessão.',response.status);}
  observe(data);return data;
 });
 renewing=work;try{return await work;}finally{if(renewing===work)renewing=null;}
}
async function logout(path,options){
 const before=last;generation++;paused=true;clearTimeout(timer);
 try{return await lock(async()=>{const response=await raw(path,options);if(response.ok){last=null;channel?.postMessage({type:'signed-out'});}else{paused=false;last=before;schedule();}return response;});}
 catch(e){paused=false;last=before;schedule();throw e;}
}
export async function sessionFetch(path,options={}){
 const pathname=new URL(path,location.origin||location.href).pathname;
 if(pathname==='/api/auth/logout')return logout(path,options);
 let response=await raw(path,options);
 const protectedRoute=pathname==='/api/auth/me'||!pathname.startsWith('/api/auth/');
 let metadata=null;
 if(response.ok&&['/api/auth/me','/api/auth/callback'].includes(pathname)){metadata=await response.clone().json();observe(metadata);if(pathname.endsWith('/callback'))channel?.postMessage({type:'session-changed'});}
 if(protectedRoute&&(response.status===401||pathname==='/api/auth/me'&&metadata?.user===null&&metadata.session?.canRefresh)){
  try{await renewSession();}catch(e){if(e.status===401)return response;throw e;}
  response=await raw(path,options);if(pathname==='/api/auth/me'&&response.ok)observe(await response.clone().json());
 }
 if(response.status===409){const data=await response.clone().json();if(data.code==='ACCOUNT_CHANGED'){const me=await raw('/api/auth/me');if(me.ok)observe(await me.json());}}
 return response;
}
function resume(){if(!paused&&last?.session?.canRefresh&&(!last.session.expiresAt||last.session.expiresAt<Date.now()+120000))void renewSession().catch(()=>{});}
window.addEventListener('online',resume);window.addEventListener('focus',resume);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)resume();});
if(channel)channel.onmessage=event=>{
 if(event.data?.type==='signed-out'){generation++;paused=true;last=null;clearTimeout(timer);notify('session-ended');}
 if(event.data?.type==='session-changed')void raw('/api/auth/me').then(async r=>{if(r.ok)observe(await r.json());}).catch(()=>{});
};
