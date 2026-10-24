# Recuperação diária

A seção Hoje oferece um check-in opcional, independente de haver corrida ou plano adotado. Uma conta com cadastro concluído, inclusive sem geração liberada por dor, pode registrar sua recuperação.

Campos: disposição, fadiga e sono de 1 a 5; dor (nenhuma/leve/interferiu nas atividades); local opcional; doença; observação até 500 caracteres. Também aceita uma atividade principal fora das corridas já registradas (força, caminhada, bicicleta, natação ou outra), com minutos e RPE. Outras atividades podem ser descritas na observação. O app mostra as corridas registradas no dia e não as duplica como atividade adicional. Atividades extras não são convertidas em quilômetros de corrida.

## Armazenamento e sincronização

`daily_recovery` é uma tabela separada, com chave `(user_id, day)`, RLS por `auth.uid()`, leitura própria e gravação exclusivamente por RPC. Usuários não recebem privilégios de escrita direta. Implementações privilegiadas ficam em `ai_private`; funções públicas são invoker, com `search_path` fixo e acesso mínimo. Não há novas chaves.

Cada data tem uma revisão e um UUID de mutação: repetição após perda da resposta não duplica o registro. Edições em outro aparelho geram conflito explícito, com escolhas para conservar a cópia da conta ou a local. Edições feitas durante um envio aguardam a confirmação desse envio antes de serem transmitidas, evitando perda ou sobrescrita silenciosa.

O cache, o rascunho e a fila de saída são separados por conta em `dez-voltas-recovery-v1:<id>`. O formulário parcial é preservado no aparelho; apenas salvar registra o dia. Sem rede, o registro fica pendente e é enviado na reconexão/foco/consulta periódica. A edição não é substituída por atualizações em segundo plano. Podem ser editados hoje e os 27 dias anteriores, no fuso America/Sao_Paulo. O banco conserva o histórico até exclusão da conta; o endpoint retorna os últimos 28 dias e o cache mantém até 60 dias reconhecidos. O backup antigo de planos/treinos não inclui estes novos registros; a cópia na conta é independente.

## Revisão semanal e consentimento

Salvar um check-in não chama o Gemini nem consome a cota de geração. O fechamento semanal passa a mostrar um resumo dos dias sincronizados. Antes de salvar o fechamento, sincroniza a fila diária e exige resolução de conflitos.

A autorização semanal agora menciona os registros diários e as atividades extras e envia `recoveryConsent: true`. Sem esse campo autorizado, inclusive em fechamentos de clientes antigos, o agendador não copia os dados diários para o contexto Gemini. A autorização pode ser recusada: o fechamento é salvo sem enfileirar revisão.

O agendador captura até 28 dias da mesma conta, somente depois da semana encerrada. Notas/local da dor de semanas anteriores são omitidos. O retrato é congelado no contexto do job; edições posteriores não reescrevem uma revisão já enfileirada. Perfil, diário de corrida e regras anteriores continuam compondo a avaliação.

Regras de prudência desta versão, sem pretensão de validação clínica:

- Com uso diário autorizado, avaliar progressão exige pelo menos quatro dias favoráveis registrados em cada uma das duas últimas semanas, além dos critérios de corrida e fechamento já existentes. Ausência não prova recuperação; preencher não garante aumento.
- Dois ou mais dias na semana com fadiga alta, sono ruim ou disposição baixa orientam redução. Um sinal isolado ou uma atividade extra exigente pode impedir aumento sem impor redução automaticamente.
- Atividade extra com RPE >=7 e pelo menos 45 minutos, ou RPE >=5 e pelo menos 90 minutos, impede progressão naquele fechamento. Não se soma essa carga aos quilômetros de corrida.
- Dor ou doença registrada na semana impede gerar novas cargas. O último check-in salvo dos últimos sete dias também é consultado pelo worker antes da geração inicial/semanal. Uma atualização sem sintomas substitui o alerta atual, mas não elimina os sintomas históricos da semana.
- O cliente também verifica alertas locais antes de solicitar/adotar novas cargas. Isso não é uma prescrição de reabilitação nem uma liberação médica.

## Instalação

1. Aplicar `database/daily-recovery.sql` em transação. Não altera os dados/tabelas de treinos existentes.
2. Publicar o worker e a PWA atualizados.
3. Aplicar `database/daily-recovery-activate.sql`: muda o claim para consultar o alerta e acrescenta o snapshot ao agendador já existente, conservando suas regras de intensidade. Não muda o horário do cron ou os limites de geração.
4. Executar `checks/recovery.sql` (fixtures com rollback), verificações de segurança e teste do snapshot do agendador com rollback. Nenhum teste do banco despacha jobs nem chama o Gemini real.

`npm test` inclui validação de campos, consentimento, decisões semanais, offline, reabertura, resposta perdida, edição em voo, conflito, isolamento e API. `checks/profile-draft-browser.mjs` cobre o formulário real em Chromium móvel, sem plano/treino, preservação de foco, salvamento offline, reconexão e rascunho após recarga. Cache v25 inclui os três módulos novos. Testes locais usam provedores simulados; conferir Safari/PWA no iPhone no piloto.
