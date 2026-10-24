// Real Chromium with a mobile viewport and local-only API fixtures. No production data or AI calls.
// Run: node checks/profile-draft-browser.mjs (CHROME_BIN may override chromium).
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
const root=resolve('dist'),temp=await mkdtemp(join(tmpdir(),'dez-draft-browser-'));
let generationJob=null;
let account={id:'browser-runner-a',email:'a@example.test'},cursor=0,syncs=0,posts=0;
const rows=new Map(),errors=[],pending=new Map();let chrome,ws,sequence=0;
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){
   res.setHeader('content-type','application/json');
   if(path==='/api/auth/me')return res.end(JSON.stringify({user:account,session:{canRefresh:false}}));
   if(path==='/api/auth/logout'){account=null;return res.end('{}');}
   if(path==='/api/training/jobs')return res.end(JSON.stringify({job:generationJob,history:[]}));
   if(path==='/api/account/sync'){
    syncs++;
    if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;for(const row of JSON.parse(body).changes){rows.set(row.kind+':'+row.id,{...row,revision:row.revision+1});cursor++;}}
    return res.end(JSON.stringify({cursor,rows:[...rows.values()],legacy_revision:null}));
   }
   posts++;res.statusCode=400;return res.end(JSON.stringify({error:'Unexpected API call'}));
  }
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+'/'))throw Error('Invalid path');
  const data=await readFile(file);res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[extname(file)]||'application/octet-stream');res.end(data);
 }catch{res.statusCode=404;res.end('Not found');}
});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<120;i++){if(await fn())return;await pause(50);}throw Error('Timed out waiting for browser');}
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
const field=name=>`document.querySelector('#profile-goal [name="${name}"]')`;
async function fill(name,value,event='input'){await evaluate(`(()=>{const node=${field(name)};node.focus();node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('${event}',{bubbles:true}));})()`);}
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 chrome=spawn(process.env.CHROME_BIN||'chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+temp,'about:blank'],{stdio:'ignore'});
 await until(async()=>{try{return !!(await readFile(join(temp,'DevToolsActivePort'),'utf8'));}catch{return false;}});
 const port=(await readFile(join(temp,'DevToolsActivePort'),'utf8')).split('\n')[0];const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const entry=pending.get(message.id);pending.delete(message.id);if(message.error)entry.reject(message.error);else entry.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
 await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true});
 await cdp('Page.navigate',{url:origin+'/#perfil'});await until(()=>evaluate(`!!document.querySelector('#profile-goal')`));
 await until(()=>evaluate(`document.querySelector('#account-sync-message')?.textContent==='Sincronizado com sua conta.'`));
 await fill('target','21.1');await fill('eventName','Minha meia no celular');
 await evaluate(`window.oldInput=${field('eventName')};oldInput.setSelectionRange(5,5);window.originalScroll=scrollY;`);
 generationJob={id:'browser-failed-job',status:'failed',attempts:1,error:'Formato de geração rejeitado.'};
 await evaluate(`(async()=>{window.dispatchEvent(new Event('online'));await new Promise(r=>setTimeout(r,100))})()`);
 assert.equal(await evaluate(`document.querySelector('#profile-generation-status').textContent`),'Formato de geração rejeitado.');
 assert.equal(await evaluate('oldInput.isConnected&&document.activeElement===oldInput'),true);
 generationJob=null;await evaluate('window.originalScroll=scrollY');
 const before=syncs;
 await evaluate(`(async()=>{await (await import('/account-sync.js')).synchronize()})()`);
 assert.ok(syncs>before);assert.equal(await evaluate(`${field('eventName')}.value`),'Minha meia no celular');
 assert.equal(await evaluate(`document.activeElement===oldInput&&oldInput.isConnected&&oldInput.selectionStart===5`),true,'Cloud sync must preserve the same input and caret');
 assert.equal(await evaluate('scrollY===originalScroll'),true);
 assert.equal(await evaluate(`localStorage.getItem('dez-voltas-draft-v1:browser-runner-a')`),null,'Incomplete form must not enter cloud profile');
 await evaluate(`window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));`);
 await pause(150);assert.equal(await evaluate(`${field('target')}.value`),'21.1');assert.equal(await evaluate('oldInput.isConnected'),true);
 await cdp('Page.reload',{ignoreCache:true});await until(()=>evaluate(`!!document.querySelector('#profile-goal')`));
 assert.equal(await evaluate(`${field('eventName')}.value`),'Minha meia no celular');assert.equal(await evaluate(`${field('weeklyKm')}.value`),'');
 // Explicit navigation and checkbox/select rerenders must preserve fields and focus.
 await evaluate(`location.hash='#hoje'`);await pause(50);await evaluate(`location.hash='#perfil'`);await pause(50);
 for(const day of [0,2,4])await evaluate(`document.querySelector('#profile-goal [name="days"][value="${day}"]').click()`);
 assert.equal(await evaluate(`${field('eventName')}.value`),'Minha meia no celular');
 await fill('longDay','0','change');await fill('goal','backyard','change');
 assert.equal(await evaluate(`document.activeElement.name`),'goal');assert.equal(await evaluate(`${field('target')}.value`),'');assert.equal(await evaluate(`${field('longDay')}.value`),'0');
 await fill('target','10');await fill('goal','distance','change');await fill('target','21.1');
 for(const [name,value]of Object.entries({weeklyKm:'25',longestKm:'10',weeksConsistent:'8'}))await fill(name,value);
 await fill('pain','none','change');
 await evaluate(`window.completeInput=${field('pain')}`);await evaluate(`(async()=>{await (await import('/account-sync.js')).synchronize()})()`);
 assert.equal(await evaluate('completeInput.isConnected&&document.activeElement===completeInput'),true);
 await evaluate(`document.querySelector('[data-profile="save-profile"]').click()`);
 await until(()=>evaluate(`!!document.querySelector('#profile-goal [name="consent"]')`));
 assert.equal(await evaluate(`localStorage.getItem('dez-voltas-profile-edit-v1:browser-runner-a')`),null);
 assert.equal(await evaluate(`JSON.parse(localStorage.getItem('dez-voltas-draft-v1:browser-runner-a')).details.registrationCompleted`),true);
 // Inspect the actual comparison component at mobile size, including colors and week details.
 const makeComparisonPlan=(from,km,id)=>({id,owner:account.id,profile:{startDate:from,targetDate:'2027-05-01',...(id==='new'?{review:{sourcePlanId:'old'}}:{})},plan:{weeks:Array.from({length:4},(_,i)=>{const date=new Date(Date.parse(from+'T12:00:00Z')+i*7*86400000).toISOString().slice(0,10);return {start:date,sessions:[{date,km,minutes:km*6,rpe:id==='new'?4:3}]};})}});
 const comparisonSource=makeComparisonPlan('2027-01-04',20,'old'),comparisonNext=makeComparisonPlan('2027-01-11',25,'new');
 await evaluate(`(async()=>{const {renderPlanComparison}=await import('/plan-comparison.js');document.querySelector('#profile-result-region').innerHTML='<section class="panel profile-result">'+renderPlanComparison(${JSON.stringify(comparisonNext)},${JSON.stringify({owner:account.id,plans:[comparisonSource],activePlan:comparisonSource})})+'</section>';document.querySelector('.plan-comparison').scrollIntoView();})()`);
 assert.equal(await evaluate(`document.querySelector('.plan-comparison').textContent.includes('Aumento de 15 km')`),true);
 assert.equal(await evaluate(`document.documentElement.scrollWidth<=document.documentElement.clientWidth`),true,'Comparison must fit a mobile screen');
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('.compare-higher')).color`),'rgb(34, 95, 57)');
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('.compare-lower')).color`),'rgb(154, 48, 42)');
 await evaluate(`document.querySelector('.plan-compare-weeks summary').click()`);
 assert.equal(await evaluate(`document.querySelector('.plan-compare-weeks').open`),true);
 assert.equal(await evaluate(`document.querySelector('.plan-compare-week').textContent.includes('Aumento de 5 km')`),true);
 if(process.env.DV_COMPARISON_SCREENSHOT){const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(process.env.DV_COMPARISON_SCREENSHOT,Buffer.from(shot.data,'base64'));}
 // New partial edits on a completed account survive logout, remain private and resume after login.
 await fill('eventName','Edição ainda em andamento');await evaluate(`document.querySelector('[data-profile="logout"]').click()`);
 await until(()=>evaluate(`!document.querySelector('#profile-goal')`));
 account={id:'browser-runner-b',email:'b@example.test'};rows.clear();cursor=0;
 await cdp('Page.reload',{ignoreCache:true});await until(()=>evaluate(`!!document.querySelector('#profile-goal')`));
 assert.equal(await evaluate(`${field('eventName')}.value`),'');
 await evaluate(`document.querySelector('[data-profile="logout"]').click()`);await until(()=>evaluate(`!document.querySelector('#profile-goal')`));
 account={id:'browser-runner-a',email:'a@example.test'};
 await cdp('Page.reload',{ignoreCache:true});await until(()=>evaluate(`!!document.querySelector('#profile-goal')`));
 assert.equal(await evaluate(`${field('eventName')}.value`),'Edição ainda em andamento');
 assert.equal(posts,0);assert.deepEqual(errors,[]);
 console.log('PASS: comparação móvel com cores, diferenças semanais e sem rolagem horizontal. Chromium mobile 390×844: real sync keeps input/caret/scroll, focus/visibility/online, reload, goal/days, registration completion, logout and account isolation (local API fixtures).');
}finally{ws?.close();chrome?.kill();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
