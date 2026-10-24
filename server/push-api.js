import {validatePushSettings,validateSubscription,uuidPattern} from '../dist/push-contract.js';
import {generateVapid,sendPush,decode64} from './web-push.js';
export async function pushApi({request,env,path,authenticate,access,rpc,bodyOf,fail}){
 if(path.startsWith('/api/internal/push-')){
  if(request.method!=='POST')throw fail(405,'Método inválido.');
  const runner_key=request.headers.get('x-dv-runner-key');if(!/^[a-f0-9]{64}$/.test(runner_key||''))throw fail(403,'Acesso não autorizado.');
  if(path==='/api/internal/push-setup'){
   const configured=await rpc('push_key_state',{runner_key});
   if(!configured.ready){const keys=await generateVapid();await rpc('install_push_keys',{runner_key,public_key:keys.publicKey,private_key:keys.privateKey});}
   return {ready:true};
  }
  if(path==='/api/internal/push-runner'){
   let processed=0;
   for(let i=0;i<5;i++){
    const job=await rpc('claim_push_reminder',{runner_key});if(!job)break;
    let result;try{result=await sendPush(job,env.APP_ORIGIN);}catch(e){const transient=e.name==='TimeoutError'||e.name==='AbortError'||e instanceof TypeError;result={accepted:false,invalid:!transient,retryable:transient,status:0};}
    await rpc('finish_push_reminder',{runner_key,job_id:job.id,job_lease:job.lease,accepted:result.accepted,invalid:result.invalid,retryable:result.retryable,provider_status:result.status});processed++;
   }
   return {processed};
  }
  return null;
 }
 if(!['/api/push/settings','/api/push/test'].includes(path))return null;
 await authenticate();const token=access();
 if(path==='/api/push/settings'&&request.method==='GET'){
  const id=new URL(request.url).searchParams.get('deviceId');if(id&&!uuidPattern.test(id))throw fail(400,'Identificação do aparelho inválida.');
  return {config:await rpc('read_push_config',{},token),device:id?await rpc('read_push_device',{device_id:id},token):null};
 }
 if(request.method!=='POST')throw fail(405,'Método inválido.');
 const body=await bodyOf(request,6000);if(!uuidPattern.test(body.deviceId||''))throw fail(400,'Identificação do aparelho inválida.');
 if(path==='/api/push/test')return {queued:await rpc('test_push_device',{device_id:body.deviceId},token)};
 if(body.disable===true){await rpc('remove_push_device',{device_id:body.deviceId},token);return {disabled:true};}
 let settings,subscription;try{settings=validatePushSettings(body.settings);subscription=validateSubscription(body.subscription);}catch(e){throw fail(400,e.message);}
 try{const key=decode64(subscription.keys.p256dh);if(key.length!==65||key[0]!==4||decode64(subscription.keys.auth).length!==16)throw Error();await crypto.subtle.importKey('raw',key,{name:'ECDH',namedCurve:'P-256'},false,[]);}catch{throw fail(400,'Chaves da assinatura de notificações inválidas.');}
 const result=await rpc('save_push_device',{device_id:body.deviceId,subscription,preferences:settings},token);
 return {device:result};
}
