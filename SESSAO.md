# Login persistente e renovação

Google e link por e-mail continuam usando Supabase/PKCE. O callback conserva o par de tokens em cookies `__Host-dv-access` e `__Host-dv-refresh`, ambos HttpOnly, Secure, SameSite=Lax e Path=/. Tokens não são devolvidos em JSON, salvos em localStorage ou enviados por BroadcastChannel. A chave publishable já configurada no Cloudflare é suficiente; não há nova chave ou alteração do banco.

O acesso continua curto, limitado a uma hora pelo cookie. O refresh token é rotacionado via `/api/auth/refresh`, que verifica a origem e só responde com usuário e metadados da sessão. O cookie de renovação tem duração de 30 dias, atualizada a cada renovação. As políticas e revogações do Supabase prevalecem. Não aumentamos a duração do JWT para simular persistência.

`dist/session-client.js` agenda uma verificação antes de expirar, retoma ao focar, recuperar conexão ou voltar a ficar visível. Uma resposta 401 em uma operação autenticada dispara renovação e repetição uma única vez. Login, callback e envio de e-mail não são repetidos automaticamente. A sincronização mantém a fila local e as revisões por registro, inclusive se uma gravação tiver ocorrido antes de uma falha na resposta. Falhas temporárias não apagam cookies nem dados locais. Se o refresh for revogado ou inválido, a interface pede nova entrada, preservando o cache da conta.

Uma promessa compartilhada evita renovações simultâneas na mesma aba. Web Locks coordena abas quando disponível; navegadores sem esse recurso usam uma fila por aba e a tolerância padrão de reutilização do Supabase. BroadcastChannel informa saída e troca de conta a outras abas do mesmo armazenamento. Safari e PWA instaladas podem usar armazenamentos separados; não é garantido que compartilhem a sessão.

A saída usa o mesmo bloqueio da renovação, cancela o agendamento, revoga a sessão local no Supabase quando possível e remove os cookies. Se o serviço remoto não responder, os cookies ainda são removidos, mas a revogação remota não é garantida. Sair neste navegador não encerra intencionalmente sessões de outros dispositivos. A API compara `x-account-id` com o usuário verificado antes de processar sincronização ou geração, impedindo que uma aba antiga grave na conta recém-aberta em outra aba.

**Migração:** sessões anteriores não conservaram o refresh token. Depois de atualizar para cache v15, saia e entre uma vez para ativar a renovação. Isso não remove o perfil, planos nem a fila de treinos.

`npm test` cobre cookies/rotação, metadados sem tokens, origem, erro temporário, revogação, sessão sem acesso mas com refresh, saída, chamadas simultâneas, coordenação de abas, renovação agendada, offline, repetição limitada e saída concorrente com renovação. Os provedores são simulados; a manutenção real de uma sessão ao longo de uma hora e o comportamento Safari/PWA devem ser conferidos no dispositivo após uma nova entrada.

Referências: https://supabase.com/docs/guides/auth/sessions e https://supabase.com/docs/guides/troubleshooting/should-i-set-a-shorter-max-age-parameter-on-the-cookies-8sbF4V

## Preenchimento do cadastro no celular

A sincronização chama `account-data-loaded` a cada atualização, inclusive ao focar a janela e na verificação periódica. Antes, `load()` descartava o formulário em memória e restaurava apenas perfis completos e validados; respostas de um cadastro parcial desapareciam.

O formulário agora preserva uma edição local por conta em `dez-voltas-profile-edit-v1:<id>`, inclusive antes de preencher os campos obrigatórios. Essa edição parcial não entra no documento sincronizado. Perfis completos continuam usando a sincronização existente. A edição local prevalece durante o preenchimento e na reabertura, e é removida ao concluir/salvar o perfil ou enviar um perfil validado para geração. Sair mantém a cópia para a mesma conta; outra conta não a recebe. Se o armazenamento falhar, o app avisa e conserva a edição em memória.

Atualizações de nuvem e da fila não substituem o formulário de uma conta durante sua edição. Mudanças explícitas de objetivo/dias e ações do usuário mantêm os valores restantes e restauram o foco. Trocar o tipo de objetivo limpa apenas a meta numérica, que passa a ter outra unidade.

`npm test` inclui a regressão de sincronização, recarga, objetivo/dias, conclusão, isolamento e dados locais inválidos. `node checks/profile-draft-browser.mjs` executa o app real em Chromium com tela móvel de 390×844 e APIs locais simuladas: sincronização sem substituir o campo/cursor/rolagem, foco/visibilidade/conexão, recarga, navegação, conclusão, saída e reentrada em outra conta. Requer Chromium (`CHROME_BIN` opcional), Node 22+ e permissão de rede local. Não usa contas reais nem chama Gemini. O teste em Chromium não substitui a conferência em Safari/PWA no iPhone. Cache atualizado para v20.
