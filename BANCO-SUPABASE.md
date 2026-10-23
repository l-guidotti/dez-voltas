# Banco de treinos e sincronização

O projeto utiliza Postgres/Supabase e o token do próprio usuário. Não requer service_role, MySQL ou novos Secrets no Cloudflare.

## Estrutura

| Tabela | Conteúdo |
|---|---|
| `runner_profiles` | Formulário, perfil e referência à última sugestão. Os campos variáveis do questionário ficam em JSONB. |
| `training_plans` | Metadados, fases, resumo das semanas, perfil usado na geração, modelo e indicador de adoção. Não contém arrays de sessões. |
| `training_sessions` | Uma linha por sessão: plano, semana, data, distância, duração, RPE, longo e instruções. |
| `diary_entries` | Uma linha por treino registrado: distância realizada, duração, esforço, dor, observações, data e última edição. |
| `training_preferences` | Plano ativo e checklist. |
| `training_sync_state` | Cursor de sincronização e controle da migração. Não armazena documento de conta. |

Todas têm RLS por `auth.uid()`, sem acesso de `anon`. Identificadores de plano/sessão e vínculos usam chaves compostas com `user_id`, impedindo referências entre contas. Cada registro tem revisão; índices atendem usuário, alterações incrementais, sessões de um plano e histórico por data. Exclusões do diário usam marcadores, permitindo que outros aparelhos recebam a remoção. Excluir o usuário Auth remove os dados via cascade. Planos e definições de sessões são mantidos como histórico; a interface não exclui a conta nesta entrega.

## Sincronização

`/api/account/sync?since=<cursor>` retorna alterações desde o cursor do aparelho. O primeiro acesso baixa as linhas da conta. O POST envia apenas as linhas alteradas, com a revisão esperada de cada uma. Não envia mais o documento completo a cada treino. O servidor valida a sessão, reconstrói/valida a preparação e o diário, e usa funções SECURITY INVOKER. A gravação do lote é atômica; revisões obsoletas causam conflito. O cursor avança sob bloqueio de uma linha de controle por usuário, evitando perder alterações concorrentes.

O cliente combina edições em treinos diferentes automaticamente. Alterações diferentes no mesmo registro ficam pendentes de escolha no Perfil. A escolha local/nuvem afeta somente os registros em conflito; outros dados são preservados. O usuário pode baixar a cópia de recuperação. A fila e a base conhecida ficam no cache local `dez-voltas-cloud-v2:<uid>`. Falhas de conexão, resposta perdida e edições durante o envio preservam mudanças locais. Reconectar, focar a janela ou aguardar um minuto tenta sincronizar novamente. O cronômetro em andamento não vai para o banco.

Perfil, preferências e cada plano também possuem revisão própria; alterações simultâneas em campos de um mesmo perfil ainda exigem escolha para esse perfil inteiro. Não há mesclagem automática por campo. A preparação continua limitada a 100 planos adotados e 3.000 registros locais pelo contrato atual. A consulta inicial carrega a conta inteira; paginação da interface e arquivamento de propostas antigas ficam para uma próxima etapa. A validação do servidor lê as linhas atuais antes de escrever; os índices e as atualizações incrementais evitam regravar todo o histórico, mas isso não representa um teste de carga.

## Migração e compatibilidade

`database/account-data.sql` registra o modelo inicial. `database/relational-training.sql` cria o modelo separado. `database/freeze-legacy.sql` impede novas escritas no documento antigo. Os dados existentes foram convertidos e a reconstrução foi comparada com os originais. `account_data` permanece como cópia de recuperação, sem acompanhar novas alterações. Novas contas são inicializadas automaticamente; inicialização é idempotente, compara a revisão do documento antigo e nunca substitui um armazenamento já migrado.

O endpoint antigo `/api/account/data` retorna HTTP 426, pedindo atualização, para não permitir divergência de dados. A PWA usa cache v12. Caches v1 limpos carregam os dados migrados. Edições offline pendentes no formato antigo são preservadas; se não houver uma base confiável para compará-las, a interface pede escolha antes de sobrescrever registros existentes. Não apague os dados do navegador para atualizar.

A sessão ainda expira em até uma hora: entre novamente para continuar enviando dados. Renovação automática não faz parte desta mudança. Backups JSON e CSV continuam funcionando. O cache local não possui criptografia própria; alterações offline ainda não enviadas dependem do armazenamento do dispositivo.

## Validação

`npm test` cobre ida e volta documento/tabelas, migração de cache, atualização de um único treino, combinação de treinos distintos, conflito no mesmo treino, exclusão/recriação, offline, edições em voo, resposta perdida, isolamento por conta e API autenticada. Testes SQL reais com rollback confirmaram escrita do dono, bloqueio de `anon` e de outro usuário, proibição de transferir o dono e rejeição de revisão obsoleta. A migração real preservou todos os perfis, planos e registros existentes. Advisors não apontaram problemas de RLS ou chaves estrangeiras sem índice nas novas tabelas. Os índices recém-criados ainda podem aparecer como não utilizados até acumularem uso.

Depois de atualizar a PWA, entre na conta, aguarde **Sincronizado com sua conta** e confira Plano e Diário em outro navegador. A entrega não inclui um teste real de interface em dois dispositivos nem um teste de carga.
