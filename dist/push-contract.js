export const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validatePushSettings(raw){
 if(!raw||typeof raw.training!=='boolean'||typeof raw.diary!=='boolean')throw Error('Escolha quais lembretes deseja receber.');
 for(const key of ['trainingTime','diaryTime'])if(typeof raw[key]!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw[key]))throw Error('Informe horários válidos para os lembretes.');
 if(typeof raw.timeZone!=='string'||raw.timeZone.length>80)throw Error('Fuso horário inválido.');try{new Intl.DateTimeFormat('pt-BR',{timeZone:raw.timeZone}).format();}catch{throw Error('Fuso horário inválido.');}
 return {training:raw.training,diary:raw.diary,trainingTime:raw.trainingTime,diaryTime:raw.diaryTime,timeZone:raw.timeZone};
}
export function pushEndpoint(raw){
 if(typeof raw!=='string'||raw.length>2048)throw Error('Assinatura de notificações inválida.');const url=new URL(raw);
 const allowed=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(url.hostname)||/^[a-z0-9.-]+\.notify\.windows\.com$/.test(url.hostname);
 if(!allowed||url.protocol!=='https:'||url.username||url.password||url.port||url.hash||url.pathname==='/')throw Error('Serviço de notificações não compatível com este PWA.');return url.href;
}
export function validateSubscription(raw){
 const endpoint=pushEndpoint(raw?.endpoint),keys=raw?.keys;
 if(!keys||!/^[-_A-Za-z0-9]{87}=?$/.test(keys.p256dh||'')||!/^[-_A-Za-z0-9]{22}={0,2}$/.test(keys.auth||''))throw Error('Chaves da assinatura de notificações inválidas.');
 return {endpoint,keys:{p256dh:keys.p256dh.replace(/=/g,''),auth:keys.auth.replace(/=/g,'')}};
}
