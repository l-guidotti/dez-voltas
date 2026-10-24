import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto??=webcrypto;
import {encryptPush,decode64,encode64,generateVapid,vapidHeader,sendPush} from '../server/web-push.js';
import {validatePushSettings,validateSubscription,pushEndpoint} from '../dist/push-contract.js';
// Independent RFC 8291 Appendix A known-answer vector, not a copy of our decryption routine.
const asPublic=decode64('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
const privateKey=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:encode64(asPublic.slice(1,33)),y:encode64(asPublic.slice(33)),d:'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'},{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
const publicKey=await crypto.subtle.importKey('raw',asPublic,{name:'ECDH',namedCurve:'P-256'},true,[]);
const subscription={endpoint:'https://web.push.apple.com/test-token',keys:{p256dh:'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',auth:'BTBZMqHH6r4Tts7J_aSIgg'}};
const encrypted=await encryptPush(subscription,decode64('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),{keys:{privateKey,publicKey},salt:decode64('DGv6ra1nlYgDCS1FRnbzlw')});
assert.equal(encode64(encrypted.slice(86)),'8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ');
assert.equal(new DataView(encrypted.buffer).getUint32(16),4096);assert.equal(encrypted[20],65);
const material=await generateVapid(),now=Date.now(),header=await vapidHeader(subscription.endpoint,material,'https://dez-voltas.pages.dev',now);
const jwt=/t=([^,]+)/.exec(header)[1],parts=jwt.split('.'),claims=JSON.parse(new TextDecoder().decode(decode64(parts[1])));
assert.equal(claims.aud,'https://web.push.apple.com');assert.equal(claims.sub,'https://dez-voltas.pages.dev');assert.ok(claims.exp>now/1000&&claims.exp<now/1000+86400);
const verifyKey=await crypto.subtle.importKey('raw',decode64(material.publicKey),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},verifyKey,decode64(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])),true);
for(const url of ['http://web.push.apple.com/x','https://example.com/x','https://127.0.0.1/x','https://web.push.apple.com:8443/x','https://user@web.push.apple.com/x','https://web.push.apple.com/x#bad'])assert.throws(()=>pushEndpoint(url));
assert.deepEqual(validateSubscription(subscription),subscription);assert.throws(()=>validatePushSettings({training:true,diary:true,trainingTime:'25:00',diaryTime:'20:00',timeZone:'UTC'}));
let status=201;globalThis.fetch=async(url,options)=>{assert.equal(url,subscription.endpoint);assert.equal(options.redirect,'error');assert.equal(options.headers['content-encoding'],'aes128gcm');assert.ok(!new TextDecoder().decode(options.body).includes('diary'));return new Response(null,{status});};
let result=await sendPush({...subscription,...subscription.keys,kind:'diary',day:'2026-10-24',time_zone:'America/Sao_Paulo',...material},'https://dez-voltas.pages.dev');assert.equal(result.accepted,true);
for(const [code,invalid,retryable]of [[410,true,false],[404,true,false],[429,false,true],[503,false,true],[400,false,false]]){status=code;result=await sendPush({...subscription,...subscription.keys,kind:'diary',day:'2026-10-24',time_zone:'UTC',...material},'https://dez-voltas.pages.dev');assert.equal(result.invalid,invalid);assert.equal(result.retryable,retryable);}
console.log('PASS: Web Push RFC 8291 known-answer encryption, VAPID signature/audience/expiry, endpoint allowlist and provider response classification.');
