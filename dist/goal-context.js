import {validateStoredProfile,daysBetween} from './training-contract.js';
export function objectiveContext(active,owner,read){
 if(active)return {profile:active.profile,source:'active'};
 if(!owner)return null;
 for(const [key,nested]of [['dez-voltas-draft-v1:',false],['dez-voltas-profile-v1:',true]])try{const raw=JSON.parse(read(key+owner)||'null'),profile=nested?raw?.profile:raw;if(profile)return {profile:validateStoredProfile(profile,profile.startDate),source:'profile'};}catch{}
 return null;
}
export function objectiveDate(profile,today){
 const days=daysBetween(today,profile.targetDate);
 return {days,value:days===0?'Hoje':String(Math.abs(days)),label:days===0?'é o dia do objetivo':days>0?'dias até o objetivo':'dias desde o objetivo',past:days<0};
}
export function guideFor(profile,active){
 const cards=[];const add=(icon,title,...paragraphs)=>cards.push({icon,title,paragraphs});
 const easy=!profile||profile.weeklyKm<20||['beginner','returning'].includes(profile.details?.experience);
 add('heart','Entenda seu esforço',easy?'Nas corridas leves, procure conseguir conversar em frases completas. Caminhar pode ajudar a manter esse conforto. A base recente orienta a progressão.':'Siga o esforço indicado em cada sessão. Corridas leves devem permitir conversa confortável; ritmo de prova e ritmo de treino têm funções diferentes.','Registre o esforço percebido de 1 a 10. Se uma sessão fácil exige esforço alto, revise a carga e a recuperação antes de avançar.');
 add('shoe','Antes, durante e depois','Consulte as instruções completas da sessão para aquecimento, parte principal e retorno à calma. Tempo e distância adicionais também entram na carga.','Registre o que realizou: duração, distância, esforço e observações. Não é necessário reproduzir exatamente os números planejados para fazer um registro honesto.');
 add('leaf','Recuperação e continuidade','Sono, alimentação e descanso ajudam a sustentar a rotina. Evite compensar sessões perdidas acumulando treinos nos dias seguintes.','Dor crescente ou que altera a passada pede interrupção e avaliação. Cansaço persistente é motivo para revisar a carga.');
 if(profile?.pain&&profile.pain!=='none')add('info','Antes de gerar novas cargas','Você informou dor atual ou retorno de lesão. Revise sua preparação com um profissional antes de gerar novas cargas; as informações daqui não substituem essa avaliação.');
 const longSessions=active?.plan.weeks.some(w=>w.sessions.some(s=>s.minutes>=90));
 if(profile?.goal==='backyard')add('clock','Preparação para a backyard','O formato padrão tem 6,7056 km por volta e uma nova largada a cada hora. Confirme os detalhes no regulamento da sua edição.','Ao longo de uma preparação adequada, organize também as pausas: alimentação, troca de material e apoio. Qualquer ensaio específico precisa caber no plano e na recuperação; não acrescente voltas por conta própria.');
 else if(profile?.goal==='time')add('clock','Seu objetivo é correr por tempo',`A duração desejada é ${profile.target} minutos. Ela representa a meta final; as sessões do bloco podem ter durações menores e incluir caminhada.`,'Use os minutos e o esforço de cada sessão como referência. Não é necessário transformar o objetivo em uma distância estimada.');
 else if(profile?.goal==='distance')add('flag','Preparação para a distância',`Seu objetivo é completar ${profile.target} km. A distância da prova não precisa aparecer integralmente nos treinos.`,'O tempo desejado de conclusão, quando informado, ajuda a avaliar a viabilidade. Ele não define automaticamente o ritmo de todas as sessões.');
 const terrain=profile?.details?.terrain;
 if(terrain==='trail'||terrain==='mixed')add('shoe','Terreno e desnível','Subidas, descidas e piso irregular mudam o esforço. Compare sessões considerando o terreno, e não apenas o ritmo por quilômetro.','Conheça o percurso e os equipamentos exigidos. Introduza contato com o terreno conforme a preparação, sem adicionar carga além do plano.');
 else if(terrain==='treadmill')add('shoe','Treinar na esteira','Confira ventilação, segurança e ajustes do equipamento. Use o esforço e as instruções da sessão; não há uma inclinação universal que precise ser aplicada.');
 else add('shoe','Seu percurso','Prefira locais seguros e conhecidos. Considere trânsito, iluminação, piso e condições do tempo ao organizar a sessão.');
 add('bottle','Água e alimentação',profile?.goal==='backyard'||longSessions||profile?.goal==='distance'&&profile.target>=21?'Nos treinos longos previstos no plano, pratique a alimentação com produtos e porções que você tolera. A estratégia depende da duração, das condições e das suas necessidades.':'Planeje água e refeições conforme a duração da sessão e sua rotina. Consulte as condições do local e os pontos de apoio disponíveis.','Ajuste a hidratação à sede, ao calor e ao suor. Evite forçar um volume fixo para todas as pessoas e sessões.');
 add('strength','Força na sua rotina','Se já faz fortalecimento, organize-o preservando a recuperação entre corridas. Ao introduzir exercícios novos, comece de forma gradual e considere orientação profissional.');
 return cards;
}
