# Laboratório de revisão semanal

O laboratório usa um perfil inteiramente fictício, três corridas de 5 km / 35 minutos / RPE 3, registros diários e um fechamento. Reutiliza `prepareWeeklyReview`, o prompt, o modelo configurado e o validador da aplicação. Não adota planos nem grava diário. Os relatórios ficam em `artifacts/weekly-review/`, fora do PWA e ignorados pelo Git.

Prévia visual sem chamada à API:

```sh
node scripts/weekly-review-lab.mjs hold
```

Teste real, com `GEMINI_API_KEY` e `GEMINI_MODEL` configurados no ambiente do processo:

```sh
node scripts/weekly-review-lab.mjs --live hold
```

Cada execução faz no máximo uma chamada Gemini, com consumo da cota do projeto Google. O comando direto não passa pela fila/cotas da aplicação: é uma ferramenta local de desenvolvimento, sem endpoint público. Não configure a chave no HTML, JSON, código ou linha de comando. `reduce` testa fadiga alta; `pain` confirma bloqueio antes da chamada. Não há repetição automática de uma resposta inválida.

O HTML apresenta entrada, decisão e limites do servidor, estado, consumo, sessões aceitas e JSON completo. No modo direto, captura a resposta bruta antes da validação, inclusive se ela falhar, sem registrar cabeçalhos de autorização ou a chave da API. Registros de saída do modelo são dados, nunca instruções executáveis.

Para conferir o consumidor publicado sem acesso local à chave, uma conta temporária pode receber uma tarefa fictícia via admissão interna da fila, preservando seus limites. O contexto é injetado por diagnóstico: este modo testa dispatcher/consumidor/Gemini/persistência, não o formulário nem a criação do fechamento pelo cron semanal. Salve exclusivamente a tarefa dessa conta, junto de seu fixture, no formato `{fixture,job}`, e importe:

```sh
node scripts/weekly-review-lab.mjs --result artifacts/weekly-review/published-result.json
```

O consumidor publicado guarda resultado validado ou erro; ele não preserva respostas brutas rejeitadas. O relatório identifica essa limitação. Após salvar o resultado, remova somente a conta temporária identificada, que apaga sua tarefa por cascata. Não altere contadores de cota nem tarefas reais. Este teste não requer publicar ou migrar o PWA.

Verificação automatizada: `node checks/weekly-lab.mjs` usa provedor simulado e não consome Gemini.

## Testar o cron semanal publicado

`node scripts/weekly-scheduler-lab.mjs` emite um fixture e SQL transacional para uma conta temporária identificada por UUID e e-mail `example.invalid`. O SQL cria plano ativo, sessões, diário e recuperação fictícios; depois chama `save_weekly_review` com a role autenticada. Ele não insere tarefas nem chama o enfileirador. A semana fica encerrada em relação ao relógio atual. Aplicar esse SQL no projeto exige acesso de operação ao banco.

Após o commit, aguarde o próprio `dez-voltas-weekly-reviews` criar a tarefa e o `dez-voltas-ai-queue` acionar o consumidor. Registre `weekly_checkins.created_at`, a referência `job_id`, `ai_generation_jobs.created_at`, estado, contexto, resultado, tokens e as execuções correspondentes em `cron.job_run_details`. Consulte novamente depois de outro tick para confirmar que só há uma tarefa. Não altere o relógio, as agendas, o consentimento ou os contadores globais.

Para gerar o relatório, salve `{fixture,job,mode:"agendamento publicado",schedulerEvidence:{checkin,jobCount,cronRuns}}` em um JSON local e execute `--result caminho.json --out artifacts/weekly-scheduler-fiction`. Esse modo documenta o fluxo fechamento → cron semanal → fila → consumidor → Gemini. Não exercita o formulário no navegador nem observa a transição real pela meia-noite: a elegibilidade é simulada por uma semana já encerrada.

Uma cópia de registros reais exige identificação e autorização do usuário para os dados e seu envio ao Gemini. Use a semana encerrada do plano ativo e um fechamento já preenchido; não invente recuperação, dor, disponibilidade ou consentimento. Copie somente o intervalo necessário para outra conta temporária, remapeando IDs de plano e sessões. Nunca reenvie o fechamento da conta original nem altere seu plano. O fixture do relatório deve incluir `dataKind:"authorized-copy"`, e seus arquivos devem continuar fora do Git. Depois de preservar os relatórios, exclua somente as contas temporárias identificadas e confirme a remoção das tarefas por cascata.

## Experimento sem teto semanal de distância

O consumidor reconhece `context.diagnostic.mode="without-weekly-distance-ceiling"` somente em tarefas `weekly_review`. Esse contexto é escrito por operação interna no banco; o formulário e o enfileirador público não permitem defini-lo. Não existe endpoint público novo nem remoção global dos limites.

O pedido experimental omite `profile.review.maxWeeklyKm`, `weeklyReview.limits.maxWeeklyKm` e `calendar.weeklyKmCeiling`, e retira a instrução que impunha o teto semanal inicial. Mantém disponibilidade, calendário e limites de sessão, duração, RPE e carga. A conferência posterior deixa de usar o teto de revisão de 15 km, usando apenas o máximo estrutural de 200 km do contrato. O texto retornado é preservado mesmo quando a conferência falha ou a resposta está incompleta. Partes de raciocínio e credenciais não são armazenadas.

O resultado tem `plan:null` e `diagnostic.adoptable:false`; o diagnóstico contém o pedido, o texto do Gemini, a proposta e o resultado da conferência. Não é uma sugestão adotável. Ele compartilha a fila, a contabilização de tokens, as cotas e o limite de tentativas existentes. Normalmente gera-se uma única tarefa em conta temporária, sem sessões ou diário ativos para adotar; após recuperar a resposta, essa conta é removida.

Salve `{job,experiment}` em um arquivo privado e execute `node scripts/render-distance-experiment.mjs caminho/source-result.json` para mostrar a avaliação, viabilidade, semanas, sessões, instruções e texto integral do Gemini. Todos os campos do modelo são tratados como dados escapados no relatório. Os arquivos continuam em `artifacts/`, fora do Git.
