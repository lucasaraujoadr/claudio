# Dashboard SEO — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o dashboard interno que mapeia oportunidades de SEO para
`ogpericiacontabil.com.br` e devolve uma lista priorizada de conteúdo a
escrever e de problemas técnicos a corrigir.

**Architecture:** Monolito Next.js 16 na Vercel. Server Components leem
direto do Neon Postgres; rotas de API fazem a escrita. Um cron diário puxa
o Google Search Console para `gsc_snapshots`; auditoria e pesquisa de temas
rodam sob demanda. Autenticação por senha única validada em `proxy.ts`.

**Tech Stack:** Next.js 16.4 (App Router, runtime Node.js), TypeScript
strict, Tailwind CSS 4.3 + shadcn/ui, Drizzle 0.45 + `@neondatabase/serverless`
1.2, AI SDK 7 + provider OpenAI, `googleapis` 188, `cheerio` 1.2, Zod 4,
Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-28-dashboard-seo-design.md`

## Global Constraints

- Runtime Node.js em toda função. Nenhum `export const runtime = 'edge'`.
- TypeScript `strict: true`. Sem `any` em código de produção.
- Repositório é **público**: nenhum segredo em arquivo versionado. `.gitignore`
  cobre `.env*` com exceção de `.env.example`.
- Cliente do banco só via `getDb()` com init tardia. Nunca `neon()` no topo
  de módulo (quebra `next build`), nunca `Proxy` em volta do client.
- Propriedade do GSC: `sc-domain:ogpericiacontabil.com.br`. Site:
  `https://ogpericiacontabil.com.br`.
- Crawler: respeita `robots.txt`, 1 requisição/segundo, teto de 300 páginas,
  só o domínio próprio, nunca `/wp-admin/`.
- Janela do GSC recua 3 dias do dia corrente (dados recentes são incompletos).
- Posição alvo do ganho estimado: 3. Faixa de oportunidade: posição 5 a 20
  **inclusive** nas duas pontas.
- Toda resposta de modelo passa por schema Zod antes de tocar o banco.
  Resposta inválida não grava nada.
- Interface em português do Brasil.

## Review Focus

Classes de entrada que a spec implica, nenhuma tarefa exercitaria por padrão,
e que machucam quem usa. Cada linha tem teste atribuído à tarefa que é dona
do código.

1. `DASHBOARD_PASSWORD` ausente ou vazia no ambiente — se `isCorrectPassword`
   comparar entrada vazia com variável vazia, o login libera o dashboard sem
   senha. Deve recusar sempre. → Tarefa 3.
2. `GOOGLE_SA_PRIVATE_KEY` colada com `\n` literal em vez de quebra de linha
   real — é o formato que o painel da Vercel produz. Sem normalizar, a
   autenticação do Google falha com erro opaco de chave inválida. → Tarefa 9.
3. Sitemap ou link interno apontando para recurso que não é HTML (PDF, imagem)
   — o parser não pode tentar ler e quebrar o rastreamento inteiro. Deve
   registrar e seguir. → Tarefa 7.
4. Redirecionamento 301/302 dentro do site durante o rastreamento — sem
   normalizar destino, a mesma página entra duas vezes e a de origem aparece
   como órfã falsa. → Tarefa 7.
5. Termo do GSC exatamente na posição 5,0 ou 20,0 — limite da faixa. Fora por
   um, e as melhores oportunidades somem da tela. → Tarefa 8.

---

### Task 1: Scaffold do projeto

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`,
  `src/app/layout.tsx`, `src/app/globals.css`, `.env.example`
- Test: `src/lib/__tests__/scaffold.test.ts`

**Interfaces:**
- Produces: scripts `npm run build`, `npm test`, `npm run dev`. Alias de
  import `@/*` → `src/*`.

- [ ] **Step 1: Criar o app**

Rodar `npx -y create-next-app@16.4.3 . --ts --tailwind --app --src-dir --eslint --use-npm --yes`
e confirmar que `tsconfig.json` traz `"paths": { "@/*": ["./src/*"] }`.

O diretório `src/` vem do próprio gerador (`--src-dir`); não mover arquivo à
mão. Se o gerador reclamar que o diretório não está vazio, ele aceita
prosseguir — a spec, o plano e o `.gitignore` já versionados devem
permanecer intactos. Conferir com `git status` depois.

Se `src/lib/utils.ts` já vier gerado com `cn`, manter o que veio e seguir
para o passo 3; o teste do passo 4 vale para as duas implementações.

- [ ] **Step 2: Instalar dependências**

```bash
npm i drizzle-orm @neondatabase/serverless googleapis cheerio zod ai @vercel/config
npm i -D drizzle-kit vitest @vitejs/plugin-react dotenv-cli @types/node
```

- [ ] **Step 3: Configurar Vitest**

`vitest.config.ts` com ambiente `node`, `globals: true` e alias `@` → `./src`.
Adicionar `"test": "vitest run"` e `"test:watch": "vitest"` em `package.json`.

- [ ] **Step 4: Escrever o teste de fumaça**

```ts
// src/lib/__tests__/scaffold.test.ts
import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('scaffold', () => {
  it('resolve o alias @ e executa utilitário', () => {
    expect(cn('a', 'b')).toBe('a b')
  })
})
```

Criar `src/lib/utils.ts` com `cn(...classes: (string | false | null | undefined)[]): string`
que filtra valores falsos e junta com espaço.

- [ ] **Step 5: Verificar**

Run: `npm test && npm run build`
Expected: teste PASS, build sem erro.

- [ ] **Step 6: Escrever `.env.example`**

Os nove nomes da seção 11 da spec, todos com valor vazio.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: scaffold Next.js 16 com Tailwind e Vitest"
```

---

### Task 2: Schema do banco e cliente Neon

**Files:**
- Create: `src/lib/db/schema.ts`, `src/lib/db/index.ts`, `drizzle.config.ts`
- Test: `src/lib/db/__tests__/index.test.ts`

**Interfaces:**
- Produces: `getDb(): NeonHttpDatabase<typeof schema>`. Tabelas exportadas de
  `schema.ts`: `gscSnapshots`, `clusters`, `topics`, `briefings`, `auditRuns`,
  `auditPages`, `auditIssues`. Enums pgEnum: `intencao`, `prioridade`,
  `topicStatus`, `topicOrigem`, `clusterStatus`, `severidade`, `runStatus`.
  Tipos inferidos, exportados de `schema.ts` e usados pelas tarefas 10 a 13:
  `type Topic = typeof topics.$inferSelect`, `type Cluster = typeof clusters.$inferSelect`,
  `type AuditPage = typeof auditPages.$inferSelect`.

- [ ] **Step 1: Provisionar o Neon**

```bash
npx vercel@latest link --yes
npx vercel@latest integration add neon --yes --no-claim
npx vercel@latest env pull .env.local --yes
```

Se o comando pedir passo no navegador, parar e pedir ao usuário que conclua.

- [ ] **Step 2: Escrever `schema.ts`**

As sete tabelas e sete enums exatamente como a seção 5 da spec define,
incluindo `UNIQUE (snapshot_date, query, page)` em `gscSnapshots` e
`auditIssues.pageId` anulável.

- [ ] **Step 3: Escrever o teste da init tardia**

```ts
describe('getDb', () => {
  it('importar o módulo sem DATABASE_URL não lança', async () => {
    delete process.env.DATABASE_URL
    await expect(import('@/lib/db')).resolves.toBeDefined()
  })

  it('getDb() lança só quando chamado sem DATABASE_URL', async () => {
    delete process.env.DATABASE_URL
    const { getDb } = await import('@/lib/db')
    expect(() => getDb()).toThrow()
  })
})
```

- [ ] **Step 4: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/db` — Expected: FAIL, módulo inexistente.

- [ ] **Step 5: Implementar `getDb()` em `src/lib/db/index.ts`**

Função `createDb()` + `let _db` module-level, conforme o padrão da skill
`vercel-storage`. Sem `Proxy`.

- [ ] **Step 6: Aplicar as migrações**

Run: `npx dotenv -e .env.local -- npx drizzle-kit push`
Expected: sete tabelas criadas.

- [ ] **Step 7: Verificar e commitar**

Run: `npm test && npm run build` — Expected: PASS.

```bash
git add -A && git commit -m "feat: schema Drizzle e cliente Neon com init tardia"
```

---

### Task 3: Autenticação por senha única

**Files:**
- Create: `src/lib/auth.ts`, `src/proxy.ts`, `src/app/login/page.tsx`,
  `src/app/api/login/route.ts`, `src/app/api/logout/route.ts`
- Test: `src/lib/__tests__/auth.test.ts`

**Interfaces:**
- Produces:
  - `isCorrectPassword(entrada: string): boolean`
  - `criarTokenSessao(agora?: Date): string` — formato `${expMs}.${hmacHex}`
  - `tokenSessaoValido(token: string | null | undefined, agora?: Date): boolean`
  - `COOKIE_SESSAO = 'og_seo_sessao'`

- [ ] **Step 1: Escrever os testes**

```ts
describe('isCorrectPassword', () => {
  it('aceita a senha correta', () => {
    process.env.DASHBOARD_PASSWORD = 'segredo-real'
    expect(isCorrectPassword('segredo-real')).toBe(true)
  })
  it('recusa senha errada', () => {
    process.env.DASHBOARD_PASSWORD = 'segredo-real'
    expect(isCorrectPassword('outra')).toBe(false)
  })
  // Review Focus 1
  it('recusa tudo quando DASHBOARD_PASSWORD não está definida', () => {
    delete process.env.DASHBOARD_PASSWORD
    expect(isCorrectPassword('')).toBe(false)
    expect(isCorrectPassword('qualquer')).toBe(false)
  })
  it('recusa tudo quando DASHBOARD_PASSWORD está vazia', () => {
    process.env.DASHBOARD_PASSWORD = ''
    expect(isCorrectPassword('')).toBe(false)
  })
})

describe('tokenSessaoValido', () => {
  it('aceita token recém-criado', () => {
    expect(tokenSessaoValido(criarTokenSessao())).toBe(true)
  })
  it('recusa token com assinatura adulterada', () => {
    const t = criarTokenSessao()
    expect(tokenSessaoValido(t.slice(0, -1) + '0')).toBe(false)
  })
  it('recusa token expirado', () => {
    const passado = new Date(Date.now() - 31 * 24 * 3600 * 1000)
    expect(tokenSessaoValido(criarTokenSessao(passado))).toBe(false)
  })
  it('recusa ausente e malformado', () => {
    expect(tokenSessaoValido(undefined)).toBe(false)
    expect(tokenSessaoValido('sem-ponto')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/__tests__/auth.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar `src/lib/auth.ts`**

HMAC-SHA256 com `AUTH_SECRET` via `node:crypto`. Comparação da senha com
`crypto.timingSafeEqual` sobre buffers de mesmo tamanho (hashear os dois
lados antes de comparar resolve o tamanho). `isCorrectPassword` retorna
`false` de saída se `DASHBOARD_PASSWORD` for ausente ou vazia — essa guarda
vem antes de qualquer comparação.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/__tests__/auth.test.ts` — Expected: PASS.

- [ ] **Step 5: Implementar `src/proxy.ts`**

Libera `/login`, `/api/login`, `/api/cron/*` e assets do Next. Todo o resto
exige cookie válido, senão redireciona para `/login`.

- [ ] **Step 6: Implementar login e logout**

`POST /api/login` valida a senha e grava o cookie (`httpOnly`, `secure`,
`sameSite=lax`, `maxAge` 30 dias). `POST /api/logout` apaga o cookie.
`/login` é um formulário simples com campo de senha e mensagem de erro.

- [ ] **Step 7: Verificar e commitar**

Run: `npm test && npm run build` — Expected: PASS.

```bash
git add -A && git commit -m "feat: autenticacao por senha unica com cookie assinado"
```

---

### Task 4: Primeiro deploy na Vercel

**Files:**
- Create: `vercel.ts`
- Modify: `.gitignore` (confirmar `.vercel/`)

**Interfaces:**
- Produces: URL de produção com `/login` funcionando. Cron declarado em
  `vercel.ts`, consumido na Tarefa 9.

- [ ] **Step 1: Escrever `vercel.ts`**

`@vercel/config`, framework `nextjs`, e um cron:
`{ path: '/api/cron/gsc', schedule: '0 6 * * *' }`.

- [ ] **Step 2: Publicar o repositório**

```bash
git push -u origin main
```

- [ ] **Step 3: Definir as variáveis de ambiente**

`AUTH_SECRET` gerada com `openssl rand -hex 32`. `DASHBOARD_PASSWORD`,
`OPENAI_API_KEY`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` vêm do usuário
— pedir e parar se faltarem as duas primeiras. `GSC_PROPERTY` e `SITE_URL`
têm valor fixo nas Global Constraints.

- [ ] **Step 4: Deploy**

Run: `npx vercel@latest deploy --prod --yes`

- [ ] **Step 5: Verificar no ar**

Run: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' <URL>/`
Expected: `307` com redirect para `/login`. Acessar `/login` devolve 200.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: configuracao da Vercel com cron diario" && git push
```

---

### Task 5: Extração de sinais do HTML

**Files:**
- Create: `src/lib/crawler/parse.ts`
- Test: `src/lib/crawler/__tests__/parse.test.ts`, `src/lib/crawler/__tests__/fixtures/`

**Interfaces:**
- Produces:
```ts
type SinaisPagina = {
  url: string
  statusCode: number
  title: string | null
  metaDescription: string | null
  h1Textos: string[]
  palavras: number
  canonical: string | null
  noindex: boolean
  linksInternos: string[]   // absolutos, normalizados, mesmo domínio
  imagensSemAlt: number
  schemaTypes: string[]     // valores de @type do JSON-LD
}
extrairSinais(url: string, html: string, statusCode: number): SinaisPagina
```

- [ ] **Step 1: Baixar fixtures reais**

Salvar o HTML de `/`, `/servicos/` e um post do blog em
`__tests__/fixtures/`. Fixtures reais em vez de HTML inventado: o site usa
Elementor, que gera marcação que HTML de exemplo não reproduz.

- [ ] **Step 2: Escrever os testes**

```ts
it('extrai title, meta e h1 da home', () => { /* valores das fixtures */ })
it('conta palavras do corpo ignorando script, style e nav', () => {})
it('devolve canonical null quando a tag não existe', () => {})
it('detecta noindex em meta robots', () => {})
it('resolve links relativos para absolutos e descarta externos', () => {})
it('normaliza link interno removendo fragmento e barra final', () => {})
it('lê @type de JSON-LD, inclusive dentro de @graph', () => {})
it('conta imagens sem alt, ignorando alt=""  decorativo', () => {})
it('não lança em HTML truncado', () => {})
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/crawler` — Expected: FAIL.

- [ ] **Step 4: Implementar `extrairSinais`**

`cheerio` para o DOM. Normalização de link: resolver contra a URL da página
com `new URL`, descartar fragmento, rebaixar para minúsculas no host,
garantir barra final em caminho sem extensão. Essa normalização é a mesma
que a Tarefa 7 usa para deduplicar — expor como `normalizarUrl(bruta: string, base: string): string | null`,
retornando `null` para domínio externo ou esquema não-HTTP.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/crawler` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: extracao de sinais de SEO do HTML"
```

---

### Task 6: As 17 regras de auditoria

**Files:**
- Create: `src/lib/crawler/rules.ts`
- Test: `src/lib/crawler/__tests__/rules.test.ts`

**Interfaces:**
- Consumes: `SinaisPagina` da Tarefa 5.
- Produces:
```ts
type Problema = {
  url: string | null            // null = problema do site inteiro
  severidade: 'critico' | 'aviso' | 'info'
  regra: string
  mensagem: string
}
type ContextoAuditoria = {
  urlInicial: string
  sitemapResolvido: boolean
  urlsSitemap: string[]
  urlsMenu: string[]
  statusPorUrl: Record<string, number>
}
avaliar(paginas: SinaisPagina[], ctx: ContextoAuditoria): Problema[]
```

- [ ] **Step 1: Escrever um teste por regra, com caso positivo e negativo**

As 17 regras e seus limites exatos estão na seção 6.4 da spec. Testes que
não podem faltar, porque são onde a regra erra:

```ts
it('title-tamanho aceita 30 e 60 caracteres, acusa 29 e 61', () => {})
it('title-duplicado acusa as duas páginas, não só a segunda', () => {})
it('meta-tamanho aceita 70 e 160', () => {})
it('h1-ausente separa de h1-multiplo', () => {})
it('conteudo-raso aceita 300 palavras e acusa 299', () => {})
// Review Focus 4
it('pagina-orfa não acusa a URL inicial do rastreamento', () => {})
it('pagina-orfa não acusa página que recebe link de qualquer outra', () => {})
it('noindex-inesperado só acusa página 200 que está no sitemap ou no menu', () => {})
it('noindex-inesperado ignora página fora do sitemap e do menu', () => {})
it('schema-ausente usa o mapa de padrão de URL da spec', () => {})
it('schema-ausente não acusa URL que não casa com nenhum padrão', () => {})
it('link-quebrado usa statusPorUrl e acusa 404 e 500', () => {})
it('sitemap-invalido emite problema com url null quando sitemapResolvido é false', () => {})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/crawler/__tests__/rules.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar `avaliar`**

Cada regra é uma função pura pequena no mesmo arquivo; `avaliar` as compõe.
Regras de duplicidade (`title-duplicado`, `meta-duplicada`) precisam da
coleção inteira e rodam depois das por página. `rules.ts` não faz rede.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/crawler` — Expected: PASS, 17 regras cobertas.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: 17 regras de auditoria tecnica de SEO"
```

---

### Task 7: Rastreamento, rota e tela de auditoria

**Files:**
- Create: `src/lib/crawler/crawl.ts`, `src/app/api/auditoria/run/route.ts`,
  `src/app/(dash)/auditoria/page.tsx`, `src/app/(dash)/layout.tsx`
- Test: `src/lib/crawler/__tests__/crawl.test.ts`

**Interfaces:**
- Consumes: `extrairSinais`, `normalizarUrl` (Tarefa 5); `avaliar`,
  `ContextoAuditoria` (Tarefa 6); `getDb` (Tarefa 2).
- Produces: `rastrear(opts: { siteUrl: string; maxPaginas?: number; fetchImpl?: typeof fetch }): Promise<{ paginas: SinaisPagina[]; ctx: ContextoAuditoria }>`

- [ ] **Step 1: Escrever os testes com `fetchImpl` falso**

`fetchImpl` existe no parâmetro para permitir estes testes sem rede.

```ts
it('começa pelo sitemap do robots.txt quando ele resolve', () => {})
it('marca sitemapResolvido false e parte da home quando o sitemap dá 404', () => {})
it('para no teto de maxPaginas', () => {})
it('não sai do domínio nem entra em /wp-admin/', () => {})
it('não visita a mesma URL duas vezes', () => {})
// Review Focus 3
it('registra e segue adiante quando a resposta é application/pdf', () => {})
it('registra e segue adiante quando a resposta não é HTML', () => {})
// Review Focus 4
it('segue 301 e registra a página sob a URL de destino, não a de origem', () => {})
it('não gera órfã falsa para a URL que redirecionou', () => {})
it('preenche statusPorUrl com o código de cada URL visitada', () => {})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/crawler/__tests__/crawl.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar `rastrear`**

Fila sequencial com 1 req/s. Antes de ler o corpo, checar
`content-type`: sem `text/html`, registrar status e seguir sem chamar
`extrairSinais`. Redirecionamento: usar `redirect: 'follow'` e indexar a
página pela URL final (`response.url`) normalizada, registrando a URL de
origem em `statusPorUrl` com o código do redirecionamento, para que ela não
conte como órfã. Honrar `Disallow` do `robots.txt`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/crawler` — Expected: PASS.

- [ ] **Step 5: Implementar `POST /api/auditoria/run`**

Cria `audit_run` com status `rodando`, chama `rastrear`, grava `audit_pages`,
chama `avaliar`, grava `audit_issues`, fecha a run como `concluido`. Em
exceção, marca `falhou` e preserva a run anterior. Rejeita início se já
existir run `rodando`.

- [ ] **Step 6: Implementar a tela**

`(dash)/layout.tsx` com navegação lateral para os cinco módulos.
`/auditoria` lista problemas agrupados por severidade, com botão de
rastrear, data da última run e contagem de páginas. Estado vazio distingue
"nenhum problema" de "nunca rastreado".

- [ ] **Step 7: Implementar `src/app/(dash)/error.tsx`**

Fronteira de erro do grupo de rotas, exigida pela seção 9 da spec: falha de
banco mostra que a consulta não pôde ser feita, com botão de tentar
novamente. Nunca renderiza zero nem lista vazia quando a causa foi erro —
"não consegui consultar" e "não há dados" são telas diferentes.

Teste em `src/app/__tests__/error.test.ts`: renderizar o componente com um
erro e afirmar que a mensagem não contém "0" como resultado e que o botão de
retry existe.

- [ ] **Step 8: Verificar no ar**

Deploy, abrir `/auditoria`, rodar o rastreamento. Expected: `sitemap-invalido`
aparece como crítico, confirmando o achado da spec.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: rastreamento e tela de auditoria tecnica" && git push
```

---

### Task 8: Curva de CTR e ganho estimado

**Files:**
- Create: `src/lib/ctr.ts`
- Test: `src/lib/__tests__/ctr.test.ts`

**Interfaces:**
- Produces:
  - `CTR_POR_POSICAO: readonly number[]` — índice 1 a 20
  - `ctrNaPosicao(posicao: number): number`
  - `ganhoEstimado(e: { impressoes: number; ctrAtual: number; posicaoAlvo?: number }): number`
  - `ehOportunidade(posicao: number): boolean`

- [ ] **Step 1: Escrever os testes**

```ts
describe('ehOportunidade', () => {
  // Review Focus 5
  it('inclui os limites 5 e 20', () => {
    expect(ehOportunidade(5)).toBe(true)
    expect(ehOportunidade(20)).toBe(true)
  })
  it('exclui 4,9 e 20,1', () => {
    expect(ehOportunidade(4.9)).toBe(false)
    expect(ehOportunidade(20.1)).toBe(false)
  })
})

describe('ganhoEstimado', () => {
  it('calcula impressoes x delta de CTR até a posição 3', () => {
    expect(ganhoEstimado({ impressoes: 1000, ctrAtual: 0.02 })).toBeCloseTo(90)
  })
  it('devolve 0 e nunca negativo quando o CTR atual já supera o alvo', () => {
    expect(ganhoEstimado({ impressoes: 1000, ctrAtual: 0.5 })).toBe(0)
  })
  it('devolve 0 com zero impressões', () => {
    expect(ganhoEstimado({ impressoes: 0, ctrAtual: 0.01 })).toBe(0)
  })
})

describe('ctrNaPosicao', () => {
  it('usa o valor da posição 20 para posições acima de 20', () => {})
  it('usa o valor da posição 1 para posição menor que 1', () => {})
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/__tests__/ctr.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar `src/lib/ctr.ts`**

Curva fixa, com comentário declarando que é estimativa de mercado e não
medição do site:

```ts
export const CTR_POR_POSICAO = [
  0,     0.280, 0.152, 0.110, 0.080, 0.061,
  0.048, 0.040, 0.033, 0.028, 0.025, 0.021,
  0.018, 0.016, 0.014, 0.013, 0.012, 0.011,
  0.010, 0.009, 0.008,
] as const
```

`posicaoAlvo` tem padrão 3. `ganhoEstimado` usa
`impressoes * Math.max(0, ctrNaPosicao(alvo) - ctrAtual)`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/__tests__/ctr.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: curva de CTR e calculo de ganho estimado"
```

---

### Task 9: Cliente do Search Console e cron

**Files:**
- Create: `src/lib/gsc.ts`, `src/app/api/cron/gsc/route.ts`
- Test: `src/lib/__tests__/gsc.test.ts`

**Interfaces:**
- Consumes: `getDb`, `gscSnapshots` (Tarefa 2).
- Produces:
```ts
type LinhaGsc = { query: string; page: string; clicks: number; impressions: number; ctr: number; position: number }
normalizarChavePrivada(bruta: string): string
janelas(hoje: Date): { atual: { inicio: string; fim: string }; anterior: { inicio: string; fim: string } }
buscarSearchAnalytics(o: { property: string; inicio: string; fim: string }): Promise<LinhaGsc[]>
```

- [ ] **Step 1: Escrever os testes**

```ts
describe('normalizarChavePrivada', () => {
  // Review Focus 2
  it('converte \\n literal em quebra de linha real', () => {
    const r = normalizarChavePrivada('-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----')
    expect(r).toContain('\n')
    expect(r).not.toContain('\\n')
  })
  it('deixa intacta a chave que já tem quebras reais', () => {})
  it('remove aspas envolventes que o painel adiciona', () => {})
})

describe('janelas', () => {
  it('a janela atual termina 3 dias antes de hoje', () => {
    const { atual } = janelas(new Date('2026-10-28'))
    expect(atual.fim).toBe('2026-10-25')
  })
  it('a janela atual tem 28 dias', () => {
    const { atual } = janelas(new Date('2026-10-28'))
    expect(atual.inicio).toBe('2026-09-28')
  })
  it('a anterior é os 28 dias imediatamente antes, sem sobrepor', () => {
    const { atual, anterior } = janelas(new Date('2026-10-28'))
    expect(anterior.fim < atual.inicio).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/__tests__/gsc.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar `src/lib/gsc.ts`**

`google.auth.JWT` com `GOOGLE_SA_EMAIL`, `normalizarChavePrivada(GOOGLE_SA_PRIVATE_KEY)`
e escopo `https://www.googleapis.com/auth/webmasters.readonly`. Chamar
`searchanalytics.query` com `dimensions: ['query','page']` e `rowLimit: 25000`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/__tests__/gsc.test.ts` — Expected: PASS.

- [ ] **Step 5: Implementar `GET /api/cron/gsc`**

Exige `Authorization: Bearer ${CRON_SECRET}`, senão 401. Busca as duas
janelas, grava a atual em `gscSnapshots` com `onConflictDoUpdate` sobre
`(snapshot_date, query, page)`, e devolve os totais da anterior no corpo da
resposta para inspeção manual.

- [ ] **Step 6: Configurar o acesso do Google e verificar no ar**

Pedir ao usuário: criar conta de serviço, habilitar a Search Console API, e
adicionar o email da conta como usuário restrito na propriedade. Então:

Run: `curl -H "Authorization: Bearer $CRON_SECRET" <URL>/api/cron/gsc`
Expected: 200 com contagem de linhas maior que zero.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: cliente do Search Console e cron diario" && git push
```

---

### Task 10: Tela de oportunidades

**Files:**
- Create: `src/app/(dash)/oportunidades/page.tsx`,
  `src/lib/oportunidades.ts`, `src/app/api/temas/criar-de-query/route.ts`
- Test: `src/lib/__tests__/oportunidades.test.ts`

**Interfaces:**
- Consumes: `ehOportunidade`, `ganhoEstimado` (Tarefa 8); `LinhaGsc`
  (Tarefa 9); `getDb`, `gscSnapshots`, `topics` (Tarefa 2).
- Produces: `montarOportunidades(linhas: LinhaGsc[]): Oportunidade[]` com
  `type Oportunidade = LinhaGsc & { ganho: number }`, ordenado por `ganho`
  decrescente.

- [ ] **Step 1: Escrever os testes**

```ts
it('filtra apenas a faixa de oportunidade', () => {})
it('ordena por ganho estimado decrescente', () => {})
it('mantém a URL que já ranqueia em cada linha', () => {})
it('devolve lista vazia quando nenhuma linha está na faixa', () => {})
```

- [ ] **Step 2: Rodar, confirmar que falha, implementar, confirmar que passa**

Run: `npx vitest run src/lib/__tests__/oportunidades.test.ts`

- [ ] **Step 3: Implementar a tela**

Server Component lendo o `snapshot_date` mais recente. Tabela com termo,
URL, impressões, posição, CTR e ganho estimado. Cabeçalho mostra a data do
snapshot. Se o snapshot mais recente tiver mais de 2 dias, exibir aviso da
data em vez de apresentar como atual. Sem nenhum snapshot, dizer que o GSC
ainda não foi sincronizado — não mostrar zero.

- [ ] **Step 4: Implementar `POST /api/temas/criar-de-query`**

Cria `topic` com `origem: 'gsc'`, `status: 'ideia'`, `keyword` = o termo.
Idempotente por `keyword`.

- [ ] **Step 5: Verificar no ar e commitar**

```bash
git add -A && git commit -m "feat: tela de oportunidades com ganho estimado" && git push
```

---

### Task 11: Pesquisa de temas com IA

**Files:**
- Create: `src/lib/ai/cliente.ts`, `src/lib/ai/schemas.ts`,
  `src/lib/ai/temas.ts`, `src/app/api/temas/pesquisar/route.ts`,
  `src/app/(dash)/temas/page.tsx`
- Test: `src/lib/ai/__tests__/schemas.test.ts`, `src/lib/ai/__tests__/temas.test.ts`

**Interfaces:**
- Consumes: `getDb`, `clusters`, `topics` (Tarefa 2).
- Produces:
  - Em `src/lib/ai/cliente.ts`, o ponto único de injeção que torna as
    tarefas 11 e 12 testáveis sem chamar a OpenAI:
    ```ts
    type GerarObjeto = <T>(opts: { schema: z.ZodType<T>; prompt: string }) => Promise<T>
    export const gerarObjetoPadrao: GerarObjeto   // envolve generateObject do AI SDK
    ```
    O modelo é lido de `OPENAI_MODEL`, com padrão `gpt-4.1`.
  - `clustersSchema` (Zod) e `type ClustersGerados = z.infer<typeof clustersSchema>`
  - `type ContextoTemas = { servicos: string[]; termosGsc: string[]; temasExistentes: string[]; lacunasAuditoria: string[] }`
  - `pesquisarTemas(ctx: ContextoTemas, gerar?: GerarObjeto): Promise<ClustersGerados>`
  - `dedupTemas(gerados: ClustersGerados, existentes: string[]): ClustersGerados`

- [ ] **Step 1: Confirmar a API do AI SDK instalado**

Ler `node_modules/ai/docs/` e o README do provider OpenAI instalado para
confirmar a assinatura de `generateObject` e o nome do pacote do provider
nesta versão. `ai@7` e `@ai-sdk/openai@4` são majors diferentes — não
assumir a API de memória. Instalar o provider que os docs indicarem.

- [ ] **Step 2: Escrever os testes**

```ts
describe('clustersSchema', () => {
  it('aceita resposta bem formada', () => {})
  it('rejeita cluster sem keyword pilar', () => {})
  it('rejeita intencao fora do enum', () => {})
  it('rejeita prioridade fora do enum', () => {})
  it('rejeita cluster sem nenhum tema', () => {})
})

describe('dedupTemas', () => {
  it('remove tema cuja keyword já existe, ignorando caixa e acento', () => {})
  it('remove cluster que ficou sem tema após a deduplicação', () => {})
  it('preserva tema novo', () => {})
})

describe('pesquisarTemas', () => {
  it('passa serviços, termos do GSC e temas existentes no prompt', () => {})
  it('propaga erro sem retornar objeto parcial quando o schema falha', () => {})
})
```

`pesquisarTemas` recebe `gerar` injetável para permitir estes testes sem
chamar a OpenAI.

- [ ] **Step 3: Rodar, confirmar que falha, implementar, confirmar que passa**

Run: `npx vitest run src/lib/ai`

`pesquisarTemas` monta o prompt com os quatro contextos da seção 6.3 da spec
e chama `generateObject` com `clustersSchema`.

- [ ] **Step 4: Implementar `POST /api/temas/pesquisar`**

Lê contexto do banco, chama `pesquisarTemas`, aplica `dedupTemas`, grava
clusters e topics em **uma transação**. Falha não deixa cluster órfão.

- [ ] **Step 5: Implementar a tela**

Clusters com seus temas, filtro por status, botão de pesquisar, e controle
para mover status (`ideia → escolhido`, `briefado → publicado` com campo de
URL obrigatório).

- [ ] **Step 6: Verificar no ar e commitar**

```bash
git add -A && git commit -m "feat: pesquisa de temas e clusters com IA" && git push
```

---

### Task 12: Briefings

**Files:**
- Create: `src/lib/ai/briefing.ts`, `src/app/api/briefings/gerar/route.ts`,
  `src/app/(dash)/briefings/page.tsx`
- Modify: `src/lib/ai/schemas.ts` (criado na Tarefa 11 — acrescentar
  `briefingSchema` e `BriefingGerado`, sem tocar em `clustersSchema`)
- Test: `src/lib/ai/__tests__/briefing.test.ts`

**Interfaces:**
- Consumes: `GerarObjeto` e `gerarObjetoPadrao` de `ai/cliente.ts`, padrão de
  `schemas.ts` (Tarefa 11); `auditPages` (Tarefa 7); `Topic`, `topics`,
  `briefings` (Tarefa 2).
- Produces:
  - `briefingSchema` (Zod) em `schemas.ts` e
    `type BriefingGerado = z.infer<typeof briefingSchema>`
  - `gerarBriefing(ctx: { topico: Topic; urlsDoSite: string[] }, gerar?: GerarObjeto): Promise<BriefingGerado>`
  - `briefingParaMarkdown(b: BriefingGerado): string`

- [ ] **Step 1: Escrever os testes**

```ts
it('briefingSchema rejeita outline vazio', () => {})
it('briefingSchema rejeita title acima de 60 caracteres', () => {})
it('descarta link interno sugerido que não está em urlsDoSite', () => {})
it('aceita briefing sem link interno quando nenhum sugerido é válido', () => {})
it('briefingParaMarkdown inclui title, meta, H2s e FAQ', () => {})
```

O terceiro teste é a garantia da seção 6.5: link interno vem de
`audit_pages`, nunca da invenção do modelo.

- [ ] **Step 2: Rodar, confirmar que falha, implementar, confirmar que passa**

Run: `npx vitest run src/lib/ai/__tests__/briefing.test.ts`

- [ ] **Step 3: Implementar `POST /api/briefings/gerar`**

Exige topico com status `escolhido`. Grava o briefing e move o topico para
`briefado` na mesma transação.

- [ ] **Step 4: Implementar a tela**

Briefing renderizado com botão de copiar Markdown.

- [ ] **Step 5: Verificar no ar e commitar**

```bash
git add -A && git commit -m "feat: geracao de briefing de conteudo" && git push
```

---

### Task 13: Visão geral

**Files:**
- Create: `src/app/(dash)/page.tsx`, `src/lib/visao-geral.ts`
- Test: `src/lib/__tests__/visao-geral.test.ts`

**Interfaces:**
- Consumes: todas as tabelas (Tarefa 2); `janelas` (Tarefa 9).
- Produces: `calcularVariacao(atual: number, anterior: number): { delta: number; percentual: number | null }`

- [ ] **Step 1: Escrever os testes**

```ts
it('calcula variação percentual positiva e negativa', () => {})
it('devolve percentual null quando o período anterior é zero', () => {})
it('devolve percentual 0 quando os dois períodos são iguais', () => {})
```

O segundo caso importa: dividir por zero mostraria `Infinity%` na tela.

- [ ] **Step 2: Rodar, confirmar que falha, implementar, confirmar que passa**

Run: `npx vitest run src/lib/__tests__/visao-geral.test.ts`

- [ ] **Step 3: Implementar a tela**

Cliques e impressões com variação, contadores de oportunidades abertas,
problemas críticos e temas por status, e as datas do último snapshot e da
última auditoria. Cada bloco cuja fonte não tem dado diz isso explicitamente
em vez de exibir zero.

- [ ] **Step 4: Verificação final**

Run: `npm test && npm run build`
Expected: PASS. Deploy e percorrer os cinco módulos no ar.

- [ ] **Step 5: Escrever o README**

Como rodar local, as nove variáveis, e o passo a passo da conta de serviço
do Google.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: visao geral e README" && git push
```
