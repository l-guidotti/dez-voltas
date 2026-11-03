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
