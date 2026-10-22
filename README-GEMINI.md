# Objetivo pessoal e sugestões com Gemini

Código preparado para Cloudflare Pages. Não está publicado nem conectado a contas externas. Nenhum banco de treinos foi criado.

## Fluxo implementado

- Link de acesso por e-mail com Supabase Auth, PKCE e cookie de sessão HttpOnly, Secure, SameSite=Lax. O primeiro acesso confirmado cria a identidade no provedor. Não existe senha no PWA.
- Formulário de meta por distância, duração ou voltas backyard; início/data-alvo; média semanal e longo das últimas quatro semanas; consistência, dias/tempos disponíveis e situação de dores.
- Autorização explícita para enviar os dados de treino ao Gemini. E-mail e identificador de conta não são enviados ao modelo.
- Gemini gera fases contíguas para toda a preparação, e até 28 dias de sessões detalhadas. O restante é uma orientação a revisar conforme os treinos realizados.
- Validação no servidor: esquema, datas, dias disponíveis, tempos, totais, longo e limites conservadores de carga inicial. Esses limites são regras do produto, não uma fórmula universal de prevenção de lesões. Dor/retorno de lesão solicita revisão profissional antes de gerar cargas.
- Sugestão fica em revisão e pode ser salva localmente por ID de usuário e baixada em JSON. O plano original, registros, cronômetro e Zepp foram preservados. O botão Usar este plano atualiza Plano, Hoje, sessões para registro e exportação de agenda. Os registros de planos anteriores são preservados.

## Configuração necessária

1. Em um projeto Supabase, habilite Email e Magic Link. O Supabase é usado SOMENTE para autenticação; suas contas são armazenadas pelo provedor. Não usamos seu banco para treinos. Isso adiciona um serviço externo com seus próprios termos e limites.
2. Cadastre como Site URL o domínio HTTPS definitivo da PWA e permita exatamente o redirect `https://SEU-DOMINIO/?auth=callback`. Mantenha o template Magic Link com `{{ .ConfirmationURL }}`; não substitua por OTP. O fluxo usa `/otp` com `code_challenge_method=s256` e troca o código no servidor.
3. Configure SMTP no Supabase para usuários reais. O envio padrão possui restrições e não é uma solução de produção para qualquer destinatário. SMTP/domínio/remetente podem ter custos do fornecedor.
4. Como este projeto usa `wrangler.jsonc`, configure nele `vars.APP_ORIGIN` com a origem exata (sem barra final), `vars.SUPABASE_URL` e `vars.GEMINI_MODEL` com um modelo disponível na sua conta compatível com generateContent e JSON Schema. Cadastre `SUPABASE_ANON_KEY` (publishable/anon; NUNCA service_role) e `GEMINI_API_KEY` como segredos no Pages, pelo painel ou `wrangler pages secret put NOME --project-name dez-voltas`. Não exponha a chave Gemini em `dist`, Git, ZIP, localStorage ou no formulário. O arquivo Wrangler é a fonte de configuração: não dependa de editar no painel os campos controlados por ele.
5. Crie um namespace KV e declare `kv_namespaces: [{"binding":"AI_USAGE","id":"ID_REAL_DO_NAMESPACE"}]` no arquivo `wrangler.jsonc`. Para previews, use um namespace separado e configure explicitamente todas as variáveis e bindings necessários em `env.preview`, incluindo `APP_ORIGIN` correspondente; não reutilize a configuração de produção sem ajuste. Guarda somente contadores temporários com chaves derivadas por SHA-256. Sem o binding, as solicitações de link e geração ficam desabilitadas. Não é um banco de perfis/treinos.
6. A cota inicial é 5 tentativas de geração/dia/usuário e 3 links/hora/e-mail, mais 6 links/hora/IP. KV tem consistência eventual e leitura/gravação não atômica: isso reduz abuso, mas não é um teto financeiro exato. Configure cotas no Google Cloud e acompanhe consumo; alertas de orçamento não bloqueiam gastos automaticamente. Modelos, tokens e plano do Gemini têm preços/limites próprios.
7. Antes de enviar dados reais, verifique o tratamento de dados previsto nos termos do plano Gemini escolhido. A interface pede consentimento; não transfere nome/e-mail ao modelo. Não registramos prompts, credenciais ou respostas em logs do servidor.

As variáveis devem existir no servidor (Pages Functions), nunca injetadas no JavaScript público. Ambiente sem configuração retorna mensagens de indisponibilidade em vez de fabricar planos ou contas.

## Publicação

Esta versão usa `functions/`. Faça deploy com Wrangler a partir da raiz do projeto, incluindo `functions`, `server` e `dist`. O upload de apenas `dist` pelo painel NÃO inclui a API.

```sh
npm test
npx wrangler@4 pages deploy dist --project-name dez-voltas --branch main
```

Configure os bindings/segredos no painel antes e confirme a proteção de acesso. O projeto continua contendo o plano pessoal original; preserve a restrição Cloudflare Access enquanto ele estiver no pacote. A autenticação de novas contas não torna automaticamente adequado publicar os dados pessoais desse plano. Uma futura versão multiusuário deve tornar a experiência inicial genérica e isolar perfis no banco por usuário.

O service worker não intercepta `/api/`; respostas de autenticação e sugestões usam `Cache-Control: no-store`. O cache da PWA foi atualizado para v7. Sessão tem duração de até uma hora; após expirar, solicite novo link. Renovação automática será uma melhoria posterior. No iPhone, abra o link no navegador que iniciou o acesso; Safari/PWA podem não compartilhar cookies. Se o link abrir em outro contexto, peça outro no Safari e continue nele.

## Validação e limites da entrega

Testes automatizados com Supabase e Gemini simulados verificam validações de perfil/resposta, isolamento dos dados enviados, autenticação, PKCE/cookies, origem, cota e falhas. Nenhum envio real de e-mail nem chamada Gemini foi feito: não há credenciais neste ambiente. Validar entrega/expiração do link e um ciclo real no iPhone após configurar as contas. Não foi realizado teste visual em navegador nesta etapa.

Perfil/sugestão salvos são locais ao aparelho e associados ao ID da conta. Entrar em outro aparelho ainda não recupera esses dados; isso depende do banco de treinos. Há exportação JSON, mas ainda não há importação de sugestões. O backup do diário inclui os planos adotados e seus registros; sugestões salvas apenas como rascunho continuam com exportação própria. Para consultar a sugestão pela interface, o usuário precisa conseguir confirmar a sessão; a leitura totalmente offline será integrada junto à persistência.

Referências: https://supabase.com/docs/guides/auth/auth-email-passwordless · https://supabase.com/docs/guides/auth/sessions/pkce-flow · https://supabase.com/docs/guides/auth/auth-smtp · https://ai.google.dev/gemini-api/docs/structured-output · https://ai.google.dev/gemini-api/terms

## Correção de feedback da geração

Mensagens de geração aparecem junto ao botão. Erros da validação nativa também exibem orientação ali; a sugestão recebe foco ao concluir. Requisições aguardam até 70 segundos pelos cabeçalhos; falhas de conexão/tempo exibem mensagem, preservando a sugestão anterior. Testes simulam envio autenticado, falta de consentimento, cota do provedor, sucesso e interrupção por tempo. Isso corrige a visibilidade do retorno; ainda é necessário observar uma chamada real com a chave do usuário para determinar se há falha adicional no Gemini.

## Diagnóstico Gemini

O botão Verificar conexão com Gemini consulta metadados do modelo, sem enviar perfil nem gerar texto. Exige login e tem contador separado de 10 verificações/dia/usuário. Confirma chave/acesso e generateContent; não comprova cota de geração ou compatibilidade completa do payload. Falhas da consulta e da geração retornam HTTP e códigos Google conhecidos, com orientação específica. A resposta bruta do Google e a chave nunca são devolvidas ao navegador.

## Modelo atualizado

A configuração padrão agora usa `gemini-3.5-flash-lite`. Um sucesso no diagnóstico de metadados não garante que o Google aceite uma geração. Para projetos novos, o Google documentou restrições de inferência nos modelos 2.5 mesmo quando modelos/metadados respondem. A troca não foi verificada com a chave privada do usuário. Referências: https://discuss.ai.google.dev/t/auth-key-can-list-models-but-generatecontent-returns-http-404-not-found-for-gemini-2-5-flash/180197/2 e https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite

## Calendário explícito na geração

O servidor calcula cada semana a partir de startDate, incluindo semanas parciais, e fornece ao Gemini as datas disponíveis. O JSON Schema usa prefixItems por semana, com início fixado, enumeração das datas e limites de sessões/distância/RPE. A validação permanece ativa e agora distingue início incorreto de excesso de sessões. Não há remanejamento de datas, descarte de sessões nem nova chamada automática. Testes cobrem todos os dias de início, períodos de 14/15/20/28/29 dias e virada do ano; ainda é necessário validar com Gemini real após publicar.

## Cobertura das fases até o objetivo

O servidor também calcula intervalos contíguos das fases, do início até a data-alvo inclusive (no máximo 12 fases). O Gemini retorna apenas título e orientações de cada fase na ordem fornecida; o servidor atribui as datas de origem. O número de fases é exigido no esquema e conferido na resposta; não são inventadas orientações para fases ausentes. A validação completa da proposta continua ativa. Testes cobrem todos os prazos de 14 a 730 dias, incluindo ano bissexto, lacunas, fases ausentes e preservação dos dados recebidos. O calendário de sessões mantém o dia-alvo livre de corridas de preparação.

## Adoção da sugestão como plano

Usar este plano valida e salva a proposta no aparelho, associada à conta confirmada. Plano e Hoje usam o bloco adotado; sessões têm IDs próprios para manter registros ao trocar de proposta. É possível registrar e editar sessões passadas, usar o cronômetro e exportar a agenda do plano ativo. Treinos futuros não podem ser registrados. Voltar ao plano original não apaga o histórico. O backup inclui o arquivo de planos adotados e a restauração mantém suas definições junto dos registros. A sessão verificada seleciona o plano da conta; no acesso offline o último plano local pode ser consultado. Os dados permanecem no armazenamento do navegador, sem criptografia nem sincronização entre aparelhos; o backup contém o histórico local desse navegador. O roteiro Zepp para treinos gerados representa a distância principal e inclui as orientações completas como referência; não traduz automaticamente intervalos para etapas FIT.

## Login Google

A interface oferece Google como opção principal, com link de e-mail como alternativa. O servidor verifica se o provedor está habilitado em /auth/v1/settings, gera PKCE com cookie HttpOnly e devolve a URL de autorização do Supabase. O callback existente troca o código no servidor. Configurar as credenciais OAuth no Supabase conforme LOGIN-GOOGLE.md; as credenciais Google OAuth não são cadastradas no Cloudflare e não são a chave da API Gemini. A autenticação real está pendente dessa configuração externa.
