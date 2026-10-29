# Artigos → WordPress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gerar artigo completo por IA a partir de tese/tema, revisar e editar no painel, e enviar ao WordPress (rascunho, agendado, publicado).

**Architecture:** Lógica pura em `src/lib/artigos/*` (formato da IA → HTML, sanitização, Gutenberg, conferência SEO), cliente REST do WP com `fetch` injetável em `src/lib/wordpress.ts`, orquestração com banco injetável (`BancoCrm`, PGlite nos testes) em `src/lib/artigos/repositorio.ts`, `gerar.ts`, `enviar.ts`. Rotas em `src/app/api/artigos/*`; telas `/artigos` e `/artigos/[id]` com editor TipTap (client component).

**Tech Stack:** Next.js 16.4.3 (App Router, Node runtime), Drizzle + Neon, AI SDK 7 via OpenRouter (`gerarObjetoPadrao`, `gerarObjetoComBuscaEFontes`), cheerio (já instalado), TipTap 3 (novo), Vitest + PGlite.

**Spec:** `docs/superpowers/specs/2026-10-29-artigos-wordpress-design.md`

## Global Constraints

- Leia `node_modules/next/dist/docs/` antes de usar API do Next (AGENTS.md). Runtime Node em toda rota (`export const runtime = 'nodejs'`); nunca edge.
- Textos de interface em pt-BR; identificadores de código em português, como o resto do repositório.
- Credenciais `WP_USUARIO`, `WP_SENHA_APP` (e `WP_URL`, padrão `siteUrl()`) nunca em log, resposta HTTP, mensagem de erro gravada ou bundle do cliente.
- Nenhum dado de contato do CRM em prompt de IA.
- Schema enviado ao modelo é leniente (sem `.min/.max` em string); validação estrita com Zod depois.
- HTML: lista branca `p h2 h3 strong em ul ol li blockquote a mark br`; atributos só `href` em `a` (http/https ou começando com `#`) e `data-verificar` em `mark`. Sanitizar ao salvar e ao enviar.
- Marcas "verificar" (`<mark data-verificar>`) removidas do conteúdo enviado ao WP (texto mantido); `agendar`/`publicar` bloqueados enquanto houver alguma.
- Título ideal ≤ 60; meta ideal 120–155; artigo 1.200–2.000 palavras (aviso < 900).
- Capa: JPEG/PNG/WebP por bytes mágicos, ≤ 4 MB.
- Mudança de schema só por `drizzle-kit push` (via `npx dotenv -e .env.local -- npx drizzle-kit push`); nunca DDL à mão; não tocar no `unique` de `funil_inscricoes`.
- Envio real ao WP de produção nos testes: proibido. Testes usam `fetch` simulado.
- Erros/logs só com `e.name` ou frase própria (padrão do repo).

## Review Focus

1. Segundo clique em "Gerar artigo" (ou F5 no POST) enquanto gera → não paga duas gerações; abre o mesmo artigo. (Task 1)
2. Post editado ou apagado no WordPress depois do envio → aviso de conflito / recria, nunca sobrescreve em silêncio nem quebra. (Task 6)
3. HTML colado no editor com `<script>`, `onerror`, `javascript:`, `<img>`, estilos do Word → sai limpo, texto preservado. (Task 2)
4. Senha de aplicativo errada ou revogada → mensagem clara "senha de aplicativo inválida ou usuário sem permissão de Editor", nada marcado como enviado, credencial fora da mensagem. (Task 4)
5. Modelo devolve link interno inventado, slug com acento/espaço ou título longo → link vira texto, slug normalizado, título reparado. (Task 2/5)

---

### Task 1: Schema e repositório de artigos

**Files:**
- Modify: `src/lib/db/schema.ts` (enum `tese_status` + `virou_artigo`; enum `artigo_situacao`; tabela `artigos`)
- Create: `src/lib/artigos/repositorio.ts`
- Create: `src/lib/artigos/__tests__/banco-teste-artigos.ts`, `src/lib/artigos/__tests__/repositorio.test.ts`

**Interfaces:**
- Consumes: `BancoCrm`, `bancoPadrao()` de `src/lib/crm/banco.ts`; `topics`, `tesesSugeridas`, `briefings`.
- Produces:
  - `artigoSituacao` pgEnum `['gerando','erro_geracao','rascunho','pronto','agendado','publicado']`; `artigos` com as colunas da spec §8 (camelCase no TS: `topicId` único, `teseId`, `situacao`, `titulo`, `slug`, `metaDescription`, `conteudoHtml`, `fontes` jsonb `$type<{titulo?:string;url:string}[]>` default `[]`, `categoriaId`, `capaMediaId`, `capaUrl`, `revisado` bool default false, `agendadoPara`, `wpPostId`, `wpStatus`, `wpLink`, `wpModificadoGmt` text, `enviadoEm`, `alteradoAposEnvio` bool default false, `erro`, `modelo`, `geradoEm`, `criadoEm`, `atualizadoEm`; timestamps `withTimezone`). Tipo `Artigo`.
  - `reivindicarGeracao(origem: { topicId: number } | { teseId: number }, agora: Date, db?): Promise<{ tipo: 'reivindicado'; artigoId: number; topicId: number } | { tipo: 'existe'; artigoId: number } | { tipo: 'nao_encontrado' }>` — com tese: transação que cria/reaproveita o tema pela `keyword_normalizada` (mesma regra de `virarTema`) e marca a tese `virou_artigo` (aceita tese `nova` ou `virou_tema`; `descartada` → `nao_encontrado`); insere `artigos` com `situacao='gerando'`, `onConflictDoNothing` em `topic_id`. Se já existe com `gerando` e `atualizadoEm` < agora−10 min, ou `erro_geracao`, re-reivindica (update condicional) → `reivindicado`; senão `existe`.
  - `concluirGeracao(id, dados: { titulo; slug; metaDescription; conteudoHtml; fontes; modelo }, agora, db?)` → `situacao='rascunho'`, `geradoEm`, `erro=null`.
  - `falharGeracao(id, mensagem: string, agora, db?)` → `erro_geracao`.
  - `salvarEdicao(id, campos: Partial<Pick<Artigo,'titulo'|'slug'|'metaDescription'|'conteudoHtml'|'categoriaId'|'revisado'|'agendadoPara'|'capaMediaId'|'capaUrl'>>, agora, db?): Promise<Artigo | null>` — recusa (`null`) em `gerando`; se `wpPostId` não nulo e algum campo de conteúdo mudou, `alteradoAposEnvio=true`; `rascunho`↔`pronto` segue `revisado`.
  - `obterArtigo(id, db?)`, `obterArtigoDoTema(topicId, db?)`, `listarArtigos(filtro?: { situacao? }, db?)` (com `keyword` do tema, ordem `atualizadoEm desc`).
  - `registrarEnvio(id, r: { wpPostId; wpStatus: 'draft'|'future'|'publish'; wpLink; wpModificadoGmt }, agora, db?)` — situação: draft→`pronto` se revisado senão `rascunho`, future→`agendado`, publish→`publicado`; `alteradoAposEnvio=false`, `erro=null`, `enviadoEm`. Em `publish`: `topics.status='publicado'`, `topics.urlPublicada=wpLink` (mesma transação).
  - `registrarErroEnvio(id, mensagem, db?)`, `desvincularDoWp(id, db?)` (zera campos wp, situação `pronto`/`rascunho` conforme `revisado`).
  - `listarAgendados(db?)`.
  - `criarBancoTesteArtigos()` no helper: PGlite com `topics`, `clusters`, `briefings`, `tendencias`, `tesesSugeridas`, `artigos` e enums, mesmo método de `src/lib/crm/__tests__/banco-teste.ts`.

- [ ] **Step 1: Testes que falham** em `repositorio.test.ts`:
  - `reivindica uma vez: dois reivindicarGeracao simultâneos ({topicId}) → um 'reivindicado', um 'existe', 1 linha`
  - `gerando há 11 min é re-reivindicado; há 5 min é 'existe'`
  - `erro_geracao é re-reivindicado`
  - `de tese nova: cria tema origem 'tendencia', tese vira 'virou_artigo'`
  - `de tese cuja keyword já é tema: reaproveita o tema existente (sem novo topic)`
  - `tese descartada → nao_encontrado`
  - `salvarEdicao em artigo enviado marca alteradoAposEnvio; só revisado não marca`
  - `salvarEdicao recusa artigo gerando`
  - `revisado=true leva rascunho a pronto e false volta`
  - `registrarEnvio publish atualiza topics.status 'publicado' e url_publicada`
  - `registrarEnvio future → agendado; draft com revisado → pronto`
  - `desvincularDoWp zera wpPostId/wpLink/wpStatus`
- [ ] **Step 2:** `npx vitest run src/lib/artigos/__tests__/repositorio.test.ts` → FAIL (módulo ausente).
- [ ] **Step 3:** Implementar schema e repositório.
- [ ] **Step 4:** Testes PASS; `npx tsc --noEmit` limpo; suíte inteira `npx vitest run` verde.
- [ ] **Step 5:** `npx dotenv -e .env.local -- npx drizzle-kit push` aplicando só o enum novo, o valor de enum e a tabela `artigos` (se o diff incluir o drop/recreate conhecido de `funil_inscricoes_contato_funil_uq`, aceite — é o residual conhecido, tabela vazia). Se o push for negado pelo sistema de permissões, PARE e reporte BLOCKED; nunca rode DDL à mão.
- [ ] **Step 6:** Commit `feat(artigos): tabela e repositório de artigos`.

### Task 2: Conteúdo — formato da IA, HTML, sanitização e Gutenberg

**Files:**
- Create: `src/lib/artigos/formato.ts`, `src/lib/artigos/html.ts`
- Test: `src/lib/artigos/__tests__/formato.test.ts`, `src/lib/artigos/__tests__/html.test.ts`

**Interfaces:**
- Produces (formato.ts):
  - `blocoSchemaModelo`, `artigoSchemaModelo` (leniente; forma da spec §5: `titulo, slug, metaDescription, introducao: Bloco[], secoes: {titulo, subsecoes?: {titulo, blocos}[], blocos}[], faq: {pergunta, resposta}[], conclusao: Bloco[]`; `Bloco = { tipo: 'paragrafo'|'lista'|'lista_numerada'|'citacao'; texto?: string; itens?: string[]; verificar?: string }`). Tipo `ArtigoModelo`.
  - `normalizarSlug(s: string): string` — NFD sem acento, minúsculas, `[^a-z0-9]+`→`-`, sem `-` nas pontas, máx 75 chars cortando em `-`.
  - `slugValido(s): boolean` — `/^[a-z0-9]+(-[a-z0-9]+)*$/`, 1–75.
  - `paraHtml(a: ArtigoModelo, urlsPermitidas: string[]): string` — introdução, H2/H3, FAQ como `<h2>Perguntas frequentes</h2>` + `<h3>pergunta</h3><p>resposta</p>`, conclusão. Inline: `**negrito**`→`<strong>`, `*itálico*`→`<em>`, `[âncora](url)`→`<a href>` só se a url (normalizada sem barra final) está em `urlsPermitidas`, senão só a âncora. Texto escapado antes. Bloco com `verificar` → conteúdo do bloco dentro de `<mark data-verificar="motivo escapado">` (em lista: cada `li` com mark).
  - `contarPalavras(html: string): number`.
- Produces (html.ts):
  - `sanitizarHtml(html: string): string` — reconstrução por lista branca com cheerio (não remoção): tags fora da lista viram seus filhos (texto preservado), exceto `script style iframe object embed noscript template` que somem com conteúdo; `b`→`strong`, `i`→`em`, `h1`→`h2`, `h4-h6`→`h3`, `div`→`p`; atributos fora da regra descartados; `href` com esquema diferente de http/https/`#` remove o `a` (mantém texto).
  - `removerVerificar(html): string`, `contarVerificar(html): number`.
  - `paraGutenberg(htmlSanitizado: string): string` — cada bloco de topo vira `<!-- wp:paragraph --><p>…</p><!-- /wp:paragraph -->`, `<!-- wp:heading --><h2 class="wp-block-heading">…</h2><!-- /wp:heading -->`, `<!-- wp:heading {"level":3} --><h3 class="wp-block-heading">…</h3><!-- /wp:heading -->`, `<!-- wp:list --><ul class="wp-block-list"><!-- wp:list-item --><li>…</li><!-- /wp:list-item --></ul><!-- /wp:list -->` (`ol`: `<!-- wp:list {"ordered":true} -->`), `<!-- wp:quote --><blockquote class="wp-block-quote"><!-- wp:paragraph --><p>…</p><!-- /wp:paragraph --></blockquote><!-- /wp:quote -->`; blocos separados por `\n\n`; texto solto de topo vira parágrafo.
  - `extrairPrimeiroParagrafo(html): string`, `extrairH2(html): string[]`, `contarLinksInternos(html, host: string): number`.

- [ ] **Step 1: Testes que falham** — formato: `paraHtml gera h2/h3, faq e conclusão na ordem`, `link para url fora da lista vira texto`, `link permitido aceita com ou sem barra final`, `escapa <script> vindo do modelo`, `bloco verificar vira mark com data-verificar`, `normalizarSlug('Revisão do PASEP: 2026!') === 'revisao-do-pasep-2026'`, `normalizarSlug corta em 75 sem hífen final`, `contarPalavras ignora tags`. html: `sanitizar remove <script>alert(1)</script> inteiro`, `remove onerror e <img>`, `a com javascript: vira texto`, `preserva texto de <span style> do Word`, `b→strong, h1→h2, h4→h3`, `mantém data-verificar só em mark`, `removerVerificar mantém texto`, `paraGutenberg de p/h2/h3/ul/ol/blockquote igual ao esperado (snapshot inline com as strings acima)`, `texto solto vira wp:paragraph`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS + tsc.
- [ ] **Step 5:** Commit `feat(artigos): formato da IA, HTML seguro e blocos do Gutenberg`.

### Task 3: Lista de conferência de SEO

**Files:**
- Create: `src/lib/artigos/conferencia.ts`
- Test: `src/lib/artigos/__tests__/conferencia.test.ts`

**Interfaces:**
- Consumes: funções de `html.ts` e `formato.ts` (Task 2); `normalizarKeyword` de `src/lib/keyword.ts`; `hostSite()` de `src/lib/site.ts`.
- Produces: `type ItemConferencia = { id: string; nivel: 'ok'|'aviso'|'bloqueia'; texto: string }`; `conferir(a: { titulo: string; slug: string; metaDescription: string; conteudoHtml: string; keyword: string; categoriaId: number|null; capaMediaId: number|null; revisado: boolean; slugEmUso?: string|null }): ItemConferencia[]`; `podePublicar(itens): boolean` (nenhum `bloqueia`). Ids fixos: `verificar`, `titulo_vazio`, `slug`, `revisado`, `kw_titulo`, `kw_primeiro_paragrafo`, `kw_slug`, `titulo_tamanho`, `meta_tamanho`, `links_internos`, `palavras`, `h2`, `h2_repetido`, `capa`, `categoria`. Bloqueiam: `verificar` (>0), `titulo_vazio`, `slug` (inválido ou `slugEmUso` não nulo — texto "endereço já usado em <link>"), `revisado` (false). Os demais são `aviso` quando falham, `ok` quando passam. Comparação de keyword via `normalizarKeyword` em ambos os lados (slug: keyword normalizada com espaços→`-`).

- [ ] **Step 1: Testes que falham:** um artigo completo correto → todos `ok` e `podePublicar` true; um teste por id provocando a falha e checando o nível (`verificar` com 2 marks → bloqueia e texto menciona "2"); `meta 119 → aviso, 120 e 155 → ok, 156 → aviso`; `título 61 → aviso`; `keyword com acento diferente do título ainda conta como presente`; `1 link interno → aviso, 2 → ok (links externos não contam)`.
- [ ] **Step 2–4:** FAIL → implementar → PASS + tsc.
- [ ] **Step 5:** Commit `feat(artigos): lista de conferência de SEO`.

### Task 4: Cliente REST do WordPress

**Files:**
- Create: `src/lib/wordpress.ts`
- Test: `src/lib/__tests__/wordpress.test.ts`

**Interfaces:**
- Produces:
  - `type ConfigWp = { url: string; usuario: string; senha: string }`; `configWp(env = process.env): ConfigWp | null` (null se faltar usuário ou senha; `url` = `WP_URL` ou `siteUrl()`, sem barra final).
  - `class ErroWp extends Error { tipo: 'credencial'|'nao_encontrado'|'conflito_slug'|'rede'|'servidor'|'invalido' }` — mensagens fixas pt-BR: credencial = "senha de aplicativo inválida ou usuário sem permissão de Editor"; rede/servidor = "o WordPress não respondeu; tente de novo"; nunca contém a credencial nem o corpo da resposta.
  - `criarClienteWp(cfg: ConfigWp, f: typeof fetch = fetch)` retornando `{ listarCategorias(): Promise<{id:number;nome:string}[]>; enviarImagem(bytes: Uint8Array, nomeArquivo: string, tipo: string): Promise<{ id: number; url: string }>; criarPost(d: DadosPost): Promise<PostWp>; atualizarPost(id: number, d: DadosPost): Promise<PostWp>; lerPost(id: number): Promise<PostWp | null>; slugEmUso(slug: string, excetoId?: number): Promise<string | null> }`.
  - `type DadosPost = { status: 'draft'|'future'|'publish'; titulo: string; slug: string; conteudo: string; resumo: string; categorias: number[]; capaId: number|null; dataGmt?: string; metaDescription: string }`; `type PostWp = { id: number; status: string; link: string; modificadoGmt: string; metaGravada: boolean }`.
- Detalhes fixados: `Authorization: Basic base64(usuario:senha)`; posts em `/wp-json/wp/v2/posts` com `?context=edit` na leitura; corpo JSON `{status,title,slug,content,excerpt,categories,featured_media,date_gmt?,meta:{_genesis_description, _genesis_title: titulo}}` (featured_media 0 quando null); `metaGravada` = resposta tem `meta._genesis_description` igual ao enviado; mídia `POST /wp-json/wp/v2/media` com corpo binário, `Content-Type` do arquivo e `Content-Disposition: attachment; filename="<nome ASCII seguro>"`; categorias `GET /wp-json/wp/v2/categories?per_page=100&_fields=id,name`, todas, ordenadas por nome; `slugEmUso` → `GET posts?slug=&status=publish,future,draft,pending,private&_fields=id,link&context=edit`, retorna link do primeiro com id ≠ excetoId. 401/403 → `credencial`; 404 em `lerPost` → `null`; 400 com `code` contendo `invalid_param` → `invalido`; ≥500/exceção de fetch → `servidor`/`rede`. Timeout 30 s por chamada (`AbortSignal.timeout`). Cache de categorias em memória por 1 h (módulo).

- [ ] **Step 1: Testes que falham** com `fetch` falso que registra chamadas: `configWp null sem senha`, `criarPost manda Basic correto, context, corpo com meta e featured_media 0`, `atualizarPost usa POST /posts/:id`, `lerPost 404 → null`, `401 → ErroWp credencial e message não contém usuário nem senha`, `fetch lançando → ErroWp rede`, `500 → servidor`, `metaGravada false quando resposta não tem _genesis_description`, `enviarImagem manda Content-Disposition com nome ASCII (acentos removidos)`, `slugEmUso ignora o próprio id`, `categorias em cache: segunda chamada não chama fetch`.
- [ ] **Step 2–4:** FAIL → implementar → PASS + tsc.
- [ ] **Step 5:** Commit `feat(wordpress): cliente REST com senha de aplicativo`.

### Task 5: Geração por IA e reescrita de trecho

**Files:**
- Create: `src/lib/artigos/gerar.ts`, `src/lib/artigos/prompts.ts`
- Test: `src/lib/artigos/__tests__/gerar.test.ts`

**Interfaces:**
- Consumes: Task 1 (`concluirGeracao`, `falharGeracao`), Task 2 (`artigoSchemaModelo`, `paraHtml`, `normalizarSlug`, `sanitizarHtml`), `GerarObjeto`, `gerarObjetoPadrao`, `gerarObjetoComBuscaEFontes`, `repararTitle`/`repararMeta` de `src/lib/ai/briefing.ts`, `gerarBriefing` + `gravarBriefing` (gera briefing se o tema não tiver; não exige status `escolhido` aqui), `carregarUrlsDoSite`.
- Produces:
  - `montarPromptPesquisa(t: { keyword: string; titulo: string }): string` e `pesquisaSchemaModelo` (`{ fatos: { afirmacao: string; fonte?: string }[] }`).
  - `montarPromptArtigo(ctx: { topico: Topic; briefing: Briefing; fatos: {afirmacao:string;fonte?:string}[]; urlsDoSite: string[] }): string` — pt-BR, público advogados, 1.200–2.000 palavras, segue outline/FAQ do briefing, links internos só da lista (máx 80, `MAX_URLS_NO_PROMPT`), marca `verificar` em todo bloco com lei/súmula/tema/índice/data/valor, proíbe prometer resultado, citar honorários, inventar número de processo; conclusão com chamada para falar com a OG (perícia contábil 100% remota para todo o Brasil) sem sensacionalismo.
  - `executarGeracao(artigoId: number, topicId: number, deps?: { gerar?: GerarObjeto; buscar?: typeof gerarObjetoComBuscaEFontes; db?: BancoCrm; agora?: () => Date }): Promise<'ok'|'erro'>` — pesquisa (falha da pesquisa não aborta: segue com `fatos=[]` e `fontes=[]`), redação, validação estrita (título/meta reparados; slug via `normalizarSlug`, vazio → da keyword), `paraHtml` → `sanitizarHtml`, `concluirGeracao`. Qualquer erro → `falharGeracao(id, 'falha ao gerar o artigo; tente de novo')` e log só `e.name`.
  - `reescreverTrecho(t: { trecho: string; instrucao: string; keyword: string }, gerar?: GerarObjeto): Promise<string>` — schema `{ texto: string }`, devolve texto puro (sem HTML), trecho ≤ 4.000 chars e instrução ≤ 500 (excesso → `Error('trecho longo demais')`).

- [ ] **Step 1: Testes que falham** com `gerar`/`buscar` falsos e PGlite: `ok grava rascunho com html sanitizado e fontes da busca`, `busca falhando ainda gera (fontes [])`, `modelo devolve link inventado → html sem o link`, `slug do modelo com acento é normalizado`, `título de 80 chars é reparado`, `redação falhando → erro_geracao com mensagem fixa`, `tema sem briefing gera e grava briefing antes`, `prompt do artigo contém as urls permitidas e não contém 'email'/'telefone' de contato`, `reescreverTrecho recusa instrução com 501 chars`.
- [ ] **Step 2–4:** FAIL → implementar → PASS + tsc.
- [ ] **Step 5:** Commit `feat(artigos): geração do artigo e reescrita de trecho por IA`.

### Task 6: Envio ao WordPress e sincronização de agendados

**Files:**
- Create: `src/lib/artigos/enviar.ts`
- Modify: `src/lib/cron-diario.ts` (fonte opcional `artigos`), `src/app/api/cron/diario/route.ts` (liga a etapa quando `configWp()` não é null)
- Test: `src/lib/artigos/__tests__/enviar.test.ts`, ajustar `src/lib/__tests__/cron-diario-route.test.ts` se necessário

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `type ModoEnvio = 'rascunho' | 'agendar' | 'publicar'`.
  - `enviarArtigo(id: number, modo: ModoEnvio, opts: { sobrescrever?: boolean; cliente: ReturnType<typeof criarClienteWp>; db?: BancoCrm; agora?: Date; keyword: string }): Promise<{ tipo: 'ok'; link: string; metaGravada: boolean } | { tipo: 'bloqueado'; itens: ItemConferencia[] } | { tipo: 'conflito' } | { tipo: 'erro'; mensagem: string }>`:
    1. `agendar`/`publicar`: roda `conferir` com `slugEmUso` (do cliente, excetoId = wpPostId); se `!podePublicar` → `bloqueado`. `rascunho`: só bloqueia por `titulo_vazio`/`slug`.
    2. `agendar` exige `agendadoPara` > agora + 5 min, senão `bloqueado` com item `agendamento` ("escolha uma data futura").
    3. Se `wpPostId`: `lerPost`; `null` → `desvincularDoWp` e cria; `modificadoGmt` ≠ `wpModificadoGmt` e `!sobrescrever` → `conflito`.
    4. Conteúdo = `paraGutenberg(removerVerificar(sanitizarHtml(conteudoHtml)))`; resumo = metaDescription; status `draft|future|publish`; `dataGmt` = `agendadoPara` em ISO sem `Z` (formato `YYYY-MM-DDTHH:mm:ss`) para `future`.
    5. Sucesso → `registrarEnvio`; `ErroWp` → `registrarErroEnvio(id, erro.message)` e `{tipo:'erro', mensagem: erro.message}`.
  - `sincronizarAgendados(cliente, db?): Promise<number>` — para cada `agendado`, `lerPost`; `publish` → `registrarEnvio(... 'publish' ...)`; `null` → `desvincularDoWp`. Retorna quantos publicaram. Registrado no cron diário como fonte `artigos` (status/linhas como as outras fontes).

- [ ] **Step 1: Testes que falham** (PGlite + cliente falso em memória): `rascunho cria post draft e grava wpPostId/link`, `publicar sem revisado → bloqueado com item revisado`, `publicar com mark verificar → bloqueado`, `publicar ok atualiza tema para publicado`, `conteúdo enviado não contém <mark nem data-verificar e contém <!-- wp:paragraph -->`, `post editado no WP (modified diferente) → conflito; com sobrescrever → ok`, `post apagado no WP (lerPost null) → cria novo e troca wpPostId`, `slug em uso por outro post → bloqueado com o link`, `ErroWp credencial → erro com a mensagem fixa e artigo.erro gravado, wpPostId inalterado`, `agendar com data passada → bloqueado`, `agendar ok → agendado e dataGmt sem Z`, `sincronizarAgendados publica o que o WP publicou`.
- [ ] **Step 2–4:** FAIL → implementar → PASS + tsc + suíte inteira.
- [ ] **Step 5:** Commit `feat(artigos): envio ao WordPress com conflito e agendamento`.

### Task 7: Rotas da API

**Files:**
- Create: `src/app/api/artigos/gerar/route.ts`, `src/app/api/artigos/[id]/route.ts`, `src/app/api/artigos/[id]/enviar/route.ts`, `src/app/api/artigos/[id]/capa/route.ts`, `src/app/api/artigos/[id]/reescrever/route.ts`, `src/app/api/artigos/categorias/route.ts`
- Test: `src/app/api/artigos/__tests__/rotas.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6; `after` de `next/server`.
- Produces (todas `runtime='nodejs'`; protegidas pelo `proxy.ts` existente — não alterar o proxy):
  - `POST /api/artigos/gerar` (form: `topicId` ou `teseId`) → `reivindicarGeracao`; `reivindicado` → `after(() => executarGeracao(...))` e 303 para `/artigos/<id>`; `existe` → 303 `/artigos/<id>`; `nao_encontrado`/inválido → 303 `/artigos?gerar=erro`; sem IA → `/artigos?gerar=sem-chave`. `maxDuration = 300`.
  - `GET /api/artigos/[id]` → JSON do artigo + `conferencia` + `keyword`; `PUT` (JSON com os campos de `salvarEdicao`; `conteudoHtml` sanitizado aqui; `slug` normalizado; `agendadoPara` ISO ou null; validação Zod; 409 se `gerando`) → JSON atualizado com conferência.
  - `POST /api/artigos/[id]/enviar` (JSON `{ modo, sobrescrever? }`) → resultado de `enviarArtigo` como JSON (200 ok/bloqueado/conflito, 502 erro); sem `configWp` → 503 `{ tipo:'erro', mensagem:'WordPress não configurado' }`. `maxDuration = 60`.
  - `POST /api/artigos/[id]/capa` (multipart `arquivo`) → valida bytes mágicos (FF D8 FF; 89 50 4E 47; RIFF....WEBP) e ≤ 4 MB (413 acima) → `enviarImagem` → `salvarEdicao({capaMediaId, capaUrl})` → JSON.
  - `POST /api/artigos/[id]/reescrever` (JSON `{ trecho, instrucao }`) → `{ texto }`; 400 para tamanhos excedidos.
  - `GET /api/artigos/categorias` → `[{id,nome}]` ou 503.
- [ ] **Step 1: Testes que falham** chamando os handlers com `Request` e dependências mockadas por `vi.mock` (padrão de `src/app/api/temas/__tests__`): `gerar redireciona para /artigos/<id> e agenda after`, `gerar com 'existe' não chama executarGeracao`, `PUT sanitiza conteudoHtml com <script>`, `PUT em gerando → 409`, `capa PNG falso (extensão .png, bytes de texto) → 400`, `capa 4 MB + 1 byte → 413`, `enviar sem WP configurado → 503`, `reescrever instrução longa → 400`.
- [ ] **Step 2–4:** FAIL → implementar → PASS + tsc + `npm run build` limpo.
- [ ] **Step 5:** Commit `feat(artigos): rotas de geração, edição, capa e envio`.

### Task 8: Telas — lista, editor e atalhos

**Files:**
- Install: `@tiptap/react @tiptap/pm @tiptap/starter-kit` (versão 3 estável; leia o README do pacote instalado; o Link já vem no StarterKit 3 — confirme no pacote).
- Create: `src/app/(dash)/artigos/page.tsx`, `src/app/(dash)/artigos/[id]/page.tsx`, `src/app/(dash)/artigos/[id]/editor-artigo.tsx` (client), `src/app/(dash)/artigos/[id]/marca-verificar.ts` (Mark TipTap `verificar` ↔ `<mark data-verificar>`)
- Modify: `src/components/ui/navegacao.ts` (item "Artigos" `/artigos` no grupo SEO, depois de "Briefings"), `src/app/(dash)/tendencias/page.tsx` (botão "Gerar artigo" / "Abrir artigo" por tese), `src/app/(dash)/temas/page.tsx` (idem por tema)
- Test: `src/app/(dash)/artigos/__tests__/*.test.tsx` (Testing Library, jsdom)

**Comportamento:**
- `/artigos`: tabela com título, keyword, `Selo` de situação, atualizado em, link "ver no site" quando `wpLink`; filtro por situação (query `?situacao=`); estados vazios com `EstadoVazio`; flags `?gerar=erro|sem-chave` em `Aviso`.
- `/artigos/[id]` (server) carrega artigo, tema, `configWp()!==null`, categorias (falha → lista vazia + aviso). Em `gerando`: tela "Gerando o artigo… (leva cerca de 2 minutos)" com `<meta http-equiv="refresh" content="10">`. Em `erro_geracao`: mensagem + botão "Tentar de novo" (form POST `/api/artigos/gerar` com `topicId`).
- Editor (client): barra com Parágrafo, H2, H3, Negrito, Itálico, Lista, Lista numerada, Citação, Link (prompt de URL no próprio painel — **sem `window.prompt`**, use um campo inline), "Verificar" (remove a marca da seleção), "Reescrever trecho" (abre campo de instrução; mostra sugestão com Aceitar/Descartar; Aceitar substitui a seleção pelo texto). Lateral: campos título/slug/meta com contadores (cores aviso fora da faixa), select de categoria, capa (input file → `/capa`; mostra miniatura), lista de conferência (ícone por nível), fontes (links `target=_blank rel=noreferrer`), checkbox "Revisei o conteúdo", data/hora de agendamento (`datetime-local`, fuso America/Sao_Paulo convertido para ISO), botões "Enviar como rascunho", "Agendar", "Publicar agora" (desabilitados conforme `podePublicar` / WP não configurado com aviso "WordPress não configurado"); "Publicar agora" pede confirmação inline (segundo botão "Confirmar publicação"), nunca `confirm()`. Conflito → aviso com "Sobrescrever mesmo assim". Depois do envio: situação no WP + link; se `alteradoAposEnvio`, botão principal vira "Atualizar no site". Salvamento automático: `PUT` com debounce de 1,5 s e indicador "salvo/salvando/erro ao salvar"; antes de enviar, força salvar. Pré-visualização: aba que mostra o HTML sanitizado (sem marcas) renderizado.
- Publicado + `BREVO_API_KEY` presente: botão "Criar campanha no Brevo" postando para a rota existente de campanha do tema (`src/app/api/temas/campanha` — use o contrato dela como está).
- Atalhos: se o tema/tese já tem artigo → link "Abrir artigo"; senão form POST `/api/artigos/gerar` com `BotaoEnviar` "Gerar artigo" (desabilitado com dica se IA não configurada).
- Visual: componentes de `src/components/ui`, tokens de cor existentes, tema claro/escuro; layout em duas colunas ≥ 1024 px, uma coluna abaixo; sem rolagem horizontal em 390 px.

- [ ] **Step 1: Testes que falham:** `navegação tem Artigos em /artigos`, `lista mostra estado vazio`, `editor: Publicar desabilitado com item bloqueia e habilitado sem`, `Publicar pede confirmação antes de chamar fetch`, `conflito mostra Sobrescrever e reenvia com sobrescrever:true`, `contador de meta fica em aviso com 119`, `marca-verificar parse/render de <mark data-verificar="x">`.
- [ ] **Step 2–4:** FAIL → implementar → PASS + tsc + `npm run build` + `npx eslint` limpos.
- [ ] **Step 5:** Verificação no navegador (controlador): `npm run dev`, login com a senha do `.env.local`, gerar a partir de uma tese real, editar, salvar, ver conferência, enviar como **rascunho** ao WP (único envio real permitido), conferir que o post existe como rascunho.
- [ ] **Step 6:** Commit `feat(artigos): lista, editor e atalhos nas teses e temas`.

### Task 9: README e entrega

**Files:**
- Modify: `README.md` (seção "Artigos e WordPress": variáveis `WP_USUARIO`, `WP_SENHA_APP`, `WP_URL` opcional; como criar a senha de aplicativo; o mu-plugin opcional abaixo, com o aviso de que instalar é decisão do usuário)

Mu-plugin documentado (texto exato):

```php
<?php
/* Plugin Name: OG Painel — meta do The SEO Framework na REST */
add_action('init', function () {
  foreach (['_genesis_description', '_genesis_title'] as $chave) {
    register_post_meta('post', $chave, [
      'show_in_rest'  => true,
      'single'        => true,
      'type'          => 'string',
      'auth_callback' => fn () => current_user_can('edit_posts'),
    ]);
  }
});
```

- [ ] **Step 1:** Escrever a seção.
- [ ] **Step 2:** Commit `docs: artigos e WordPress no README`.
