# Tipos de treino e intensidade por perfil

A nova geração não depende só de pedir mais variedade no prompt. O servidor calcula a elegibilidade, restringe os tipos no JSON Schema e valida as etapas e a dose da resposta. Cadastros anteriores continuam válidos: sem os novos dados, a geração mantém a faixa de base. Os planos já salvos não são reescritos.

## Cadastro

Em Minha conta, a seção de experiência/recuperação reúne prática de qualidade nas últimas quatro semanas (nenhuma, ocasional ou semanal), semanas de qualidade regular, fadiga e sono atuais, restrição profissional para esforço intenso e preferência por base ou preparação equilibrada. Esses dados complementam volume recente, consistência, experiência em meses, frequência e disponibilidade já existentes.

São respostas autorreferidas, sem avaliação clínica. A preferência por intensidade não libera treinos por si só. Dor, retorno de lesão, restrição conhecida/incerta, dados ausentes, recuperação ruim e pouca base mantêm os treinos confortáveis. RPE orienta o esforço percebido; não se infere Zona 2, frequência cardíaca, limiar de lactato ou ritmo de prova medidos a partir do formulário.

## Faixas iniciais do produto

As condições abaixo são controles conservadores de elegibilidade, não regras universais de treinamento ou garantia contra lesão. A IA pode escolher menos intensidade e deve justificar a semana.

| Faixa | Condições mínimas adicionais | Tipos de qualidade permitidos |
|---|---|---|
| Base | Padrão quando falta alguma condição | Regenerativo, rodagem e longo em esforço confortável |
| Introdução | 25 km/semana recentes, maior sessão ≥5 km, 8 semanas consistentes, experiência regular ≥6 meses, frequência recente e disponibilidade ≥3 dias, treino comum ≥30 min, preparação >21 dias; fadiga ≤2/5, sono ≥3/5, sem restrição conhecida e preferência equilibrada | Fartlek moderado, pico RPE 5, até 8 min de trechos moderados e 10% dos minutos semanais |
| Regular | Requisitos anteriores +30 km/semana, 12 semanas consistentes, experiência ≥12 meses e qualidade semanal há ≥4 semanas | Fartlek e ritmo, pico até RPE 7, até 15 min de trechos fortes e 15% dos minutos |
| Experiente | Requisitos anteriores +35 km/semana, frequência e disponibilidade ≥4 dias e qualidade semanal há ≥8 semanas | Também intervalado, pico até RPE 8, até 20 min de trechos fortes e 20% dos minutos |

Não há tiros máximos/RPE 9–10. Há no máximo uma sessão de qualidade em qualquer janela de sete dias, com ao menos um dia sem sessão exigente entre qualidade e longo. Neste bloco, não se inclui qualidade nos últimos 14 dias até o objetivo. Ao aumentar volume de uma semana para outra, não se aumenta também a dose ou o pico dos trechos fortes. A maior parte dos minutos permanece fácil; aquecimento e recuperações entram no total.

O esforço global estimado da sessão é diferente do RPE de cada trecho: uma sessão intervalada pode ter RPE global 5 e repetições em RPE 8. O diário continua registrando a percepção global real após o treino. A carga por minutos × RPE é uma referência de acompanhamento, sem equivalência clínica.

## Sessões executáveis

Cada nova sessão inclui `workout.type`, finalidade específica ao objetivo e blocos ordenados: aquecimento, parte principal e desaquecimento. Blocos têm minutos, repetições, RPE, tempo e RPE da recuperação. A recuperação se repete após cada repetição, inclusive a última; o total é a soma de todas as etapas.

Tipos: regenerativo, rodagem contínua, longo confortável, fartlek, ritmo/tempo run e intervalado. Exemplos de formato (dependem da elegibilidade, não são uma prescrição individual):

- Intervalado: 10 min leves + 4 × (2 min forte + 2 min leve) + 5 min leves = 31 min.
- Ritmo: 10 min leves + 2 × (5 min de ritmo + 2 min leves) + 5 min leves = 29 min.
- Rodagem: aquecimento, parte principal contínua e desaquecimento, com finalidade ligada ao objetivo/terreno.

Qualidade exige aquecimento de pelo menos 10 min e desaquecimento de 5 min. Intervalados usam repetições de até 4 min com recuperação explícita; ritmo usa blocos de 3–20 min dentro da dose da faixa; fartlek alterna trechos controlados de até 5 min (2 min na introdução). Longos continuam confortáveis e podem incluir caminhada planejada. Não se exige todos os tipos na mesma semana.

A interface exibe as etapas no resultado e no detalhe do treino. O roteiro e o FIT preservam os tempos e expandem as repetições/recuperações; os alvos de ritmo/FC/potência permanecem abertos, com RPE nas notas. A configuração no Zepp continua manual e não comprova envio ao relógio. Para sessões estruturadas, não se adiciona aquecimento extra pelos campos de exportação.

## Revisão semanal

A recuperação do fechamento substitui sono/fadiga antigos para a avaliação atual. Restrição e preferência atuais do cadastro também entram no retrato, quando disponíveis. Revisões que pedem redução ou têm registros incompletos não liberam qualidade. Uma revisão só preserva qualidade quando há duas semanas confirmadas, boa recuperação e uma sessão estruturada de qualidade registrada na semana, com duração/distância coerentes e esforço global informado compatível. Não se presume que cada repetição foi cumprida: o diário é um relato global e o modelo recebe os dados e observações.

O pico e a dose não ultrapassam a qualidade registrada. Outros tipos podem ser escolhidos dentro da faixa e desses tetos, sem somar uma nova intensidade à elevação de volume. Registros antigos sem etapas continuam utilizáveis para volume/recuperação, mas não comprovam prática de tiros. Os limites semanais de quilômetros, minutos e carga percebida continuam ativos.

## Persistência e compatibilidade

Migração aditiva `database/structured-workouts.sql`: `training_sessions.workout` é JSON opcional. Os RPCs preservam a estrutura nas inclusões e atualizações. Em sessões antigas, a leitura omite a propriedade nula para manter os hashes/IDs e evitar alterações falsas na sincronização. Arquivos, cópias de recuperação e exportações incluem a estrutura de novas sessões.

Novos clientes enviam `x-dv-training-format: 2`. Clientes antigos recebem orientação para atualizar ao gerar, consultar resultados estruturados ou sincronizar sessões com etapas; não descartam silenciosamente o novo formato. Não são necessárias novas chaves, modelos Gemini, cotas ou aumento dos limites de custo.

## Verificação

`npm test` cobre as faixas, dados ausentes/restrição/recuperação, tipos, etapas, somas, dose e espaçamento, schema por perfil, revisão semanal, preservação por sincronização/backup e exportação FIT com CRC. `checks/structured-workouts.sql` verifica inclusão, atualização e leitura de estrutura e compatibilidade das sessões antigas em transação com rollback. As respostas Gemini são simuladas nos testes. Não foi feita uma nova geração faturável nem teste visual em navegador nesta entrega.
