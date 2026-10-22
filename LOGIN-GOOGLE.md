# Ativar login com Google

O código usa Supabase Auth como intermediário: PWA → Supabase → Google → Supabase → PWA. PKCE protege a troca do código no servidor; tokens de sessão permanecem em cookie HttpOnly/Secure. A chave Gemini não participa do login.

O botão já está preparado no código, mas é necessário configurar o provedor na sua conta. Enquanto isso, o acesso por link de e-mail continua disponível.

## 1. Criar o aplicativo no Google Cloud

Abra https://console.cloud.google.com/auth/clients e selecione o projeto que usará para o login.

Se solicitado, configure a Google Auth Platform:

- Nome do aplicativo: Dez Voltas.
- E-mail de suporte e contato: seu e-mail.
- Público externo; enquanto estiver em teste, cadastre sua conta na lista de usuários de teste.
- Escopos de login: `openid`, `email`, `profile`.

Em Clients, crie um **OAuth client ID** do tipo **Web application**:

| Campo | Valor |
| --- | --- |
| Nome | Dez Voltas Web |
| Authorized JavaScript origins | `https://dez-voltas.pages.dev` |
| Authorized redirect URIs | `https://wuuyaisxmljtuhkilrjm.supabase.co/auth/v1/callback` |

Copie o **Client ID** e o **Client Secret** para o próximo passo. São credenciais OAuth, diferentes da API key do Gemini. Não as coloque no código, em commits ou no chat.

## 2. Habilitar Google no Supabase

Abra https://supabase.com/dashboard/project/wuuyaisxmljtuhkilrjm/auth/providers?provider=Google

Em Authentication → Sign In / Providers → Google:

1. Habilite o provedor Google.
2. Cole o Client ID e o Client Secret criados no Google Cloud.
3. Mantenha a verificação de nonce habilitada; não há necessidade de desativá-la neste fluxo OAuth.
4. Salve.

Em Authentication → URL Configuration, mantenha:

- Site URL: `https://dez-voltas.pages.dev`
- Redirect URLs: `https://dez-voltas.pages.dev/?auth=callback`

A URI de retorno cadastrada no Google termina em `/auth/v1/callback` no **Supabase**. O retorno do Supabase para a PWA termina em `/?auth=callback` no **Pages**. São dois endereços diferentes.

O Secret OAuth é gerenciado pelo Supabase; não precisa de novo Secret no Cloudflare. Depois de salvar o provedor, não há necessidade de um novo deploy para habilitá-lo.

## 3. Testar

1. No navegador normal, abra https://dez-voltas.pages.dev/#perfil.
2. Se já estiver conectado, saia da conta. Seu histórico local e os planos arquivados são preservados.
3. Clique em Entrar com Google e selecione o mesmo e-mail usado anteriormente no app.
4. Confirme o retorno a “Conectado como…”, a geração e a seleção do plano.

O Supabase pode vincular automaticamente identidades com e-mail verificado à conta existente, conforme a configuração de identidade. Usar outro e-mail pode criar outra conta; os planos anteriores continuam no aparelho. Para o primeiro teste no iPhone, use o Safari e mantenha o fluxo no mesmo contexto; o retorno ao app instalado também precisa ser validado, pois Safari e PWA podem ter cookies separados.

Os testes automatizados cobrem origem, provedor habilitado/desabilitado, PKCE, cookies, início do redirecionamento e a troca de código simulada. A autorização real pelo Google e o retorno no iPhone ainda precisam ser verificados após configurar as credenciais.

Referências: https://supabase.com/docs/guides/auth/social-login/auth-google · https://supabase.com/docs/guides/auth/sessions/pkce-flow
