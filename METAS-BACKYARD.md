# Meta backyard armazenada em quilômetros

O formulário continua perguntando o número inteiro de voltas, entre 1 e 48. Converte no próprio preenchimento usando 6,7056 km por volta e exibe a equivalência. Vinte voltas são armazenadas como `{"goal":"backyard","target":134.112,"targetUnit":"km"}`. Voltas são calculadas para a interface; não há um segundo valor de meta em voltas persistido no formato novo.

O servidor repete a validação, exige voltas completas e normaliza até quatro casas decimais. Objetivos de distância e tempo mantêm suas unidades anteriores. No pedido Gemini, `profile.target` e `objective.target` usam a distância total em km; a modalidade backyard, a extensão da volta e o intervalo de 60 minutos entre largadas são explícitos. Distância final não é uma recomendação de volume semanal. Esta alteração não relaxa os limites de treino.

## Compatibilidade

Cadastros e backups backyard sem `targetUnit` são reconhecidos como formato antigo em voltas e normalizados na leitura. Um objeto com `targetUnit:"km"` não é convertido novamente. Perfis novos, rascunhos validados, sugestões, arquivos locais e sincronização usam quilômetros. O preenchimento incompleto continua local e mantém o campo vazio ao mudar o objetivo.

O cálculo de identidade dos planos usa a representação semântica anterior para preservar os IDs existentes: não recria sessões nem perde seus vínculos com o diário. Na sincronização, a migração incrementa revisão e cursor por conta para propagar a correção. Conflitos de alterações pendentes continuam exigindo resolução normal.

O protocolo de treinos passa a `x-dv-training-format: 3`, com bloqueio de leitura/escrita incompatível nas rotas existentes; clientes antigos recebem atualização necessária em vez de interpretar quilômetros como voltas. Cache v32 inclui todos os arquivos alterados, sem acrescentar pacote ao PWA.

## Aplicação em produção

A migração foi criada pela CLI oficial em `supabase/migrations/20261104022208_backyard_goal_kilometers.sql`. Ela é somente de dados: não cria tabelas, funções ou permissões. Não executar `db push` indiscriminadamente neste repositório: o histórico das migrações SQL anteriores foi administrado separadamente em `database/`.

1. Registrar o estado anterior e pausar `ai_private.queue_settings.enabled` e `ai_private.weekly_settings.enabled`. Aguardar o término de qualquer tarefa `processing`. Não alterar contadores nem cotas.
2. Publicar API/PWA com suporte a quilômetros e aplicar esta migração antes de reativar a fila. A migração exige os dois agendadores pausados e nenhuma tarefa em processamento. Usar uma transação ao executá-la manualmente, como já faz o aplicador de migrações.
3. Conferir `training_plans.profile`, `runner_profiles.draft/form_profile` e perfis de pedidos/resultados/contextos em `ai_generation_jobs`: backyard com `targetUnit:"km"`. Conferir a meta de 20 voltas como 134,112 km, os IDs e os vínculos com o diário. A migração é idempotente.
4. Reativar somente os estados anteriormente habilitados. Falha na publicação ou migração exige manter a fila pausada até resolver ou reverter de forma coordenada.

Os backups legados congelados em `account_data` permanecem intactos e são convertidos pelo leitor quando necessários. Textos de planos já gerados permanecem históricos: um texto antigo que diz “20 km” não é reescrito nem considerado uma nova avaliação. É preciso uma nova geração/revisão com a meta corrigida para obter uma proposta atualizada; nenhum plano é adotado automaticamente.

## Verificação

`npm ci --ignore-scripts` instala a única dependência de desenvolvimento, PostgreSQL PGlite com versão fixada. Ela não participa da aplicação publicada. `npm test` inclui:

- Entrada em voltas, confirmação imediata em quilômetros, salvamento, reabertura e metas vazias.
- Conversão antiga, idempotência, precisão e extremos de 1/48 voltas, rejeição de unidades/metas inconsistentes.
- IDs antigos e sessões/diário preservados em arquivo e sincronização.
- Payload Gemini e revisão semanal em km, sem chamada real ao provedor.
- Execução do SQL real em PostgreSQL local em memória, com tabelas e FKs do repositório: pausa obrigatória, reversão transacional em falhas, avanço de revisão/cursor, tarefas antigas normalizadas e segunda execução sem alterações.

O teste de migração em produção com reversão foi rejeitado pela revisão automática de segurança. A validação foi concluída no banco local com dados fictícios; nenhuma migração foi aplicada ao banco real nesta preparação.
