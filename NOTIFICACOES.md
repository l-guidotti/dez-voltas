# Lembretes por Web Push

Configuração em Minha conta → Lembretes no celular, depois de concluir o cadastro. Opt-in explícito por aparelho, com avisos de treino e check-in diário independentes e horários editáveis (padrões 07:00 e 20:00). A permissão do navegador é solicitada somente pela ação do usuário. Sair da conta, revogar a permissão ou desativar o aparelho cancela a assinatura local; o logout também tenta remover o vínculo no servidor. Uma ativação em voo é invalidada quando a conta muda ou ocorre logout.

No iPhone/iPad, requer iOS/iPadOS 16.4+ e PWA adicionado à Tela de Início, aberto pelo ícone instalado. Safari em aba normal não recebe a mesma habilitação. Navegadores com Web Push compatível podem funcionar sem instalação. Horários são aproximados, sujeitos à rede, foco/modo de concentração, permissões e políticas do sistema. O botão de teste confirma o enfileiramento, não a exibição no aparelho.

## Critérios de envio

O cron avalia os lembretes a cada cinco minutos. Usa o fuso salvo para os horários e o dia de referência de Hoje/diário do PWA (America/Sao_Paulo). Há uma janela de 30 minutos após o horário, e alterações/ativações só valem para horários futuros. Uma notificação de cada tipo por aparelho e dia, com índice único no banco.

Treino: somente com sessão pendente no plano ativo para o dia. Registro de todas as sessões evita o aviso. Dor/doença atual no check-in diário ou situação de dor/retorno registrada no perfil impede incentivo para treinar. Check-in: somente se ainda não existe registro diário naquela data, inclusive em dias sem corrida ou sem plano adotado. As condições são verificadas novamente na retirada da fila. Não há uso do Gemini para estes avisos.

A fila tem leases de dois minutos, até duas tentativas, repetição transitória após cinco minutos, TTL de 15 minutos no provedor e expiração do job em 30 minutos. HTTP 404/410 desabilita a assinatura vencida. Há um limite inicial independente de 200 tentativas de push/dia UTC, até dois envios simultâneos, cinco aparelhos ativos por conta e cinco testes por conta/dia UTC (preservado ao apagar/reativar um aparelho). Metadados de entregas são mantidos por 30 dias. O uso da API Gemini e seus limites não são alterados.

## Proteção e criptografia

Assinaturas ficam em `push_devices`, com RLS por conta e acesso de leitura a colunas de metadados; endpoints/chaves de assinatura não são devolvidos pelo endpoint de preferências nem liberados em SELECT direto ao cliente. Gravações e exclusões usam RPCs com UID verificado. Configuração, orçamento e fila ficam em `ai_private`, fora da Data API.

A chave VAPID é gerada pelo worker com WebCrypto e guardada no Supabase Vault. O cliente recebe apenas a chave pública. O bootstrap não rotaciona uma chave já existente. Os endpoints internos usam a capacidade aleatória já guardada no Vault para o dispatcher; ela nunca é devolvida ao cliente. O mesmo cuidado existente com acesso SQL confiável a `net`/Vault continua necessário.

Web Push nativo: cifragem aes128gcm conforme RFC 8291 e autenticação VAPID ES256 conforme RFC 8292, sem SDK ou serviço comercial adicional. A cifragem é verificada contra o vetor oficial do Apêndice A. Só são aceitos endpoints HTTPS de Apple, Google, Mozilla e Windows Push; redirecionamentos são recusados. URLs, credenciais, chaves privadas e corpos de erro do provedor não são registrados nos logs da aplicação.

As notificações têm título e texto genéricos definidos pelo service worker, sem detalhes do plano, dados de saúde ou observações. O clique abre somente Hoje ou Minha conta na própria origem; URLs de payload não podem redirecionar para outro site. São exibidas como notificações visíveis, sem uso de push silencioso.

## Implantação

1. Aplicar `database/push-reminders.sql` (serviço inicialmente desativado, sem assinantes). Pode ser aplicado em transações por grupo de funções caso o cliente SQL limite o tamanho da requisição; manter CREATE/REVOKE/GRANT juntos.
2. Publicar worker e PWA v27.
3. Executar `database/push-reminders-bootstrap.sql`: invoca o endpoint privado que gera e grava a chave sem expor o material.
4. Confirmar apenas os indicadores `public_key is not null` / `private_key_id is not null`; não consultar valores privados.
5. Executar `database/push-reminders-activate.sql` para ativar o serviço e o cron. Isso não inscreve ninguém automaticamente.

## Verificação

`npm test`: vetor RFC, assinatura VAPID, validação de endpoints/horários, autenticação/origem, bootstrap idempotente, cancelamento de ativação após logout e conteúdo/clique seguros do service worker. `checks/push-reminders.sql` e `checks/push-limits.sql` usam fixtures com rollback para isolamento, conclusão de registros, sintomas, duplicação e limites; requisições pg_net dos testes não são commitadas. O navegador móvel simula o PushManager para testar ativação/teste/desativação, sem enviar notificações reais. Entrega real em Safari/iPhone deve ser conferida no aparelho pelo usuário após instalar e permitir as notificações.

Referências: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ · https://www.rfc-editor.org/rfc/rfc8291 · https://www.rfc-editor.org/rfc/rfc8292 · https://supabase.com/docs/guides/functions/schedule-functions

## Ativação no iPhone (v29)

O service worker é preparado antes de habilitar o botão. O toque chama `pushManager.subscribe` diretamente, sem aguardar `Notification.requestPermission`, `serviceWorker.ready` ou `getSubscription` antes: o próprio subscribe solicita a permissão nativa, mantendo a ação ligada ao gesto do usuário. A tela mostra autorização/conexão e gravação na conta, desabilita ações concorrentes e termina com sucesso ou erro. A assinatura tem espera máxima de 45 segundos; consulta/preparação do service worker também têm limites. Uma resposta posterior ao limite não grava silenciosamente no servidor. Falhas de permissão indicam Ajustes → Notificações e abertura pelo ícone instalado. Não se pede permissão automaticamente ao abrir o app.

Testes simulam uma inscrição que só pode começar dentro do gesto, sucesso, ausência de worker, autorização atrasada após logout e espera expirada. O teste de Chromium móvel continua usando serviço simulado. A entrega real depende de confirmação no iPhone; o estado “Teste na fila” não confirma entrega.

## Instalação no Cloudflare Pages (v30)

O Pages redireciona `/index.html` para `/`. O cache inicial inclui apenas a URL canônica `/`: colocar também `/index.html` e rejeitar respostas redirecionadas abortava a instalação do service worker, deixando `ready` pendente e impedindo o push. O cache possui agora 28 recursos. Mantemos a rejeição de redirecionamentos inesperados para os demais recursos. A navegação offline tanto de `/` quanto de `/index.html` continua usando o HTML canônico.

O teste de regressão recusa qualquer tentativa de cachear o alias. O servidor do teste Chromium reproduz o 308 do Cloudflare e exige um worker ativo antes da ativação de push. Falha na preparação passa a oferecer “Tentar preparar notificações novamente”, sem apagar dados ou pedir permissão automaticamente.
