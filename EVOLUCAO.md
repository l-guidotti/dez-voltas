# Revisão semanal da preparação

Na seção **Plano**, usuários com plano em uso encontram **Como foi sua semana?** As semanas têm sete dias contados a partir do início do bloco, sem assumir segunda-feira. O fechamento abre no último dia; o envio ocorre depois que a semana encerra no fuso de São Paulo, enquanto ainda há preparação pela frente.

## Fluxo

1. Registrar os treinos realmente realizados no diário: distância, minutos, esforço percebido, dores e observações. A interface confirma que a sincronização terminou e que não há conflito antes de salvar o fechamento.
2. Informar fadiga, qualidade do sono e disposição (1–5), dor/doença, se o diário está completo e a disponibilidade da próxima semana: dias e tempos. Há espaço para explicar faltas ou mudanças na rotina.
3. Salvar sem autorização apenas guarda o fechamento na conta. A autorização específica permite enviar o fechamento e até 28 dias de registros ao Gemini, incluindo as observações da semana; o e-mail e IDs de conta não são enviados. Cada semana precisa de um novo fechamento e autorização. Não há renovação silenciosa de consentimento nem inferência de recuperação pela ausência de registros.
4. Após o encerramento, um cron enfileira a revisão mesmo com o PWA fechado. O banco monta o retrato com as sessões planejadas do plano em uso, todos os registros realizados dos últimos 28 dias (inclusive planos anteriores), o fechamento e o fechamento anterior. Também fornece as próximas sessões do plano atual e suas fases, para orientar ajustes com continuidade da preparação. Observações livres são incluídas somente para a semana revisada. O usuário não fornece um resumo de treinos inventado pelo navegador.
5. O processador prepara o próximo bloco com início no dia do processamento e a mesma data/objetivo final. O Gemini recebe calendário, limites e evidências. O resultado aparece em **Minha conta**, com avaliação, orientações e fases até a prova. Apenas **Usar este plano** muda o calendário; os planos e registros anteriores continuam no histórico. Uma revisão de outro plano em uso não pode ser adotada.

Depois da adoção, o novo bloco pode ser fechado semanalmente. Isso permite acompanhar meses de preparação, em vez de terminar nos 28 dias da primeira sugestão. Os últimos oito fechamentos aparecem na seção; o histórico completo permanece no banco.

## Critérios do produto

O servidor determina tetos; o modelo escolhe a proposta dentro deles. Os percentuais abaixo são controles conservadores do produto, não uma fórmula universal de treinamento ou garantia de prevenção de lesões.

- **Dor ou doença:** dor no fechamento/diário da semana, doença ou situação atual de dor/retorno de lesão impede gerar cargas. A tarefa termina com orientação para avaliação. Esses casos são bloqueados antes de chamar o Gemini.
- **Dados insuficientes:** nenhum treino registrado, semana aberta/antiga ou menos de dois dias disponíveis impede gerar um bloco. A disponibilidade continua salva. Registros não confirmados como completos impedem progressão e levam a um teto reduzido.
- **Manter:** uma semana boa, sozinha, não autoriza progressão. A referência é o realizado, limitada também ao planejado disponível.
- **Reduzir:** fadiga alta, sono/disposição ruins, poucos treinos cumpridos, registros incompletos ou salto recente de volume/tempo/esforço reduzem o teto em 20% do realizado, sem obrigar o usuário a cumprir esse volume.
- **Avaliar aumento:** exige fechamento anterior com diário confirmado e boa recuperação, treinos em ambas as semanas, ao menos 80% das sessões atuais registradas, execução coerente com o planejado, sem esforço alto ou salto recente, e mais de 14 dias até o objetivo. O teto é de até 5% sobre o realizado, também limitado pelo planejado. O modelo pode manter ou reduzir.
- **Carga e tempo:** validação considera quilômetros, minutos, maior sessão, RPE e soma de minutos × RPE. A última é uma referência de carga percebida, sem interpretação clínica. Não se aumenta distância e intensidade livremente ao mesmo tempo.
- **Próximas semanas:** os tetos são iguais em todo o bloco proposto; não há aumento composto de 5% ou 15% por semana. Uma nova revisão depende dos próximos registros reais. As diretrizes posteriores continuam sujeitas a avaliação, inclusive recuperação/polimento perto da prova.

Metas de tempo funcionam com zero quilômetros registrados. Revisões podem cobrir menos de 14 dias quando o objetivo está próximo, sem liberar esse prazo curto para uma primeira geração comum. O consentimento e a validação de sessões permanecem obrigatórios. Uma proposta inválida não substitui o plano anterior.

## Persistência, fila e limites

`weekly_checkins` separa o fechamento do diário e preserva uma revisão por conta/plano/semana. Revisões por registro evitam sobrescrever alterações de outro aparelho. Depois de enfileirado, o fechamento fica congelado como evidência; correções no diário posteriores ao retrato não mudam retroativamente a resposta. É necessário considerar mudanças de saúde/rotina antes de adotar qualquer sugestão.

RLS limita leitura à conta. Gravações passam por funções invoker com implementação privilegiada em schema privado, validação de proprietário, plano ativo, semana e revisão. Não há permissão de escrita direta nos fechamentos. O schema privado permanece fora da Data API.

`ai_generation_jobs` recebe `kind=weekly_review`, o retrato e referência ao fechamento. O processador existente utiliza a mesma chave no Cloudflare, leases, retentativas e confirmação de conclusão. As revisões compartilham os limites existentes: **5 solicitações por conta/dia UTC, 20 tentativas globais/dia, 2 processamentos simultâneos e no máximo 2 tentativas por tarefa**. Não se abriu uma segunda franquia para IA. Se já há geração ativa, o fechamento aguarda vaga. Não há nova chamada Gemini quando o caso é bloqueado pelos critérios estruturados.

Cron, banco ou provedor indisponíveis atrasam a revisão. Uma semana que já expirou ou cujo plano mudou não gera automaticamente novos treinos. Histórico com mais de 100 registros em 28 dias ou payload acima dos limites é bloqueado, sem envio parcial silencioso ao modelo. O processamento não depende do navegador; não há notificações push nem prazo garantido de conclusão.

## Instalação e operação

Migração: `database/weekly-reviews.sql`, depois das migrações de banco/fila. O agendamento é criado pausado. Após publicar o consumidor:

```sql
update ai_private.weekly_settings set enabled=true where singleton;
```

Pausa de novas revisões semanais (tarefas já na fila continuam):

```sql
update ai_private.weekly_settings set enabled=false where singleton;
```

Monitoramento sem ler dados de saúde:

```sql
select count(*) filter(where job_id is null and report->>'consent'='true') as aguardando,
       count(*) filter(where queue_error is not null) as bloqueados
from public.weekly_checkins;
select kind,status,count(*) from public.ai_generation_jobs group by kind,status;
select status,return_message,start_time from cron.job_run_details
where jobid=(select jobid from cron.job where jobname='dez-voltas-weekly-reviews')
order by start_time desc limit 10;
```

## Verificação

`npm test`: cenários de manter/reduzir/progressão, dados incompletos, dores, doença, disponibilidade, esforço/carga, ausência de aumentos compostos, meta temporal, proximidade da prova, adoção/sincronização, autorização, worker da fila e troca de conta. Gemini e navegador são simulados. `checks/weekly-review.sql` verifica no banco, com rollback, semana elegível, concorrência por revisão, consentimento, congelamento, retrato do diário, idempotência da fila e isolamento de contas; executar com fila ociosa.

O teste de transporte em produção usa uma conta temporária e dor informada para confirmar cron → fila → worker → conclusão sem chamar Gemini. As contas temporárias são removidas depois. Não há geração faturável automática nem teste visual em navegador nesta entrega.

## Qualidade e tipos de sessão

Sessões novas têm etapas estruturadas. A revisão pode preservar qualidade comprovada pelos registros dentro de limites de dose/pico e recuperação; não libera intensidade só porque houve adesão. Sono/fadiga do fechamento substituem os dados antigos. Consulte [INTENSIDADE.md](INTENSIDADE.md).

## Comparação antes de adotar uma revisão semanal

O resultado inclui um quadro “O que muda no seu plano?” com volume de corrida, minutos, RPE médio previsto ponderado pela duração e quantidade de sessões. Exibe valores anterior/novo, diferença absoluta e percentual para volume/tempo/sessões; RPE é comparado em pontos, sem percentual. O maior valor fica verde e o menor vermelho; texto e setas também indicam a direção. Cores indicam magnitude, sem classificar uma redução como pior preparação.

O cálculo usa exclusivamente as datas detalhadas em comum com o plano de origem (`profile.review.sourcePlanId`) da mesma conta. Não compara a semana encerrada com semanas futuras nem transforma ausência de detalhamento em descanso. Há totais do período comum, detalhes por semana, aviso de comparação parcial e indicação dos dias excluídos. Sem fonte sincronizada ou sem datas em comum, explica a impossibilidade de calcular diferenças. Se o plano ativo mudou, identifica a revisão como antiga; se já foi adotada, mantém a comparação com a origem arquivada.

Calculado no aparelho a partir das sessões, sem chamadas adicionais ao Gemini ou alterações no banco. Não altera planos, diário ou critérios de carga. Adoção continua sendo uma escolha explícita. Cache v24 inclui `plan-comparison.js` para funcionamento offline.

Verificação: `checks/plan-comparison.mjs` cobre aumentos/reduções, datas comuns, semanas parciais, esforço ponderado, zeros/ausência, fonte de outra conta e histórico; `checks/profile-ui.mjs` verifica a presença antes do botão de adoção.
