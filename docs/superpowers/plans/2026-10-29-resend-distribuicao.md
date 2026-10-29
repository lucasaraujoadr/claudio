# Resend + Distribuição — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Trocar o Brevo pelo Resend, com funis enviados pelo painel, newsletter por broadcast e descadastro próprio.
- Transformar o artigo aprovado em peças de distribuição: artigo e post para o LinkedIn, carrossel com arte e newsletter.

**Architecture:**
- **Cliente HTTP:** `src/lib/resend.ts` (fetch injetável).
- **Motor de funis:** `src/lib/crm/envios-funil.ts`, com a tabela `envios_funil` e idempotência.
- **Sincronização da newsletter:** o segmento é sincronizado pela fila `sync_status` existente.
- **Webhook:** `/api/webhooks/resend`, com assinatura Svix verificada à mão.
- **Descadastro:** páginas e rotas públicas com token HMAC.
- **Distribuição:** fica em `src/lib/distribuicao/*`.
  - Geração das peças: IA via `gerarObjetoPadrao`, com schemas estritos e nuláveis.
  - Arte: Satori (`next/og` `ImageResponse`) em 1080×1350.
  - Arquivos: PDF com `pdf-lib` e ZIP com `fflate`.

**Tech Stack:** Next.js 16.4.3 (Node runtime), Drizzle + Neon, AI SDK 7 via OpenRouter, Vitest + PGlite, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-29-resend-distribuicao-design.md`

## Global Constraints

- **Antes do Next:** leia `node_modules/next/dist/docs/` antes de usar API do Next, conforme o AGENTS.md.
- **Runtime:** toda rota usa `runtime = 'nodejs'`.
- **Idioma:** textos em pt-BR; identificadores em português.
- **Segredos:** `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` e `DESCADASTRO_SEGREDO` nunca aparecem em log, resposta, erro gravado ou bundle do cliente. Os logs usam só `e.name` ou uma frase própria.
- **LGPD:**
  - Contato `descadastrado` ou com `dados_apagados_em` nunca recebe email, por nenhum caminho; a checagem é refeita imediatamente antes de cada envio.
  - Para o Resend vai só email, nome e escritório.
  - Prompts de IA não levam dado de contato.
- **Schemas da IA:** sem `.optional()`. Use `.nullable()` em todo campo opcional e nada de min/max no schema enviado ao modelo. A validação estrita vem depois. O teste `src/lib/artigos/__tests__/schemas-estritos.test.ts` deve cobrir todo schema novo enviado ao modelo.
- **Banco:**
  - Mudança de schema só pelo arquivo `schema.ts`. O push é do usuário: **nunca rode `drizzle-kit push` nem DDL**.
  - Os testes usam PGlite gerado do schema.
- **Ambiente:** nunca leia o `.env.local`. Nunca chame o Resend, o WordPress ou a IA reais em teste.
- **Rotas públicas:** só `/descadastro`, `/api/publico/*` e `/api/webhooks/*`. Cada uma exige token ou assinatura, comparada em tempo constante.
- **Carrossel:**
  - Tamanho 1080×1350.
  - Cores: fundo escuro `#0E0F11`, claro `#F5F3EE`, dourado `#DAA522`.
  - Fontes: Source Serif 4 (títulos) e IBM Plex Sans (texto), em TTF dentro do repositório com a licença OFL.
- **Limites das peças:** ficam no Task 9, copiados da spec §3.1.
- **Commits:** terminam com uma linha em branco seguida de `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use `git add` só de caminhos específicos e nunca adicione `.superpowers`.

## Review Focus

1. **Contato descadastrado entre a fila e o envio.** O descadastro feito no meio da rotina diária não deixa sair o email (Task 4).
2. **Webhook repetido ou fora de ordem.** O mesmo `svix-id` não grava duas vezes, e um timestamp com mais de 5 minutos é recusado (Task 6).
3. **Link de descadastro aberto por antivírus.** Um GET não descadastra; só o POST com o token descadastra (Task 3).
4. **Texto longo demais numa lâmina.** Gera aviso, nunca corte silencioso nem texto vazando da arte (Task 10).
5. **Rotina diária no limite do plano.** Respeita `RESEND_LIMITE_DIARIO`, prioriza boas-vindas e deixa o resto para amanhã sem perder nada (Task 4).

---

## Parte A — Resend

### Task 1: Cliente do Resend

**Files:** Create `src/lib/resend.ts`; Test `src/lib/__tests__/resend.test.ts`

**Interfaces:**
- **Produces:**
  - `type ConfigResend = { chave: string; remetente: string; responderPara: string | null }`.
  - `configResend(env = process.env): ConfigResend | null`. Retorna null sem `RESEND_API_KEY` ou sem `RESEND_REMETENTE`.
  - `class ErroResend extends Error { tipo: 'credencial' | 'limite' | 'invalido' | 'nao_encontrado' | 'rede' | 'servidor' }`, com mensagens fixas em pt-BR. Para `credencial`: "chave do Resend inválida ou sem permissão".
  - `criarClienteResend(cfg, f = fetch)`, com os métodos:
    - `enviarEmail(e: { para: string; assunto: string; html: string; texto: string; cabecalhos?: Record<string,string>; chaveIdempotencia: string; tags?: {name:string; value:string}[] }): Promise<{ id: string }>`
    - `salvarContato(c: { email: string; nome: string | null; escritorio: string | null; descadastrado: boolean }): Promise<{ id: string }>`
    - `garantirSegmento(nome: string): Promise<{ id: string }>`
    - `adicionarAoSegmento(contatoEmail: string, segmentoId: string)`
    - `removerDoSegmento(contatoEmail: string, segmentoId: string)`
    - `criarBroadcast(b: { segmentoId; nome; assunto; preCabecalho; html; texto }): Promise<{ id: string }>`
    - `enviarBroadcast(id: string, agendarPara?: Date): Promise<void>`
    - `lerBroadcast(id): Promise<{ id; status: string }>`
- **Detalhes:**
  - Base `https://api.resend.com`, com `Authorization: Bearer`.
  - Envio de email: `POST /emails` com o cabeçalho `Idempotency-Key`. `from` vem de `remetente`; `reply_to` vem de `responderPara`, quando existe.
  - Contatos e segmentos: endpoints `/contacts` e `/segments`.
    - O implementador confere os caminhos exatos em https://resend.com/docs/api-reference e cita no relatório o que usou.
    - Contato já existente → atualiza, sem erro.
  - Status HTTP:
    - 401 ou 403 → `credencial`;
    - 429 → uma retentativa depois de `retry-after` (máx. 2 s); se repetir, `limite`;
    - 404 → `nao_encontrado`;
    - 422 ou 400 → `invalido`;
    - 5xx → `servidor`;
    - exceção do fetch → `rede`.
  - Timeout de 20 s por chamada.

- [ ] **Step 1: Testes que falham** (com fetch falso):
  - `configResend null sem chave`
  - `enviarEmail manda Bearer, Idempotency-Key, from, reply_to, headers`
  - `401 → credencial e a mensagem não contém a chave`
  - `429 com retry-after repete uma vez e depois lança limite`
  - `salvarContato em contato existente atualiza`
  - `garantirSegmento reaproveita segmento de mesmo nome`
  - `criarBroadcast inclui segment e html`
  - `exceção de fetch → rede`
- [ ] **Steps 2–4:** FAIL → implementar → PASS, mais o `tsc`.
- [ ] **Step 5:** Commit `feat(resend): cliente HTTP do Resend`.

### Task 2: Banco — tabelas novas e saída do Brevo

**Files:**
- Modify: `src/lib/db/schema.ts`.
- Modify: os helpers de teste em `src/lib/crm/__tests__/banco-teste*.ts`, conforme preciso.

**Interfaces:**
- **Produces:**
  - Tabela `envios_funil`: `id` serial; `inscricaoId` FK `funil_inscricoes` com on delete cascade; `etapa` int; `status` enum `envio_status` (`enviado` | `erro`); `resendEmailId` text, null; `erro` text, null; `enviadoEm` timestamptz. Índice único (`inscricaoId`, `etapa`).
  - Tabela `webhook_eventos_recebidos`: `id` text PK (o `svix-id`) e `recebidoEm`. Substitui `brevo_eventos_recebidos`, que é removida do schema.
  - `contatos.resendContatoId` (text, null). `brevoId` sai.
  - Em `funis`, sai `brevoListaId` com o seu índice.
  - Em `funil_inscricoes`, saem `listaSync`, `listaSyncErro` e `naListaEm`.
  - Tabela `newsletters_envios`: `id`, `artigoId` FK `artigos`, `resendBroadcastId`, `situacao` enum `newsletter_situacao` (`rascunho` | `agendado` | `enviado` | `erro`), `destinatarios` int null, `agendadoPara`, `enviadoEm`, `erro`, `criadoEm`, `atualizadoEm`.
  - Tabela `pecas_distribuicao`: `id`, `artigoId` FK `artigos`, `tipo` enum `peca_tipo` (`linkedin_artigo` | `linkedin_post` | `carrossel` | `newsletter`), `situacao` enum `peca_situacao` (`gerando` | `rascunho` | `erro` | `publicado`), `conteudo` jsonb null, `variacao` text null (`escura` | `clara`), `erro`, `publicadoEm`, `urlPublicada`, `modelo`, `criadoEm`, `atualizadoEm`. Índice único (`artigoId`, `tipo`).
- Este task **não roda push**. Ele só deixa o schema e os testes consistentes.
  - Código que usava as colunas removidas é adaptado com o mínimo para compilar. O código de Brevo que ficar sem uso pode continuar até o Task 7, mas `tsc` e a suíte precisam passar.
  - O relatório lista as perguntas que o `drizzle-kit push` fará: remoção de colunas e tabela, que trazem aviso de perda de dados. Para cada uma, diga o que responder.

- [ ] **Step 1:** Ajustar o schema e corrigir os pontos que não compilam. Os testes existentes que dependiam das colunas removidas são atualizados ou removidos, com justificativa no relatório.
- [ ] **Step 2:** Rodar a suíte inteira e o `tsc`, ambos verdes.
- [ ] **Step 3:** Commit `feat(db): tabelas de envios do Resend, newsletter e peças; sai o Brevo do schema`.

### Task 3: Descadastro público e verificação de acesso público

**Files:**
- Create: `src/lib/descadastro.ts`, `src/app/descadastro/page.tsx`, `src/app/api/publico/descadastro/route.ts`, `src/app/api/publico/saude/route.ts`, `src/lib/acesso-publico.ts`.
- Modify: `src/proxy.ts`.
- Test: `src/lib/__tests__/descadastro.test.ts`, `src/lib/__tests__/acesso-publico.test.ts`, mais o teste do proxy, se existir.

**Interfaces:**
- **Produces:**
  - `gerarTokenDescadastro(contatoId: number, agora: Date, segredo = process.env.DESCADASTRO_SEGREDO): string`. O formato é `base64url("<id>.<expiraEmUnix>")` + `.` + `base64url(HMAC-SHA256)`, com validade de 365 dias.
  - `lerTokenDescadastro(token: string, agora: Date, segredo?): { contatoId: number } | null`. Compara em tempo constante. Retorna null quando o segredo está ausente, o token está expirado ou foi adulterado.
  - `urlDescadastro(contatoId, agora): string` = `${URL_PUBLICA_PAINEL}/descadastro?t=…`.
    - A variável nova `URL_PUBLICA_PAINEL` tem como padrão `https://claudio-psi-lime.vercel.app`.
  - `descadastrarPorToken(token, agora, opts: { db?; cliente?: ClienteResend | null }): Promise<'ok' | 'ja' | 'invalido'>`. Ela:
    - faz `mudarStatus` para descadastrado com origem `descadastro` e motivo "link de descadastro";
    - chama `sairDeTodosOsFunis`;
    - registra o evento `descadastrou`;
    - com o cliente disponível, chama `salvarContato` com `descadastrado: true`.
- **Comportamento das rotas:**
  - `/descadastro` (página pública, sem o layout do painel): um GET só mostra o texto e um form POST "Confirmar descadastro". Token inválido → "link inválido ou expirado".
  - `POST /api/publico/descadastro?t=` (aceita form e corpo vazio, para o one-click): responde 200 com uma página de confirmação, ou 400.
  - `GET /api/publico/saude` → `{ ok: true }`.
  - `acessoPublicoOk(f = fetch): Promise<boolean>`: faz GET em `${URL_PUBLICA_PAINEL}/api/publico/saude` com timeout de 5 s. É verdadeiro só com status 200 e o JSON `ok`. A página de login da Vercel devolve 401 ou um redirect, e isso conta como falso. O resultado fica em cache de 10 minutos.
  - `proxy.ts` libera `/descadastro` e os caminhos que começam com `/api/publico/`.

- [ ] **Step 1: Testes que falham:**
  - `token válido volta o id`
  - `token adulterado → null`
  - `expirado → null`
  - `sem segredo → null`
  - `GET da página não descadastra`
  - `POST descadastra, sai dos funis e grava evento`
  - `POST de contato já descadastrado → 'ja'`
  - `dados_apagados continua descadastrado`
  - `acessoPublicoOk false para 401 e para HTML de login`
  - `proxy libera /descadastro e /api/publico/x e não libera /api/crm`
- [ ] **Steps 2–4:** FAIL → implementar → PASS, mais o `tsc`.
- [ ] **Step 5:** Commit `feat(crm): descadastro público por token e checagem de acesso público`.

### Task 4: Motor dos funis pelo Resend

**Files:**
- Create: `src/lib/crm/envios-funil.ts`, `src/lib/crm/email-html.ts`.
- Modify: `src/lib/crm/funis.ts` (tira listas, conexão de lista, `sincronizarInscricoes` e `enviarBoasVindasAgora` do Brevo), `src/lib/crm/funis-cron.ts`, `src/lib/crm/funis-conteudo.ts` (remove `passosAutomacao`, `nomeListaBrevo` e `PASTA_BREVO`; `{{ unsubscribe }}` passa a `{{descadastro}}`), `src/app/api/webhooks/site/route.ts`.
- Test: `src/lib/crm/__tests__/envios-funil.test.ts`, `src/lib/crm/__tests__/email-html.test.ts`, e ajustes nos testes de funis.

**Interfaces:**
- **Consumes:** Task 1 (cliente), Task 2 (`envios_funil`), Task 3 (`urlDescadastro`), `EMAILS_FUNIS`, `aplicarMarcadores` e `linkWhatsapp`.
- **Produces:**
  - `montarEmail(e: EmailFunil, ctx: { nome: string | null; urlDescadastro: string; whatsapp: string | null }): { html: string; texto: string; assunto: string }`.
    - O HTML segue o modelo da marca: logo por URL pública `${URL_PUBLICA_PAINEL}/logo-og.png`, dourado `#DAA522`, largura 600, parágrafos, assinatura, rodapé com o descadastro.
    - Todo texto é escapado.
    - Não pode restar marcador `[link do WhatsApp]`: sem link configurado, a frase do WhatsApp é removida.
  - `etapasDevidas(agora, opts: { db? }): Promise<{ inscricaoId; contatoId; slug; etapa }[]>`. Uma etapa é devida quando a referência + `esperarDias` ≤ agora. A referência é `entrouEm` para a etapa 0 e o `enviadoEm` da etapa anterior com status `enviado` para as demais. Só entram inscrições `ativo` de funil ligado.
  - `enviarEtapa(item, opts: { db?; cliente; agora; acessoPublico: boolean }): Promise<'enviado' | 'pulado' | 'erro'>`.
    - Imediatamente antes de enviar, relê o contato e pula se ele estiver descadastrado ou com dados apagados, ou se a inscrição não estiver ativa.
    - Grava `envios_funil` com o índice único. Um conflito de unicidade vira `pulado`.
    - Envia com `chaveIdempotencia = funil-<inscricaoId>-<etapa>`, com os cabeçalhos `List-Unsubscribe: <url>` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, e com `tags` contendo o slug.
    - Registra o evento `enviado` (sem dados pessoais nos `dados`).
    - Depois da última etapa, a inscrição vira `concluido`.
  - `executarEnviosFunil(opts: { db?; cliente; agora; acessoPublico: boolean; limite = Number(process.env.RESEND_LIMITE_DIARIO ?? 90) }): Promise<{ enviados; pulados; erros; restantes }>`.
    - Prioridade: boas-vindas, depois reativação, depois prospecção fria, depois nutrição (que não tem etapas de sequência).
    - Para no limite; o que sobrar fica para o dia seguinte.
    - Sem acesso público, não envia nada e retorna `restantes` igual ao total.
  - `enviarBoasVindasAgora(contatoId, opts: { db?; cliente; agora; acessoPublico })`: envia a etapa 0 da boas-vindas, se for devida. A rota do formulário do site chama essa função em `after()`.
  - `executarEtapaFunis` mantém o contrato e passa a chamar `executarEnviosFunil` no lugar da sincronização de listas do Brevo.
- **Nutrição com o blog:** não tem sequência. A inscrição define quem entra no segmento da newsletter (Task 5).

- [ ] **Step 1: Testes que falham** (PGlite + cliente falso):
  - `etapa 0 devida no dia da entrada`
  - `etapa 1 só depois de esperarDias do envio da 0`
  - `descadastrado entre a seleção e o envio é pulado e nada é enviado`
  - `dados apagados é pulado`
  - `índice único impede segundo envio da mesma etapa (dois executarEnviosFunil seguidos)`
  - `limite 2 com 3 devidas envia 2 boas-vindas antes da reativação e deixa 1 restante`
  - `sem acesso público não envia`
  - `última etapa conclui inscrição`
  - `List-Unsubscribe e Idempotency-Key presentes`
  - `montarEmail escapa <script> no nome e remove a frase do WhatsApp sem link`
  - `funil desligado não envia`
- [ ] **Steps 2–4:** FAIL → implementar → PASS, mais a suíte e o `tsc`.
- [ ] **Step 5:** Commit `feat(funis): sequências enviadas pelo painel via Resend`.

### Task 5: Segmento da newsletter (sincronização de contatos)

**Files:**
- Modify/replace: `src/lib/crm/sincronizar.ts`. Ele vira a sincronização com o Resend e deixa de ter importação do Brevo.
- Test: `src/lib/crm/__tests__/sincronizar.test.ts`, reescrito.

**Interfaces:**
- **Produces:**
  - `SEGMENTO_NEWSLETTER = 'Newsletter — OG'`.
  - `elegivelNewsletter(c, inscricaoNutricaoAtiva: boolean): boolean`. É elegível quem tem status `lead` ou `cliente`, base legal `consentimento` ou `contrato`, nenhum `dadosApagadosEm` e a inscrição na nutrição ativa.
  - `sincronizarPendentes(opts: { db?; cliente; limite = 200 })`. Para cada contato com `syncStatus='pendente'`:
    - se for elegível: `salvarContato` e depois `adicionarAoSegmento`;
    - se não for: `removerDoSegmento`; descadastrado também recebe `salvarContato` com `descadastrado: true`;
    - grava `resendContatoId`, `syncStatus='sincronizado'` ou `erro` com uma mensagem fixa.
  - Os pontos que hoje marcam `pendente` continuam marcando. Entrar ou sair da nutrição também marca.
  - `estadoIntegracao()` passa a devolver: `{ conectado: boolean; acessoPublico: boolean | null; pendentes; erros; ultimoSync }`.
- **Para o Resend vai só** email, nome e escritório.

- [ ] **Step 1: Testes que falham:**
  - `lead com consentimento na nutrição entra no segmento`
  - `legítimo interesse não entra`
  - `descadastrado sai do segmento e fica unsubscribed`
  - `erro do Resend marca erro sem mensagem com dados`
  - `não envia telefone/cidade`
- [ ] **Steps 2–4:** FAIL → implementar → PASS, mais o `tsc`.
- [ ] **Step 5:** Commit `feat(crm): segmento da newsletter sincronizado com o Resend`.

### Task 6: Webhook do Resend

**Files:**
- Create: `src/lib/crm/webhook-resend.ts`, `src/app/api/webhooks/resend/route.ts`.
- Delete: `src/lib/crm/webhook-brevo.ts`, `src/app/api/webhooks/brevo/`, e os testes deles.
- Test: `src/lib/crm/__tests__/webhook-resend.test.ts`.

**Interfaces:**
- **Produces:**
  - `verificarAssinaturaSvix(corpo: string, cab: { id; timestamp; assinatura }, segredo: string, agora: Date): boolean`.
    - O segredo é `whsec_<base64>`.
    - O valor assinado é `${id}.${timestamp}.${corpo}`, com HMAC-SHA256 em base64.
    - O cabeçalho pode trazer várias assinaturas `v1,<sig>` separadas por espaço; a validação passa se qualquer uma conferir, sempre em tempo constante.
    - Uma diferença de mais de 300 s entre o timestamp e agora → false.
  - `aplicarEventoResend(ev, opts: { db? }): Promise<'processado' | 'repetido' | 'ignorado' | 'contato_desconhecido'>`.
    - A deduplicação é pelo `svix-id` na tabela `webhook_eventos_recebidos`.
    - O contato é encontrado pelo `resend_email_id` em `envios_funil` ou pelo email normalizado.
    - Mapeamento dos eventos:

      | Evento | Efeito |
      |---|---|
      | `email.opened` | `aberto` |
      | `email.clicked` | `clicado` (dados: só a URL do link) |
      | `email.bounced` | `bounce`; com `bounce.type` 'Permanent', também `sairDeTodosOsFunis` |
      | `email.complained` | `spam`, depois `mudarStatus` para descadastrado e `sairDeTodosOsFunis` |
      | `contact.updated` com `unsubscribed: true` | descadastra (origem `resend`) |
      | `email.delivered` | `ignorado` |
      | outros | `ignorado` |
- **Rota:**
  - Corpo de até 1 MB (`lerCorpoLimitado`).
  - Sem `RESEND_WEBHOOK_SECRET` → 503.
  - Assinatura inválida → 401.
  - Caso contrário → 200.
  - `proxy.ts` já libera `/api/webhooks/*`.

- [ ] **Step 1: Testes que falham:**
  - `assinatura válida (vetor calculado no teste com segredo conhecido)`
  - `assinatura errada → false`
  - `timestamp de 6 min atrás → false`
  - `múltiplas assinaturas, uma válida → true`
  - `mesmo svix-id duas vezes → repetido`
  - `complained descadastra e tira dos funis`
  - `hard bounce tira dos funis`
  - `contact.updated unsubscribed descadastra`
  - `contato com dados apagados não recebe dados no evento`
  - `rota sem segredo → 503; assinatura ruim → 401`
- [ ] **Steps 2–4:** FAIL → implementar → PASS, mais o `tsc`.
- [ ] **Step 5:** Commit `feat(crm): webhook do Resend com assinatura Svix`.

### Task 7: Telas do CRM, cron e limpeza do Brevo

**Files:**
- Modify: `src/app/(dash)/crm/integracao/page.tsx`, `src/app/(dash)/crm/funis/**`, `src/app/(dash)/crm/contatos/**`, `src/app/api/cron/diario/route.ts`.
- Delete: `src/lib/brevo.ts`, `src/app/api/crm/brevo/**`, `src/app/api/crm/funis/[slug]/brevo/**`, a tela `src/app/(dash)/temas/[id]/campanha` e `src/app/api/temas/campanha`.
  - A campanha do blog passa a ser a newsletter da distribuição (Task 11).
  - O botão "Criar campanha no Brevo" no editor do artigo sai.
- Modify: `README.md`.
- Test: ajustar e escrever os testes de tela.

**Comportamento:**
- **Integração:**
  - Status do Resend (conectado ou não) e domínio remetente.
  - **Acesso público**, com a explicação da proteção da Vercel e a instrução para trocar para "Standard Protection".
  - Instruções de DNS (o usuário adiciona no Resend o domínio `ogpericiacontabil.com.br` e copia os registros para a Hostinger).
  - URL do webhook `/api/webhooks/resend` e lista dos eventos a assinar.
  - Fila de sincronização.
- **Funis:**
  - Por funil: as etapas (assunto, espera em dias, prévia renderizada com `montarEmail`).
  - Envios dos últimos 30 dias (enviados e erros).
  - Fila de hoje.
  - Liga/desliga e o checklist da prospecção (mantidos).
- **Contatos:** nenhuma menção ao Brevo; a origem `brevo` aparece como "Brevo (legado)".
- **Cron diário:** a etapa `funis` usa o Resend e a fonte `resend` sincroniza o segmento. Sem chave → `nao_configurado`.
- **README:**
  - variáveis `RESEND_*`, `DESCADASTRO_SEGREDO`, `URL_PUBLICA_PAINEL`;
  - DNS;
  - webhook;
  - proteção da Vercel;
  - as perguntas do `drizzle-kit push` (do relatório do Task 2).
- `grep -ri brevo src` só pode achar o valor de enum `brevo`, o rótulo legado e comentários de histórico.

- [ ] **Step 1: Testes que falham:**
  - `integração mostra 'Resend não conectado' sem chave`
  - `mostra alerta de acesso público quando false`
  - `funis lista etapas com prévia`
  - `editor do artigo não tem botão do Brevo`
- [ ] **Steps 2–4:** FAIL → implementar → PASS, mais a suíte, o `tsc`, o `npm run build` e o eslint.
- [ ] **Step 5:** Commit `feat(crm): telas do Resend e remoção do Brevo`.

## Parte B — Distribuição

### Task 8: Fontes e arte do carrossel

**Files:**
- Create: `src/lib/distribuicao/arte/ajuste.ts`, `src/lib/distribuicao/arte/lamina.tsx`, `src/lib/distribuicao/arte/fontes.ts`.
- Assets: `assets/fontes/SourceSerif4-Semibold.ttf`, `assets/fontes/IBMPlexSans-Regular.ttf`, `assets/fontes/IBMPlexSans-SemiBold.ttf`, `assets/fontes/OFL.txt`.
- Test: `src/lib/distribuicao/__tests__/ajuste.test.ts`, `src/lib/distribuicao/__tests__/lamina.test.ts`.

**Interfaces:**
- **Produces:**
  - `type Lamina = { tipo: 'capa'; titulo: string; subtitulo: string | null } | { tipo: 'conteudo'; titulo: string; texto: string | null; itens: string[] | null } | { tipo: 'chamada'; texto: string }`.
  - `ajustarFonte(texto: string, caixa: { largura: number; alturaMax: number }, degraus: number[], fatorLargura = 0.52, alturaLinha = 1.25): { tamanho: number; linhas: number } | null`. Estima as linhas quebrando por palavras, com largura média de caractere = `fatorLargura × tamanho`. Retorna o maior degrau que cabe, ou null.
  - Degraus fixos:
    - títulos: `[72, 64, 56, 48]` na capa e `[56, 48, 42, 36]` no conteúdo;
    - texto: `[36, 32, 28, 26]`;
    - itens: `[32, 28, 26]`.
  - `renderizarLamina(l: Lamina, n: number, total: number, variacao: 'escura' | 'clara'): Promise<Response | { erro: string }>`.
    - Usa `ImageResponse` de `next/og`, em 1080×1350, com margem de 96 px.
    - Leva o logo (lido de `public/logo-og.png` para a escura e `public/logo-og-claro.png` para a clara), o detalhe dourado, a numeração `n/total` e o rodapé "ogpericiacontabil.com.br".
    - Quando `ajustarFonte` devolve null → `{ erro: 'texto longo demais na lâmina N' }`.
  - `carregarFontes()`: lê os TTF com `fs` a partir de `process.cwd()`. Para incluir os arquivos no bundle da Vercel, use `outputFileTracingIncludes` no `next.config.ts` para as rotas de distribuição.
  - **Fontes:** baixe dos repositórios oficiais (Google Fonts, GitHub `adobe-fonts/source-serif` e `IBM/plex`), com o arquivo OFL. O relatório registra a URL e o sha256 de cada arquivo.
- [ ] **Step 1: Testes que falham:**
  - `ajustarFonte escolhe o maior degrau que cabe`
  - `texto enorme → null`
  - `renderizarLamina devolve image/png e PNG 1080×1350` (ler a largura e a altura do cabeçalho IHDR)
  - `texto longo → erro com o número da lâmina`
- [ ] **Steps 2–4:** FAIL → implementar → PASS, mais o `tsc`.
- [ ] **Step 5:** Commit `feat(distribuicao): arte do carrossel com a marca`.

### Task 9: Peças — schemas, prompts, geração e repositório

**Files:**
- Create: `src/lib/distribuicao/schemas.ts`, `src/lib/distribuicao/prompts.ts`, `src/lib/distribuicao/gerar.ts`, `src/lib/distribuicao/repositorio.ts`.
- Modify: `src/lib/artigos/__tests__/schemas-estritos.test.ts`.
- Test: `src/lib/distribuicao/__tests__/*.test.ts`.

**Interfaces:**
- **Produces:**
  - Schemas do modelo, todos nulláveis e sem `.optional()`, e os estritos correspondentes, com os limites da spec §3.1:

    | Peça | Limites |
    |---|---|
    | `linkedin_artigo` | `titulo` ≤ 100; `subtitulo` ≤ 160 ou null; `blocos` (`paragrafo` / `h2` / `lista`); entre 600 e 1.200 palavras, com aviso se ficar fora (não bloqueia) |
    | `linkedin_post` | `texto` ≤ 2.800; `hashtags` com 3–5 itens, sem `#` |
    | `carrossel` | `laminas` com 6–8 itens: capa (`titulo` ≤ 60, `subtitulo` ≤ 90) + conteúdo (`titulo` ≤ 50, `texto` ≤ 220 ou `itens` com até 4 de até 70) + chamada (`texto` ≤ 120). `legenda` ≤ 2.000 |
    | `newsletter` | `assunto` ≤ 70; `preCabecalho` ≤ 110; `abertura` ≤ 400; `pontos` com 3–5 itens de até 160 |

  - `repararPeca(tipo, bruto): { valor; ajustes: string[] }`. Corta na palavra o que exceder e registra no `ajustes`. Se a quantidade de itens estiver fora do intervalo, lança erro, e a peça fica `erro`.
  - Prompts em pt-BR, com as mesmas proibições do artigo. Entram no prompt: o título, a keyword, o texto do artigo (HTML → texto, sem as marcas "verificar") e o link do blog (`wpLink`, ou o link previsto `${siteUrl()}/${slug}/`). Sem dado de contato.
  - Repositório:
    - `reivindicarPeca(artigoId, tipo, agora, db?)`: atômico em (artigo, tipo), segue o padrão de `reivindicarGeracao` e considera presa a peça em `gerando` há mais de 10 min.
    - `concluirPeca`, `falharPeca`, `salvarPeca(id, conteudo validado pelo estrito)`.
    - `marcarPublicada(id, url | null)`, `pecasDoArtigo(artigoId)`, `listarDistribuicao()`.
  - `gerarPecas(artigoId, opts: { tipos?; gerar?; db?; agora? })`:
    - Recusa quando o artigo tem marcas "verificar", ou quando não está em `pronto`, `agendado` ou `publicado`.
    - Gera os tipos pedidos em paralelo e isola o erro de cada um.
- [ ] **Step 1: Testes que falham:**
  - `schemas estritos (guarda)`
  - `carrossel com 9 lâminas → erro`
  - `título da capa com 80 → cortado com ajuste`
  - `artigo com 'verificar' recusa`
  - `artigo em rascunho recusa`
  - `uma peça falhando não derruba as outras`
  - `reivindicação dupla → uma só gera`
  - `prompt não contém email/telefone de contato e contém o link do blog`
- [ ] **Steps 2–4:** FAIL → implementar → PASS, mais o `tsc`.
- [ ] **Step 5:** Commit `feat(distribuicao): geração das peças a partir do artigo`.

### Task 10: Rotas de arte e de peças

**Files:**
- Create:
  - `src/app/api/distribuicao/[artigoId]/gerar/route.ts` (POST, `after()`, `maxDuration` 300)
  - `src/app/api/distribuicao/pecas/[id]/route.ts` (GET/PUT: o PUT valida pelo schema estrito do tipo; um carrossel com lâmina que não cabe → 422 com a lista de lâminas)
  - `src/app/api/distribuicao/pecas/[id]/lamina/[n]/route.ts` (PNG)
  - `src/app/api/distribuicao/pecas/[id]/pdf/route.ts`
  - `src/app/api/distribuicao/pecas/[id]/zip/route.ts`
  - `src/app/api/distribuicao/pecas/[id]/publicada/route.ts` (POST com `{url|null}`)
- Install: `pdf-lib`, `fflate`.
- Modify: `next.config.ts` (`outputFileTracingIncludes` das fontes).
- Test: `src/app/api/distribuicao/__tests__/rotas.test.ts`.

**Detalhes:**
- PDF: uma página por lâmina, com o PNG incorporado em 1080×1350 pt.
- ZIP: arquivos `lamina-01.png`… e o `legenda.txt`.
- Os nomes de arquivo levam o slug do artigo, saneado.
- [ ] **Step 1: Testes que falham:**
  - `PNG 1080×1350`
  - `PDF com N páginas (pdf-lib load)`
  - `ZIP com N+1 arquivos`
  - `PUT de carrossel com texto que não cabe → 422`
  - `gerar recusa artigo com verificar (400)`
  - `peça de outro tipo na rota de lâmina → 404`
- [ ] **Steps 2–4:** FAIL → implementar → PASS, mais o `tsc` e o build.
- [ ] **Step 5:** Commit `feat(distribuicao): rotas de peças, PNG, PDF e ZIP`.

### Task 11: Newsletter a partir da peça

**Files:**
- Create: `src/lib/distribuicao/newsletter.ts`, `src/app/api/distribuicao/pecas/[id]/newsletter/route.ts`.
- Test: `src/lib/distribuicao/__tests__/newsletter.test.ts`.

**Interfaces:**
- **Consumes:** Task 1 (cliente), Task 5 (`SEGMENTO_NEWSLETTER`), Task 9 (peça newsletter), Task 3 (`acessoPublicoOk`).
- **Produces:**
  - `montarNewsletter(p, ctx: { link: string }): { html; texto; assunto; preCabecalho }`. Usa o modelo da marca (o mesmo de `email-html.ts`), o botão "Ler o artigo completo" com UTM (`utm_source=newsletter&utm_medium=email&utm_campaign=<slug>`) e o rodapé com `{{{RESEND_UNSUBSCRIBE_URL}}}`.
  - `criarRascunhoNewsletter(pecaId, opts)`: cria o broadcast e grava `newsletters_envios` em `rascunho`. Se já existe um rascunho, atualiza; não duplica.
  - `enviarNewsletter(envioId, opts: { agendarPara?: Date })`:
    - Exige `acessoPublico === true`, porque sem ele o descadastro hospedado não volta pelo webhook.
    - Bloqueia o envio repetido: só envia a partir de `rascunho`.
    - Grava `agendado` ou `enviado`.
  - A rota aceita POST `{ acao: 'rascunho' | 'enviar', agendarPara? }`.
- [ ] **Step 1: Testes que falham:**
  - `html tem RESEND_UNSUBSCRIBE_URL e UTM`
  - `segundo rascunho atualiza o mesmo broadcast`
  - `enviar sem acesso público → bloqueado`
  - `enviar duas vezes → a segunda recusa`
  - `erro do Resend grava erro sem a chave`
- [ ] **Steps 2–4:** FAIL → implementar → PASS, mais o `tsc`.
- [ ] **Step 5:** Commit `feat(distribuicao): newsletter do artigo pelo Resend`.

### Task 12: Telas da distribuição

**Files:**
- Create: `src/app/(dash)/artigos/[id]/distribuicao/*` (aba e cartões, client components), `src/app/(dash)/distribuicao/page.tsx`.
- Modify: `src/components/ui/navegacao.ts` (item "Distribuição" depois de "Artigos"), `src/app/(dash)/artigos/[id]/page.tsx` (abas "Artigo" | "Distribuição").
- Test: `src/app/(dash)/artigos/__tests__/distribuicao.test.tsx`.

**Comportamento** (spec §3.4):
- **Botão "Gerar peças":** fica desabilitado com explicação quando o artigo não está pronto ou tem trechos "verificar". Enquanto gera, a tela atualiza sozinha (meta refresh de 10 s).
- **Cartões:**
  - LinkedIn artigo e LinkedIn post: editar e copiar, com o contador do post.
  - Carrossel:
    - grade de miniaturas usando a rota PNG, com cache-buster pelo `atualizadoEm`;
    - edição do texto de cada lâmina, com aviso por lâmina vindo do 422;
    - alternância escura / clara;
    - "Baixar PDF" e "Baixar PNGs (.zip)";
    - "Copiar legenda".
  - Newsletter:
    - prévia em iframe `srcdoc` com `sandbox` vazio;
    - "Criar rascunho no Resend";
    - "Enviar newsletter", com confirmação inline ("Confirmar envio para N contatos") e campo opcional de data;
    - fica bloqueado com explicação sem Resend ou sem acesso público.
- **Em cada cartão:** "Regerar", "Marcar como publicado" (campo de URL opcional) e o selo da situação.
- **Restrições:** nada de `window.confirm`. O `dangerouslySetInnerHTML` não é usado; a prévia da newsletter vai em iframe sandbox.
- **`/distribuicao`:** tabela com cada artigo e o estado das 4 peças.
- [ ] **Step 1: Testes que falham:**
  - `aba desabilitada com verificar`
  - `enviar newsletter pede confirmação antes do fetch`
  - `aviso 422 aparece na lâmina certa`
  - `copiar usa clipboard`
  - `navegação tem Distribuição`
- [ ] **Steps 2–4:** FAIL → implementar → PASS, mais a suíte, o `tsc`, o build e o eslint.
- [ ] **Step 5:** Commit `feat(distribuicao): telas da distribuição`.
