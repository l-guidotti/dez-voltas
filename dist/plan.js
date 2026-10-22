export const START='2026-10-26';
export const RACE='2027-04-10';
export const YARD=6.7056;
export const PLAN=[
 {runs:[5,6,6,8],label:'Encontrar o ritmo',focus:'Quatro corridas fáceis. Os 25 km são um alvo ajustável; observe como se recupera entre as sessões.'},
 {runs:[5,6,6,8],label:'Estabilizar',focus:'Repita a carga. Termine as corridas com a sensação de que conseguiria continuar.'},
 {runs:[4,5,5,6],label:'Absorver o treino',focus:'Semana de recuperação. Menos volume faz parte da preparação.'},
 {runs:[5,6,7,9],label:'Construir com calma',focus:'Avance apenas se a semana anterior foi confortável e você recuperou bem.'},
 {runs:[6,6,7,10],label:'Ganhar resistência',focus:'Pratique a caminhada planejada e leve água conforme as condições do treino.'},
 {runs:[6,7,7,11],label:'Alongar o tempo',focus:'Se o treino passar de 75–90 minutos, comece a ensaiar alimentação em pequenas porções.'},
 {runs:[5,5,5,8],label:'Recuperar para seguir',focus:'Reduza o volume e observe sono, disposição e conforto ao correr.'},
 {runs:[6,7,7,12],label:'Consolidar a base',focus:'Feche o bloco e revise a próxima etapa a partir do volume que realmente conseguiu sustentar.'}
].map((w,i)=>({...w,week:i+1,total:w.runs.reduce((a,b)=>a+b,0)}));
export const MILESTONES=[
 {from:'2026-12-21',to:'2027-01-17',title:'Revisar e ampliar a base',text:'Avaliar o bloco de oito semanas, a recuperação e a consistência antes de definir novos volumes.'},
 {from:'2027-01-18',to:'2027-02-14',title:'Desenvolver resistência',text:'Planejar longões progressivos e alimentação conforme a adaptação. Volumes ainda precisam de revisão.'},
 {from:'2027-02-15',to:'2027-03-21',title:'Praticar o formato backyard',text:'Introduzir voltas com largadas de hora em hora, pausas e apoio. A quantidade depende da preparação efetivamente concluída.'},
 {from:'2027-03-22',to:RACE,title:'Reduzir e chegar descansado',text:'Ajustar a redução final ao maior treino realizado e à recuperação. Reavaliar a meta de dez voltas.'}
];
export function addDays(iso,n){const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
export function sessions(){return PLAN.flatMap(w=>[1,2,4,6].map((offset,j)=>({id:`w${w.week}d${j}`,date:addDays(START,(w.week-1)*7+offset),week:w.week,km:w.runs[j],long:j===3,title:j===3?'Rodagem mais longa':'Corrida leve'})))}
export const SESSIONS=sessions();
