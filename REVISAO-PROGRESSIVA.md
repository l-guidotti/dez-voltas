# Revisão com progressão projetada e variedade

As novas revisões usam `review.policy="progressive-v1"`. O servidor calcula limites específicos para cada semana do bloco e envia comparações pareadas entre planejado e realizado. A resposta continua sendo uma proposta: só muda o calendário quando o usuário decide adotar.

## O que mudou

- A referência de distância é o realizado confirmado, sem ficar limitada ao volume de um plano anterior potencialmente subestimado.
- Um RPE acima de 6 deixa de impedir progressão por si só. O modelo recebe distância, duração, esforço, observações, variação de ritmo e a recuperação registrada. Diferença de execução não prova intenção; o prompt não inventa o motivo.
- A duração projetada considera a possibilidade de executar a mesma distância em esforço mais fácil: utiliza o maior entre duração realizada e planejada, limitada a 1,5 vez a realizada e à disponibilidade. Os tetos de minutos × RPE continuam sendo conferidos.
- As quatro semanas podem evoluir em volume/tempo ou estímulo, sem elevar volume e dose/pico de qualidade simultaneamente. Cada semana possui uma condição explícita de recuperação.
- A qualidade pode ser introduzida mesmo que não constasse no plano anterior. Com fechamento favorável/completo, preferência equilibrada, restrição ausente, experiência de pelo menos seis meses (incluindo retorno), oito semanas de consistência informadas, pelo menos três dias de corrida observados e 12 km na semana, o produto permite avaliar uma sessão controlada por semana. Limita a introdução a oito minutos em RPE >=5 e pico até 6, com aquecimento/desaquecimento, recuperação e espaçamento do longo. Prática de qualidade já registrada pode preservar dose e pico dentro da faixa anterior.
- Intervalado descreve a estrutura das repetições: na revisão progressiva ele pode usar picos controlados de RPE 5–6. Não é obrigatório transformar todo intervalado em tiros de RPE 7–8.

Esses números são controles do produto, não garantias clínicas nem fórmulas universais. Tetos são margens máximas, não metas obrigatórias. A meta final de 134,112 km não vira uma prescrição de volume semanal.

## Projeções do bloco

O primeiro teto de distância mantém o realizado quando há apenas uma semana favorável, pode permitir até 5% com as evidências de duas semanas ou reduzir 20% quando a recuperação/cobertura dos registros pede redução. As projeções seguintes têm margens de até 5% por semana (6% após duas semanas favoráveis) ou retomada de até 8% após a redução inicial. A janela final de 14 dias recebe redução e não inclui qualidade. Dor e doença continuam bloqueando novas cargas antes da chamada.

As semanas seguintes são condicionais e serão revistas no próximo fechamento. A ausência de registros diários não comprova boa recuperação. O modelo pode manter ou reduzir e deve justificar essa escolha no foco da semana, em vez de repetir automaticamente um bloco idêntico.

## Persistência e compatibilidade

Os limites por semana, condições e permissão de qualidade são persistidos dentro do perfil validado do plano e sobrevivem a sincronização, exportação e importação. Revisões antigas sem o marcador continuam usando sua validação anterior; nenhum ID, diário ou plano antigo é reescrito. Não há migração de banco.

O protocolo passa a `x-dv-training-format: 4`, e o cache a v33, para impedir que leitores antigos descartem os novos limites ao adotar ou sincronizar. As condições de execução aparecem no calendário adotado. Após publicar, fechar e reabrir o PWA carrega a versão nova.

## Teste com resposta preservada

O contexto interno `diagnostic.mode="progressive-review-preview"` executa o fluxo normal de preparo e prompt novos, com seus limites ativos, preservando a proposta/texto antes da conferência. O resultado tem `plan:null` e `adoptable:false`, destinado somente a diagnóstico em conta temporária. O modo anterior sem teto de distância continua separado. Nenhum modo diagnóstico é ativável pelo formulário público.

`checks/progressive-review.mjs` cobre introdução dos três tipos, contexto de RPE 7, limites por semana e sua aplicação, redução/retomada, polimento, persistência/IDs e o pedido Gemini completo com provedor simulado. Os demais testes continuam verificando planos e protocolos anteriores.

## Aderência do retorno do Gemini

A duração de cada sessão é calculada no servidor a partir dos blocos: `sum(repeats * (minutes + recoveryMinutes))`, incluindo a recuperação da última repetição. O schema do provedor não solicita `minutes` na sessão nem `totalKm` na semana. Nenhum bloco, distância, esforço ou data é reduzido automaticamente para passar na validação. Arquivos e planos já armazenados continuam exigindo totais consistentes.

O servidor confere a proposta inteira e prepara erros com o caminho do campo, totais semanais e limites concretos. Uma resposta completa e inválida pode receber uma única chamada de correção ao Gemini, com a resposta original e esse diagnóstico. A correção deve retornar o plano completo e passa novamente pelo mesmo validador. Se continuar inválida, não é oferecida como proposta adotável. Respostas incompletas e falhas de transporte continuam seguindo o tratamento existente da fila.

Essa chamada adicional só é enviada após `reserve_ai_correction` autorizar a reserva atômica: capacidade privada do runner, tarefa em processamento, lease correta com tempo restante, fila habilitada, cota diária disponível e apenas uma tentativa consumida. A reserva consome a segunda tentativa da própria tarefa e da cota global; não cria um terceiro disparo. Os tokens das duas respostas são somados, inclusive quando a correção falha. A migração `20261104033134_reserve_gemini_correction.sql` deve ser aplicada antes da publicação do worker. Não modifica planos, diários ou contas.

O calendário enviado já exclui, das datas sugeridas para qualidade, a véspera e o dia seguinte ao longo de dia fixo, considerando todo o bloco. O validador mantém a conferência independente de espaçamento.

O relatório diagnóstico registra ambas as respostas e os erros, mantendo `plan:null` e `adoptable:false`. Passar no validador significa consistência com as regras do produto; não demonstra resultado esportivo nem garante que o provedor nunca falhará. `checks/generation-reliability.mjs` verifica duração calculada, arquivo estrito, feedback, limite de chamadas, contabilização, recusa de cota e a função SQL em PostgreSQL local.
