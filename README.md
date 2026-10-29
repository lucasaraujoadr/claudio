# Painel SEO — OG Perícia Contábil

Painel interno para acompanhar e planejar o SEO do site `ogpericiacontabil.com.br`.

**Endereço:** https://claudio-psi-lime.vercel.app
O acesso passa por duas barreiras: o login da Vercel e a senha do painel (definida na variável `DASHBOARD_PASSWORD`).

## O que o painel faz

| Módulo | Para que serve |
| --- | --- |
| **Visão geral** (`/`) | Resumo: cliques e impressões, oportunidades abertas, problemas críticos e temas por status. |
| **Auditoria técnica** (`/auditoria`) | Rastreia o site e lista problemas (títulos, descrições, H1, links, canonical...) por gravidade. |
| **Oportunidades** (`/oportunidades`) | Termos do Search Console que ranqueiam entre as posições 5 e 20, ordenados pelo ganho estimado de cliques. |
| **Temas** (`/temas`) | Pesquisa de temas com IA, organizados em clusters, com status: ideia, escolhido, briefado, publicado. |
| **Briefings** (`/briefings`) | Briefing de conteúdo gerado com IA para um tema escolhido: title, meta description, estrutura de H2/H3, FAQ, links internos e keywords secundárias, com botão para copiar em Markdown. |

Quando uma fonte ainda não tem dados, o painel diz isso explicitamente (por exemplo, "Search Console ainda não sincronizado") em vez de mostrar zero.

## Dados e rotina automática

- Todo dia às **03:00 (horário de Brasília)** a Vercel executa `/api/cron/diario`, que sincroniza o **Search Console** e o **Google Analytics 4** de forma independente: se uma fonte falhar ou não estiver configurada, a outra continua. A resposta informa, por fonte, `ok`, `nao_configurado`, `sem_permissao` ou `erro`, e o último resultado fica na tabela `sincronizacoes`.
- Google Analytics: defina `GA4_PROPERTY_ID` e adicione a conta de serviço (`GOOGLE_SA_EMAIL`) como **Leitor** na propriedade. A primeira execução busca 90 dias de série diária; a cada execução também guarda as páginas de entrada por origem/mídia dos últimos 28 dias (até 1 000 linhas).
- Plano Hobby da Vercel: até 100 crons por projeto, cada um no máximo uma vez por dia (horário com precisão de hora).
- Os snapshots dos últimos **90 dias** ficam completos. Os mais antigos são reduzidos a **um por semana** (o de segunda-feira).
- A Visão geral avisa quando a última auditoria tem mais de 14 dias. As auditorias são rodadas manualmente em `/auditoria` (botão "Rastrear agora").
- Cliques e impressões na Visão geral são somados dos termos sincronizados (combinações termo + página) e podem ficar abaixo dos totais exibidos no próprio Search Console.
- A variação de cliques e impressões na Visão geral compara a janela de 28 dias do snapshot mais recente com os 28 dias imediatamente anteriores, que a sincronização diária busca e guarda junto com o snapshot. Para um snapshot sem esse registro (gravado antes da tabela existir), o painel compara com o snapshot de cerca de 28 dias antes, se houver; sem nenhum dos dois, mostra só os totais atuais.
- A sincronização grava o snapshot, a limpeza de retenção e os totais numa única transação: se ela falhar no meio, nada é gravado e o snapshot anterior continua valendo.

## Rodar no computador

```bash
npm install
npx vercel env pull .env.local   # baixa as variáveis do projeto na Vercel
npm run dev                      # abre em http://localhost:3000
```

Testes: `npm test`

## Variáveis de ambiente

Ficam na Vercel (Settings > Environment Variables). Nunca coloque os valores no código nem neste arquivo. O modelo está em `.env.example`.

| Variável | De onde vem |
| --- | --- |
| `DATABASE_URL` | Banco Postgres (Neon), criado pela integração da Vercel. |
| `OPENROUTER_API_KEY` | Chave do OpenRouter, que dá acesso aos modelos de IA (veja "Chave de IA" abaixo). É a forma preferida. |
| `OPENAI_API_KEY` | Alternativa: chave da OpenAI direta. Só é usada se `OPENROUTER_API_KEY` não estiver definida. |
| `OPENAI_MODEL` | Modelo usado nas pesquisas de temas e nos briefings; opcional. O padrão é `openai/gpt-4.1` (com `OPENAI_API_KEY`, `gpt-4.1`). |
| `OPENAI_MODEL_BUSCA` | Modelo que pesquisa na internet, para as tendências do dia; opcional, o padrão é `perplexity/sonar-pro`. |
| `DASHBOARD_PASSWORD` | Senha do painel; você escolhe. |
| `AUTH_SECRET` | Texto aleatório longo que assina o login; gere com `openssl rand -base64 32`. |
| `GOOGLE_SA_EMAIL` | Campo `client_email` do arquivo JSON da conta de serviço do Google. |
| `GOOGLE_SA_PRIVATE_KEY` | Campo `private_key` do mesmo arquivo JSON. |
| `GSC_PROPERTY` | Propriedade do Search Console: `sc-domain:ogpericiacontabil.com.br`. |
| `SITE_URL` | Endereço do site rastreado e aceito como URL publicada; opcional, o padrão é `https://ogpericiacontabil.com.br`. |
| `CRON_SECRET` | Segredo que protege a rotina diária. Você mesmo gera um texto aleatório longo (`openssl rand -base64 32`) e cadastra como variável `CRON_SECRET` na Vercel, nos três ambientes (Production, Preview e Development); a partir daí a Vercel passa a enviá-lo ao cron. Ele já está configurado neste projeto: não gere outro, para não quebrar a rotina que funciona. |

## Conta de serviço do Google (Search Console)

1. Acesse https://console.cloud.google.com e crie um projeto (ou use um existente).
2. Em **APIs e serviços > Biblioteca**, procure **Google Search Console API** e clique em **Ativar**.
3. Em **IAM e administrador > Contas de serviço**, clique em **Criar conta de serviço**, dê um nome (ex.: `painel-seo`) e conclua. Não precisa atribuir papéis.
4. Abra a conta criada, aba **Chaves > Adicionar chave > Criar nova chave > JSON**. O arquivo é baixado; guarde-o em local seguro.
5. No arquivo, copie `client_email` para `GOOGLE_SA_EMAIL` e `private_key` para `GOOGLE_SA_PRIVATE_KEY` na Vercel.
6. Em https://search.google.com/search-console, escolha a propriedade `sc-domain:ogpericiacontabil.com.br` e vá em **Configurações > Usuários e permissões > Adicionar usuário**.
7. Cole o e-mail da conta de serviço e escolha a permissão **Restrito** (somente leitura). Salve.
8. Defina `GSC_PROPERTY` como `sc-domain:ogpericiacontabil.com.br`. A primeira sincronização ocorre na próxima execução diária.

## Chave de IA

Com o OpenRouter (recomendado), uma só chave dá acesso aos modelos de IA do painel:

1. Entre em https://openrouter.ai e faça login (ou crie a conta).
2. Em **Credits**, adicione saldo; sem isso a chave não funciona.
3. Em **Keys > Create Key**, copie a chave (ela aparece só uma vez).
4. Cadastre-a na Vercel como `OPENROUTER_API_KEY`.

Se preferir a OpenAI direta, crie a chave em https://platform.openai.com (**API keys**, com crédito em **Billing**) e cadastre-a como `OPENAI_API_KEY`. Ela só vale quando `OPENROUTER_API_KEY` não existe. Os nomes de modelo mudam entre os dois: no OpenRouter é `openai/gpt-4.1`, na OpenAI direta é `gpt-4.1`.
