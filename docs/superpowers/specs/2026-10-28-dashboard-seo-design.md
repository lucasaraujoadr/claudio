# Dashboard SEO — OG Perícia Contábil

**Data:** 2026-10-28
**Repositório:** github.com/lucasaraujoadr/claudio
**Hospedagem:** Vercel

## 1. Objetivo

Ferramenta interna que mapeia oportunidades de SEO para
`ogpericiacontabil.com.br` e devolve uma lista priorizada do que escrever
e do que corrigir primeiro.

O nicho — perícia contábil judicial e cálculos judiciais para advogados —
tem concorrência orgânica fraca. A aposta é que trabalho de conteúdo bem
direcionado ranqueia rápido. O sistema existe para dizer *onde* apontar
esse trabalho, com base em dados reais do Google e não em intuição.

**Critério de sucesso:** abrir o dashboard e sair com uma lista ordenada
de ações, sem precisar interpretar planilha.

### Contexto do site

- WordPress em Hostinger (LiteSpeed), Elementor, plugin The SEO Framework.
- Blog ativo, 10 páginas de serviço, páginas institucionais.
- Público: advogados em todo o Brasil. B2B, atendimento remoto, sede no RJ.
- Sem foco geográfico — SEO nacional, não local.

O site permanece no WordPress. Este sistema é separado e **somente de
leitura** sobre ele: orienta o conteúdo, nunca publica nem altera nada.

### Fora de escopo

- Email marketing (será feito no Brevo, em projeto separado).
- Qualquer página pública: o sistema é só dashboard, sem home nem landing.
- Escrita ou publicação automática de artigos.
- Monitoramento de concorrentes (pode virar módulo futuro).

## 2. Stack

| Camada | Escolha | Motivo |
|---|---|---|
| Framework | Next.js 16, App Router, TypeScript strict | Padrão da Vercel; Server Components deixam as consultas no servidor |
| Runtime | Node.js (Fluid Compute) | Edge está depreciado; o crawler precisa de APIs de Node |
| UI | Tailwind CSS v4 + shadcn/ui | Tabelas e formulários prontos e acessíveis |
| Banco | Neon Postgres via Vercel Marketplace | Postgres preferencial da Vercel; variáveis injetadas automaticamente |
| ORM | Drizzle | Migrações versionadas, tipos derivados do schema |
| IA | AI SDK 7 + `@ai-sdk/openai` | Conta OpenAI própria do usuário, decisão explícita dele |
| Google | `googleapis` (Search Console API v3) | Cliente oficial |
| HTML | `cheerio` | Parsing do crawler |
| Testes | Vitest | Rápido, integra com TypeScript sem configuração extra |

Toda função roda no runtime Node.js. Nenhum `export const runtime = 'edge'`.

## 3. Autenticação

Senha única compartilhada, decisão do usuário: ferramenta interna, equipe
pequena, ninguém precisa criar conta.

**Fluxo:** `/login` recebe a senha → comparação em tempo constante contra
`DASHBOARD_PASSWORD` → cookie de sessão assinado com HMAC-SHA256
(`httpOnly`, `secure`, `sameSite=lax`, 30 dias) → `proxy.ts` valida a
assinatura e a validade em toda requisição.

**Protegido:** tudo, exceto `/login`, `/api/login` e `/api/cron/*`.

As rotas de cron não usam o cookie. Elas exigem o header
`Authorization: Bearer ${CRON_SECRET}`, que a Vercel injeta e envia
automaticamente nas invocações agendadas.

O repositório é público. Nenhum segredo entra em arquivo versionado; todos
vivem nas variáveis de ambiente da Vercel. O `.gitignore` cobre `.env*`
com exceção de `.env.example`.

## 4. Integração com o Google Search Console

Via **conta de serviço**, não OAuth.

O Search Console aceita qualquer endereço de email como usuário da
propriedade, inclusive o email de uma conta de serviço do Google Cloud.
Isso elimina a tela de autorização e o token de renovação que expira.

**Configuração manual, uma vez (requer o usuário):**

1. No Google Cloud, criar projeto e habilitar a *Search Console API*.
2. Criar conta de serviço e gerar chave JSON.
3. No Search Console, em Configurações → Usuários e permissões, adicionar
   o email da conta de serviço como **usuário restrito**.
4. Guardar `GOOGLE_SA_EMAIL` e `GOOGLE_SA_PRIVATE_KEY` nas variáveis da
   Vercel.

A chave privada é guardada em duas variáveis separadas em vez de um JSON
inteiro: evita problemas de escape ao colar no painel da Vercel. As quebras
de linha da chave (`\n` literal) são normalizadas na leitura.

**Consultas usadas:** duas por execução do cron, ambas via
`searchanalytics.query` com dimensões `['query','page']` e `rowLimit`
25000. A primeira cobre os 28 dias encerrados 3 dias atrás e é a que
alimenta `gsc_snapshots`. A segunda cobre os 28 dias anteriores a essa
janela e serve apenas à comparação da visão geral, agregada em totais e
não persistida linha a linha.

O recuo de 3 dias é proposital: o Search Console preenche os dias mais
recentes de forma incompleta, e incluí-los faria o período atual parecer
sempre pior que o anterior.

O Search Console tem atraso de 2 a 3 dias. O dashboard sempre exibe a data
do dado, nunca "hoje".

## 5. Modelo de dados

```
gsc_snapshots
  id, snapshot_date, query, page, clicks, impressions, ctr, position
  UNIQUE (snapshot_date, query, page)

clusters
  id, nome, keyword_pilar, intencao, prioridade, status, criado_em

topics
  id, cluster_id (FK, nullable), titulo, keyword, intencao, prioridade,
  status, origem, url_publicada, notas, criado_em

briefings
  id, topic_id (FK), title, meta_description, outline (jsonb),
  faq (jsonb), links_internos (jsonb), keywords_secundarias (jsonb),
  modelo, criado_em

audit_runs
  id, iniciado_em, finalizado_em, paginas_rastreadas, status

audit_pages
  id, run_id (FK), url, status_code, title, meta_description, h1_count,
  h1_texto, palavras, canonical, noindex, links_entrando, links_saindo,
  schema_types (jsonb), imagens_sem_alt

audit_issues
  id, run_id (FK), page_id (FK, nullable), severidade, regra, mensagem
```

`audit_issues.page_id` é nulo para problemas do site inteiro, como sitemap
quebrado.

**Enums:**

- `clusters.status`: `ativo` | `arquivado`
- `topics.status`: `ideia` → `escolhido` → `briefado` → `publicado`
- `topics.origem`: `ia` | `gsc`
- `intencao`: `informacional` | `comercial` | `transacional` | `navegacional`
- `prioridade`: `alta` | `media` | `baixa`
- `audit_issues.severidade`: `critico` | `aviso` | `info`
- `audit_runs.status`: `rodando` | `concluido` | `falhou`

Snapshots do GSC são imutáveis e acumulam por dia, o que permite comparar
posição ao longo do tempo. Volume estimado: alguns milhares de linhas por
dia para um site deste tamanho.

## 6. Módulos

### 6.1 Visão geral — `/`

Cliques e impressões dos últimos 28 dias contra os 28 anteriores, com
variação percentual. Contadores: oportunidades abertas, problemas críticos
de auditoria, temas em cada status. Data do último snapshot do GSC e da
última auditoria.

### 6.2 Oportunidades — `/oportunidades`

Termos em que o site já aparece na posição 5 a 20, ordenados por ganho
estimado em cliques:

```
ganhoEstimado = impressoes × max(0, ctrNaPosicao(3) − ctrAtual)
```

`ctrAtual` vem do próprio GSC. `ctrNaPosicao(3)` vem de uma curva de CTR
por posição fixa em `lib/ctr.ts`, declarada como constante documentada —
é uma estimativa de mercado, não medição, e o código diz isso.

A faixa 5–20 é deliberada: acima da 5 o ganho restante é pequeno; abaixo
da 20 normalmente exige conteúdo novo, não ajuste.

Cada linha mostra a URL que já ranqueia para o termo, para distinguir
"reforçar página existente" de "criar página nova". Dessa tela sai um
botão que cria um `topic` com `origem = 'gsc'`.

### 6.3 Temas e clusters — `/temas`

Pesquisa de temas com OpenAI, organizada em clusters (uma página pilar
mais satélites).

O prompt recebe contexto real e não trabalha no vácuo: os serviços do
site, os termos que o GSC já registra, os temas já cadastrados (para não
repetir) e as lacunas apontadas pela auditoria. A resposta é validada
contra um schema Zod via `generateObject`; resposta fora do schema é
rejeitada sem gravar nada.

Cada tema avança pelos status `ideia` → `escolhido` → `briefado` →
`publicado`. As transições são explícitas: `ideia → escolhido` é manual
na tela de temas; `escolhido → briefado` acontece ao gerar o briefing;
`briefado → publicado` é manual e exige preencher `url_publicada`. É isso
que evita escrever duas vezes sobre o mesmo assunto.

### 6.4 Auditoria técnica — `/auditoria`

Rastreamento disparado manualmente. Começa pelo `sitemap.xml` declarado no
`robots.txt` e, se ele não resolver, parte da home seguindo links internos.

Limites: respeita `robots.txt`, 1 requisição por segundo, teto de 300
páginas, apenas o domínio próprio. Não segue links externos nem
`/wp-admin/`.

**Regras verificadas:**

| Regra | Severidade | Condição |
|---|---|---|
| `title-ausente` | crítico | sem `<title>` |
| `title-duplicado` | crítico | título idêntico em outra página |
| `title-tamanho` | aviso | fora de 30–60 caracteres |
| `meta-ausente` | aviso | sem meta description |
| `meta-duplicada` | aviso | meta idêntica em outra página |
| `meta-tamanho` | aviso | fora de 70–160 caracteres |
| `h1-ausente` | crítico | nenhum `<h1>` |
| `h1-multiplo` | aviso | mais de um `<h1>` |
| `conteudo-raso` | aviso | menos de 300 palavras |
| `pagina-orfa` | crítico | nenhum link interno aponta para ela, exceto a URL inicial do rastreamento |
| `poucos-links-internos` | aviso | menos de 2 links internos saindo |
| `canonical-divergente` | aviso | canonical aponta para outra URL |
| `noindex-inesperado` | crítico | `noindex` em página que devolve 200 e está no sitemap ou é alcançável pelo menu |
| `schema-ausente` | aviso | sem o JSON-LD esperado para o tipo de página (ver abaixo) |
| `link-quebrado` | crítico | link interno devolve 4xx ou 5xx |
| `imagem-sem-alt` | aviso | imagem de conteúdo sem `alt` |
| `sitemap-invalido` | crítico | sitemap do `robots.txt` não resolve |

Duas regras precisam de definição explícita, senão admitem leitura dupla.

`noindex-inesperado` só dispara em página que devolve 200 **e** aparece no
sitemap ou é alcançável pelo menu de navegação. `noindex` em resultado de
busca interna, paginação de arquivo ou página de agradecimento é correto e
não é problema.

`schema-ausente` usa um mapa fixo de tipo de página para JSON-LD esperado:

| Padrão de URL | JSON-LD esperado |
|---|---|
| `/` | `Organization` + `WebSite` |
| `/blog/<slug>/` | `Article` ou `BlogPosting` |
| `/servicos/` e filhas | `Service` |
| `/sobre-nos/`, `/para-advogados/` | `WebPage` |
| `/contato/` | `ContactPage` |

URL que não casa com nenhum padrão não gera o problema — ausência de regra
não é falha.

A última regra da tabela já tem ocorrência confirmada: o `robots.txt` do site declara
`Sitemap: https://ogpericiacontabil.com.br/sitemap.xml`, e essa URL
devolve 404. O site anuncia ao Google um sitemap que não existe.

### 6.5 Briefings — `/briefings`

Para um tema com status `escolhido`, gera o roteiro do artigo: title, meta
description, estrutura de H2 e H3, perguntas para FAQ e schema, links
internos sugeridos (escolhidos entre URLs reais do último rastreamento) e
palavras-chave secundárias.

Saída copiável em Markdown. Gerar um briefing move o tema para `briefado`.

Os links internos sugeridos vêm de `audit_pages`, nunca da invenção do
modelo. Isso evita briefing que manda linkar para página inexistente.

## 7. Estrutura de arquivos

```
src/
  proxy.ts                      validação de sessão
  app/
    login/page.tsx
    (dash)/
      layout.tsx                navegação lateral
      page.tsx                  visão geral
      oportunidades/page.tsx
      temas/page.tsx
      auditoria/page.tsx
      briefings/page.tsx
    api/
      login/route.ts
      logout/route.ts
      cron/gsc/route.ts
      auditoria/run/route.ts
      temas/pesquisar/route.ts
      briefings/gerar/route.ts
  lib/
    auth.ts                     assinatura e validação do cookie
    db/index.ts                 cliente Drizzle com init tardia
    db/schema.ts
    gsc.ts                      cliente do Search Console
    ctr.ts                      curva de CTR e ganho estimado
    crawler/crawl.ts            laço de rastreamento e limites
    crawler/parse.ts            extração de sinais do HTML
    crawler/rules.ts            as 17 regras
    ai/temas.ts
    ai/briefing.ts
    ai/schemas.ts               schemas Zod das respostas
```

Cada unidade tem uma responsabilidade só. `parse.ts` extrai sinais do HTML
e não sabe o que é um problema; `rules.ts` recebe sinais e decide, sem
tocar em rede. Essa separação é o que torna as regras testáveis sem
servidor no ar.

O cliente do banco usa inicialização tardia por função `getDb()`, nunca
`Proxy`: `neon()` no topo do módulo quebra `next build` quando
`DATABASE_URL` ainda não existe, e `Proxy` quebra bibliotecas que
inspecionam o objeto.

## 8. Agendamento

`vercel.ts` com um cron: `/api/cron/gsc` às `0 6 * * *` (UTC), ou seja
03:00 no horário de Brasília.

A auditoria e a pesquisa de temas são manuais. Rastrear o site todo dia não
traz informação nova — o site muda quando alguém o altera — e a pesquisa de
temas gasta OpenAI, então ela roda quando você pede.

## 9. Tratamento de erros

Cada integração degrada de forma isolada:

- **GSC fora do ar:** `/oportunidades` mostra o último snapshot com aviso
  da data. Os outros três módulos não são afetados.
- **OpenAI falha ou devolve fora do schema:** nada é gravado. A operação é
  atômica — sem cluster pela metade, sem briefing truncado.
- **Crawler:** erro em uma página é registrado como problema daquela
  página e o rastreamento continua. Falha global marca o `audit_run` como
  `falhou` e preserva a run anterior, que continua visível.
- **Banco fora do ar:** tela de erro explícita, sem dado inventado.

Nenhuma tela mostra zero quando o certo é "não sei". A diferença entre
"nenhuma oportunidade" e "não consegui consultar" aparece na interface.

## 10. Testes

Vitest, concentrado onde há lógica que erra em silêncio:

- `ctr.ts` — cálculo de ganho estimado, incluindo posição acima de 3
  (ganho zero, nunca negativo) e impressões zeradas.
- `crawler/rules.ts` — cada uma das 17 regras, com caso positivo e
  negativo, mais a detecção de duplicados entre páginas.
- `crawler/parse.ts` — extração sobre HTML real do site, com e sem
  canonical, com e sem JSON-LD.
- `ai/schemas.ts` — rejeição de resposta malformada.
- `auth.ts` — cookie válido, assinatura adulterada, cookie expirado.

As integrações externas entram mockadas. Nenhum teste gasta OpenAI nem
quebra por oscilação do Google.

## 11. Variáveis de ambiente

| Variável | Origem |
|---|---|
| `DATABASE_URL` | Neon via Marketplace, automática |
| `OPENAI_API_KEY` | conta OpenAI do usuário |
| `DASHBOARD_PASSWORD` | definida pelo usuário |
| `AUTH_SECRET` | gerada, 32 bytes aleatórios |
| `GOOGLE_SA_EMAIL` | conta de serviço do Google Cloud |
| `GOOGLE_SA_PRIVATE_KEY` | conta de serviço do Google Cloud |
| `GSC_PROPERTY` | `sc-domain:ogpericiacontabil.com.br` |
| `SITE_URL` | `https://ogpericiacontabil.com.br` |
| `CRON_SECRET` | Vercel, automática |

`.env.example` versionado lista os nomes com valores vazios. Nenhum valor
real é commitado.

## 12. Dependências do usuário

Três passos que só ele pode executar, e que bloqueiam partes específicas:

1. **Login na Vercel** (`vercel login`) — bloqueia o deploy.
2. **Chave da OpenAI** — bloqueia temas e briefings.
3. **Conta de serviço do Google e permissão no Search Console** — bloqueia
   oportunidades e a visão geral.

A auditoria técnica não depende de nenhum dos três além do deploy: ela só
precisa do banco e do site no ar. É por isso o primeiro módulo entregável.
