// Original, dependency-free encoder for the documented FIT Workout file format.
// https://developer.garmin.com/fit/articles/file-types/workout.html
// All targets are OPEN: this export adds no pace, heart-rate or power prescription.
const FIT_EPOCH=Date.UTC(1989,11,31);
const encoder=new TextEncoder();
function join(...arrays){const out=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let at=0;for(const a of arrays){out.set(a,at);at+=a.length;}return out;}
function u16(value){const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,value,true);return a;}
function u32(value){const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,value,true);return a;}
function string(value,size){const out=new Uint8Array(size);out.set(encoder.encode(value).slice(0,size-1));return out;}
function field(num,type,data){return {num,type,data};}
function record(local,global,fields){const definition=join(Uint8Array.of(0x40|local,0,0),u16(global),Uint8Array.of(fields.length),...fields.map(f=>Uint8Array.of(f.num,f.data.length,f.type)));return join(definition,Uint8Array.of(local),...fields.map(f=>f.data));}
export function fitCRC(bytes){let crc=0;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc&1)?(crc>>>1)^0xA001:crc>>>1;}return crc;}
function serial(text){let h=2166136261;for(const c of text){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0)||1;}
export function workoutRecipe(session,{warmupMinutes=5,cooldownMinutes=5}={}){
 if(!session||!/^\d{4}-\d{2}-\d{2}$/.test(session.date)||!Number.isFinite(session.km)||session.km<=0||session.km>150)throw new Error('Sessão inválida para exportação.');
 for(const minutes of [warmupMinutes,cooldownMinutes])if(!Number.isInteger(minutes)||minutes<0||minutes>15)throw new Error('Use de 0 a 15 minutos inteiros para aquecer e desacelerar.');
 const steps=[];
 if(warmupMinutes)steps.push({name:'Aquecimento',durationType:0,value:warmupMinutes*60000,intensity:2,notes:'Caminhar ou trotar muito leve. Sem meta de ritmo.'});
 steps.push({name:'Corrida leve',durationType:1,value:Math.round(session.km*100000),intensity:0,notes:'Converse em frases completas. Caminhe se precisar.'});
 if(cooldownMinutes)steps.push({name:'Desaquecer',durationType:0,value:cooldownMinutes*60000,intensity:3,notes:'Desacelere e caminhe confortavelmente.'});
 const name=`DV S${String(session.week).padStart(2,'0')} ${session.date.slice(8,10)}-${session.date.slice(5,7)} ${session.km}km`;
 return {name,date:session.date,km:session.km,warmupMinutes,cooldownMinutes,steps};
}
export function workoutInstructions(session,options){const r=workoutRecipe(session,options);return [`DEZ VOLTAS — ${r.name}`,`Data planejada: ${r.date.split('-').reverse().join('/')}`,`Nome sugerido do modelo: DV Leve ${r.km}km`,`Modalidade: corrida ao ar livre`,...r.steps.map((s,i)=>`${i+1}. ${s.name}: ${s.durationType===0?s.value/60000+' min':r.km+' km'}. ${s.notes}`),'Esforço livre e confortável; sem meta fixa de ritmo, frequência cardíaca ou potência.','A distância do plano corresponde à etapa principal; aquecimento e desaquecimento também somam carga.'].join('\n');}
export function exportWorkoutFit(session,options={}){
 const recipe=workoutRecipe(session,options);
 const createdAt=options.createdAt||new Date();const created=Math.floor((createdAt.getTime()-FIT_EPOCH)/1000);
 if(!Number.isFinite(created)||created<0||created>=0xFFFFFFFF)throw new Error('Data de criação inválida.');
 const fileId=record(0,0,[field(0,0x00,Uint8Array.of(5)),field(1,0x84,u16(255)),field(2,0x84,u16(1)),field(3,0x8C,u32(serial(`${session.id}:${session.date}`))),field(4,0x86,u32(created))]);
 const workout=record(1,26,[field(4,0x00,Uint8Array.of(1)),field(6,0x84,u16(recipe.steps.length)),field(8,0x07,string(recipe.name,48)),field(11,0x00,Uint8Array.of(0))]);
 const steps=recipe.steps.map((s,index)=>record(2,27,[field(254,0x84,u16(index)),field(0,0x07,string(s.name,32)),field(1,0x00,Uint8Array.of(s.durationType)),field(2,0x86,u32(s.value)),field(3,0x00,Uint8Array.of(2)),field(4,0x86,u32(0)),field(7,0x00,Uint8Array.of(s.intensity)),field(8,0x07,string(s.notes,100))]));
 const data=join(fileId,workout,...steps);
 // Protocol 2.0; FIT profile 21.58 contains all classic workout fields used here.
 const headerStart=join(Uint8Array.of(14,0x20),u16(2158),u32(data.length),encoder.encode('.FIT'));
 const header=join(headerStart,u16(fitCRC(headerStart)));const body=join(header,data);
 return {...recipe,filename:`dez-voltas-${session.date}-${session.km}km.fit`,bytes:join(body,u16(fitCRC(body)))};
}
