# Dez Voltas

PWA de preparação para corrida: plano, diário local, guia de prova, exportações e sugestões personalizadas com Gemini.

Produção: https://dez-voltas.pages.dev/

## Desenvolvimento e validação

Node.js 22 ou superior. A aplicação usa HTML/CSS/JavaScript e Pages Functions; não há dependências de produção a instalar.

```sh
npm test
```

Os testes usam Supabase e Gemini simulados. Verificam o calendário, as sessões, registros, exportações, cache offline, login PKCE, validação das sugestões e tratamento de falhas. Uma geração real ainda precisa ser verificada após publicar a correção.

O servidor fornece ao Gemini as semanas e datas disponíveis e restringe o JSON retornado a esse calendário, incluindo semanas parciais. Dias, duração, volume e esforço continuam validados antes de mostrar a sugestão.

## Publicação automática

O workflow `.github/workflows/pages.yml` executa os testes em pull requests e atualizações da `main`. Após os testes, publica a `main` no projeto Cloudflare Pages existente `dez-voltas`. Também permite execução manual por Actions → Validar e publicar PWA → Run workflow.

### Configuração única do GitHub

1. Crie um token Cloudflare com permissão **Account → Cloudflare Pages → Edit**, restrito à conta do projeto.
2. No repositório, abra **Settings → Secrets and variables → Actions → New repository secret**.
3. Salve o token com nome **CLOUDFLARE_API_TOKEN**.
4. Execute o workflow manualmente. Depois disso, novos commits na `main` disparam a publicação.

Sem esse Secret, os testes ainda executam, mas o workflow avisa que a publicação foi pulada. Um workflow verde, sozinho, não comprova que houve deploy: confira a etapa de publicação e a URL no log.

O Account ID está no workflow e não é uma credencial secreta. As chaves **GEMINI_API_KEY** e **SUPABASE_ANON_KEY** permanecem nos Secrets de produção do Cloudflare Pages. Elas não precisam ser copiadas para o GitHub. O namespace KV `AI_USAGE` e as variáveis comuns estão em `wrangler.jsonc`.

Não é necessário converter o projeto Pages para integração Git nem trocar o endereço da PWA. O workflow usa Direct Upload via Wrangler. As Actions estão fixadas por SHA e o Wrangler por versão.

## Dados e limites atuais

- Os registros e sugestões salvos ficam no aparelho, não neste repositório. Não há sincronização de treinos entre dispositivos.
- Supabase Auth fornece acesso por Google (após habilitar o provedor) e link de e-mail como alternativa. Configure o OAuth conforme [LOGIN-GOOGLE.md](LOGIN-GOOGLE.md); para e-mails fora da equipe do projeto, configure SMTP.
- O Gemini recebe somente os dados de treino autorizados no formulário. O e-mail da conta não é enviado ao modelo.
- A sugestão detalha até 28 dias e apresenta as fases até o objetivo. O botão Usar este plano atualiza Plano, Hoje, sessões para registro e exportação de agenda. Novas sugestões não trocam automaticamente o plano em uso. O histórico anterior permanece disponível; o backup JSON inclui os planos adotados e seus registros.
- O controle de uso tem limite de 5 tentativas de geração por dia/usuário. Falhas também contam. KV tem consistência eventual; não constitui teto financeiro exato.
- A disponibilidade do modelo e as cotas da conta Google precisam de validação real. Consultar metadados não comprova que a geração está habilitada.

Configuração detalhada: [README-GEMINI.md](README-GEMINI.md).

Persistência e diário: [BANCO-SUPABASE.md](BANCO-SUPABASE.md). O banco já foi aplicado no projeto Supabase; não exige novas chaves no Cloudflare.

No primeiro acesso de contas sem perfil, o cadastro de corredor aparece antes das demais telas: objetivo/prova, histórico recente, disponibilidade e revisão. A conclusão é persistida em `details.registrationCompleted`. Perfis anteriores permanecem válidos e não repetem o cadastro. O perfil pode ser salvo sem consentimento para IA; gerar um plano exige autorização explícita e cadastro concluído para os novos perfis. Campos opcionais incluem experiência, frequência recente, terreno, desnível, dia do longo e tempo desejado para a distância. Nenhuma nova tabela ou chave de API é necessária.

Banco separado e sincronização incremental: perfil, planos, sessões e diário têm tabelas próprias e revisões por registro. A API `/api/account/sync` transmite alterações desde o cursor do aparelho e combina edições em treinos diferentes. Os documentos antigos foram preservados para recuperação; versões antigas precisam atualizar a PWA antes de sincronizar. Consulte [BANCO-SUPABASE.md](BANCO-SUPABASE.md).

Sessão persistente e renovação automática: [SESSAO.md](SESSAO.md). Tokens ficam somente em cookies HttpOnly. As requisições de treino/sincronização repetem uma única vez após renovar a sessão e verificam a conta esperada antes de gravar.
