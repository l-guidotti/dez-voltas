// RFC 8291 aes128gcm and RFC 8292 VAPID, using standard WebCrypto only.
import {pushEndpoint} from '../dist/push-contract.js';
const utf8=new TextEncoder();
export const encode64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const decode64=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const concat=(...arrays)=>{const out=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let offset=0;for(const a of arrays){out.set(a,offset);offset+=a.length;}return out;};
export async function generateVapid(){
 const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 return {publicKey:encode64(await crypto.subtle.exportKey('raw',keys.publicKey)),privateKey:await crypto.subtle.exportKey('jwk',keys.privateKey)};
}
async function hkdf(input,salt,info,bits){const key=await crypto.subtle.importKey('raw',input,'HKDF',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},key,bits));}
export async function encryptPush(subscription,plaintext,{keys,salt}={}){
 const ua=decode64(subscription.keys.p256dh),auth=decode64(subscription.keys.auth);
 if(ua.length!==65||ua[0]!==4||auth.length!==16)throw Error('Invalid push keys');
 keys||=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);salt||=crypto.getRandomValues(new Uint8Array(16));
 const as=new Uint8Array(await crypto.subtle.exportKey('raw',keys.publicKey));
 const remote=await crypto.subtle.importKey('raw',ua,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const secret=await crypto.subtle.deriveBits({name:'ECDH',public:remote},keys.privateKey,256);
 const ikm=await hkdf(secret,auth,concat(utf8.encode('WebPush: info\0'),ua,as),256);
 const cek=await hkdf(ikm,salt,utf8.encode('Content-Encoding: aes128gcm\0'),128),nonce=await hkdf(ikm,salt,utf8.encode('Content-Encoding: nonce\0'),96);
 const key=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
 const message=typeof plaintext==='string'?utf8.encode(plaintext):new Uint8Array(plaintext);if(message.length>3000)throw Error('Push payload too large');
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,tagLength:128},key,concat(message,new Uint8Array([2])));
 const header=new Uint8Array(21);header.set(salt);new DataView(header.buffer).setUint32(16,4096,false);header[20]=as.length;
 return concat(header,as,new Uint8Array(ciphertext));
}
export async function vapidHeader(endpoint,material,origin,now=Date.now()){
 const audience=new URL(pushEndpoint(endpoint)).origin;
 const header=encode64(utf8.encode(JSON.stringify({typ:'JWT',alg:'ES256'}))),claims=encode64(utf8.encode(JSON.stringify({aud:audience,exp:Math.floor(now/1000)+43200,sub:origin})));
 const key=await crypto.subtle.importKey('jwk',material.privateKey,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,utf8.encode(header+'.'+claims));
 return `vapid t=${header}.${claims}.${encode64(signature)},k=${material.publicKey}`;
}
export async function sendPush(job,origin){
 const endpoint=pushEndpoint(job.endpoint),payload=JSON.stringify({type:job.kind,day:job.day,timeZone:job.time_zone});
 const body=await encryptPush({keys:{p256dh:job.p256dh,auth:job.auth}},payload);
 const authorization=await vapidHeader(endpoint,{privateKey:job.privateKey,publicKey:job.publicKey},origin);
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/octet-stream','content-encoding':'aes128gcm',authorization,TTL:'900',Urgency:'normal'},body,redirect:'error',signal:AbortSignal.timeout(12000)});
 // Never persist/log provider bodies or endpoint URLs (which contain subscription credentials).
 if(response.body)await response.body.cancel();
 return {accepted:response.status>=200&&response.status<300,invalid:response.status===404||response.status===410,retryable:response.status===429||response.status>=500,status:response.status};
}
