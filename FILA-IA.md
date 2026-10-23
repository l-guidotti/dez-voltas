# Geração de planos em segundo plano

A solicitação é persistida no Supabase antes de responder HTTP 202. O navegador acompanha o andamento; não executa nem mantém viva a geração. `pg_cron` verifica a fila a cada minuto e `pg_net` chama o processador em Pages Functions. A chave Gemini continua somente no Cloudflare. Não há novo pacote, Worker pago ou serviço de filas para contratar.

## Estados e experiência

`queued → processing → completed`, com `retrying` para falhas temporárias e `failed` para falhas definitivas. Fechar o PWA, sair da tela ou desconectar a conta não cancela a tarefa. O resultado é salvo em `ai_generation_jobs.result` e recuperado ao entrar novamente, inclusive em outro aparelho. As últimas dez solicitações ficam disponíveis para consulta na interface, com acesso às sugestões concluídas. O histórico no banco permanece até a exclusão da conta.

O acompanhamento aparece em Minha conta. A consulta ocorre a cada seis segundos durante a geração e a cada minuto sem tarefa ativa, somente com o app visível; foco/reconexão também atualizam. Consultas de status não transferem o plano inteiro. O resultado exige revisão e o botão **Usar este plano**; nenhum job troca automaticamente o calendário, o perfil ou o diário. O formulário pode ser editado durante a espera; a geração utiliza o retrato enviado na solicitação.

## Limites iniciais e controle de custos

- 5 solicitações admitidas por conta/dia UTC, incluindo falhas; apenas uma tarefa ativa por conta.
- Até 20 tentativas globais por dia UTC, incluindo retentativas e recuperações de processamento interrompido. Reserva atômica antes de chamar o Gemini; falhas não devolvem essa reserva.
- Até 2 processamentos simultâneos e 100 tarefas ativas no total. Fila cheia rejeita novas solicitações sem chamar o modelo.
- Até 2 tentativas por tarefa. HTTP 429/5xx e falhas de rede/tempo permitem uma retentativa após pelo menos dois minutos. Perfil inválido, HTTP 400/401/403/404 e resposta inválida/incompleta encerram a tarefa.
- Modelo escolhido apenas no servidor; formulário até 12 KB, payload Gemini até 60 KB e `maxOutputTokens: 12000` por tentativa. Tokens informados pelo provedor, inclusive raciocínio, são registrados mesmo quando a resposta não passa na validação. Em falha de rede/interrupção, o consumo real pode ser desconhecido; a tentativa continua contabilizada.
- Sem orçamento diário disponível, a tarefa aguarda a próxima meia-noite UTC. Após dois dias de espera, é encerrada. Se as datas do cadastro deixarem de ser válidas, o processador pede atualização e não muda as datas sozinho.

Esses limites contêm o volume de chamadas; não representam um teto em reais/dólares. Preços variam por modelo, tokens e plano Google. Cotas do provedor e acompanhamento de faturamento continuam necessários; alertas de orçamento não bloqueiam gastos. Não foi ativado faturamento nem contratado um plano nesta implementação.

O banco serializa a admissão e reserva de tentativas, sem depender da consistência eventual do KV. KV continua somente nos limites de login e diagnóstico.

## Persistência e proteção

`ai_generation_jobs` guarda perfil enviado, estados, tentativas e resultado. RLS e permissões de coluna permitem a cada usuário ler somente seus próprios resultados. Usuários não alteram estados, resultados, leases ou contadores diretamente. A fila não participa da sincronização editável de documentos/treinos.

As implementações privilegiadas ficam em `ai_private`; as funções públicas são invoker. Enfileirar exige `auth.uid()` e conta confirmada. Claim/finish exigem uma capacidade aleatória de 256 bits mantida no Vault. Finalizar exige também o identificador e o lease correto, ainda válido. O lease dura três minutos; o agendador recupera tarefas interrompidas. Confirmações antigas/duplicadas não sobrescrevem o resultado. Sem transação distribuída com o Google, uma interrupção depois da resposta pode repetir a chamada; o máximo de duas tentativas limita essa ocorrência.

**Mantenha apenas os schemas necessários expostos na Data API.** `net`, `vault` e `ai_private` não podem ser expostos. No Supabase, as permissões de `pg_net` são controladas pela plataforma: roles com conexão SQL podem ler os cabeçalhos enquanto aguardam envio. Por isso, acesso direto ao banco é restrito a serviços confiáveis; a capacidade do dispatcher concede somente claim/finish desta fila e não é uma chave service_role. Os schemas expostos foram conferidos em produção: `public`, `graphql_public`. Referência: https://supabase.com/docs/guides/troubleshooting/database-roles-can-read-request-headers-queued-by-pg_net-ad6357

Prompts, resultados, cookies e capacidades não são escritos em logs pela aplicação. O processador retorna somente `processed/saved`, sem perfil, resultado ou chave. O Gemini recebe apenas o perfil validado autorizado, sem e-mail ou ID da conta.

## Instalação e operação

Migrações aplicadas no Supabase, nesta ordem: `database/ai-queue.sql` e `database/ai-queue-boundaries.sql`. A criação começa pausada. Depois de publicar e verificar o processador:

```sql
update ai_private.queue_settings set enabled=true where singleton;
```

Pausa segura (não apaga tarefas):

```sql
update ai_private.queue_settings set enabled=false where singleton;
```

Ajustar os limites globais exige decisão explícita de capacidade/custos. Exemplo para consultar configuração e consumo sem expor perfis:

```sql
select * from ai_private.queue_settings;
select * from ai_private.daily_usage order by day desc limit 30;
select status,count(*),min(created_at) as oldest from public.ai_generation_jobs group by status;
select status,return_message,start_time,end_time from cron.job_run_details
where jobid=(select jobid from cron.job where jobname='dez-voltas-ai-queue')
order by start_time desc limit 10;
select status_code,timed_out,error_msg,created from net._http_response
order by created desc limit 10;
```

Cron bem-sucedido confirma o disparo SQL, não o resultado HTTP: confira também `net._http_response` e a idade/estado dos jobs. Projetos Supabase pausados e indisponibilidades do Cloudflare interrompem o processamento até o serviço voltar; não há garantia de tempo de conclusão. O agendamento só faz chamadas HTTP quando há trabalho elegível/lease vencido.

## Verificação

`npm test` inclui contrato/API/fluxo da fila com provedor simulado, proteção do runner, limites, recuperação de resultado, logout durante consulta e confirmação perdida. `checks/ai-queue.sql` executa assertions transacionais com rollback: idempotência, RLS entre contas, cota diária, reserva global, concorrência, leases e retentativas. Não chama Gemini nem altera contas reais. Verificação de transporte em produção usa um perfil de teste inválido, rejeitado antes de chamar o modelo. Não há nova geração faturável usada como teste automático.
