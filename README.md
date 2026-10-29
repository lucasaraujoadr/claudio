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

Quando uma fonte ainda não tem dados, o painel diz isso explicitamente (por exemplo, "Search Console ainda não sincronizado") em vez de mostrar zero.

## Dados e rotina automática

- Todo dia às **03:00 (horário de Brasília)** a Vercel executa a sincronização com o Search Console.
- Os snapshots dos últimos **90 dias** ficam completos. Os mais antigos são reduzidos a **um por semana** (o de segunda-feira).
- A Visão geral avisa quando a última auditoria tem mais de 14 dias. As auditorias são rodadas manualmente em `/auditoria` (botão "Rastrear agora").
- Cliques e impressões na Visão geral são somados dos termos sincronizados (combinações termo + página) e podem ficar abaixo dos totais exibidos no próprio Search Console.
- A variação de cliques e impressões na Visão geral compara o snapshot mais recente com o de cerca de 28 dias antes. Sem esse histórico, o painel mostra só os totais atuais.

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
| `OPENAI_API_KEY` | Chave da OpenAI (veja "Chave da OpenAI" abaixo). |
| `OPENAI_MODEL` | Nome do modelo usado nas pesquisas; opcional, o padrão é `gpt-4.1`. |
| `DASHBOARD_PASSWORD` | Senha do painel; você escolhe. |
| `AUTH_SECRET` | Texto aleatório longo que assina o login; gere com `openssl rand -base64 32`. |
| `GOOGLE_SA_EMAIL` | Campo `client_email` do arquivo JSON da conta de serviço do Google. |
| `GOOGLE_SA_PRIVATE_KEY` | Campo `private_key` do mesmo arquivo JSON. |
| `GSC_PROPERTY` | Propriedade do Search Console: `sc-domain:ogpericiacontabil.com.br`. |
| `SITE_URL` | Endereço do site rastreado: `https://ogpericiacontabil.com.br`. |
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

## Chave da OpenAI

1. Entre em https://platform.openai.com e faça login (ou crie a conta).
2. Em **Billing**, adicione um método de pagamento ou crédito; sem isso a chave não funciona.
3. Em **API keys > Create new secret key**, copie a chave (ela aparece só uma vez).
4. Cadastre-a na Vercel como `OPENAI_API_KEY`.
