# Ecossistema OG — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dados de busca e tráfego atualizados sozinhos, radar diário de temas e teses, redesign com a marca OG, e um CRM com funis de email pelo Brevo — tudo dentro do painel existente.

**Architecture:** O mesmo monolito Next.js 16 na Vercel. Novas tabelas no Neon via Drizzle. Integrações externas (OpenRouter, Google Analytics Data API, Brevo) atrás de clientes injetáveis para teste. Duas rotinas cron diárias. Webhooks protegidos por token.

**Tech Stack:** o existente (Next.js 16.4.3, TypeScript strict, Tailwind 4, Drizzle + `drizzle-orm/neon-serverless` Pool, AI SDK 7 + `@ai-sdk/openai`, `googleapis`, Vitest com `TZ=America/Sao_Paulo`) mais o que cada tarefa justificar.

**Spec:** `docs/superpowers/specs/2026-10-29-ecossistema-design.md` (e a spec anterior, `2026-10-28-dashboard-seo-design.md`, que continua valendo).

## Global Constraints

- Tudo da spec anterior continua: runtime Node, nunca `edge`; TypeScript strict, sem `any`; pt-BR; repositório público sem segredo; `getDb()` com init tardia; dado ausente nunca aparece como zero; toda rota que escreve é POST e redireciona com flag; `AGENTS.md` (ler `node_modules/next/dist/docs/` antes de API do Next).
- IA: um único cliente em `src/lib/ai/cliente.ts`. `OPENROUTER_API_KEY` preferida, `OPENAI_API_KEY` alternativa. Schema enviado ao modelo **sem** limites de tamanho de string; validação estrita depois. Teste de regressão `zodSchema()` em todo schema novo enviado a modelo.
- **Nenhum dado de contato do CRM entra em prompt de IA.**
- Webhooks: token por variável de ambiente, comparação em tempo constante, falha fechada sem a variável. O proxy libera `/api/webhooks/*`.
- Integração sem credencial = estado explícito na tela ("não conectado"), nunca erro 500 nem zero.
- Contato `descadastrado` nunca é adicionado a lista do Brevo, por nenhum caminho.
- Chamadas a serviços pagos no cron têm teto por execução.
- Cada tarefa termina com testes, `npm run build`, commit com trailer `Co-Authored-By: <modelo> <noreply@anthropic.com>`.

## Review Focus

1. Webhook do Brevo ou do site chamado sem token, com token errado, ou repetido (replay) → recusado; descadastro idempotente. → E8.
2. Planilha com emails duplicados, em caixa diferente, vazios ou inválidos → deduplica, pula inválidos, relata contagens. → E7.
3. Contato descadastrado que volta por planilha, formulário ou Brevo → continua descadastrado e fora de toda lista. → E7, E8.
4. Tendência devolvida sem URL de fonte, com URL não-http(s) ou repetida → não grava. → E6.
5. Alternância de tema sem "piscar" o tema errado ao carregar e sem erro de hidratação. → E4.

---

### Task E1: IA via OpenRouter e validação ao vivo

**Files:** Modify `src/lib/ai/cliente.ts`, `.env.example`, `README.md`. Test `src/lib/ai/__tests__/cliente.test.ts`.

**Interfaces:**
- Produces: `GerarObjeto` e `gerarObjetoPadrao` com a mesma assinatura; novo `gerarObjetoComBusca: GerarObjeto` (modelo `OPENAI_MODEL_BUSCA`, padrão `perplexity/sonar-pro`) para a E6; `iaConfigurada(): boolean`.

- [ ] Ler `node_modules/@ai-sdk/openai/docs` e confirmar como apontar o provider para `https://openrouter.ai/api/v1`, se o OpenRouter aceita a Responses API ou exige `.chat(modelo)` (chat completions), e se `json_schema` estrito funciona via OpenRouter para `openai/gpt-4.1`. Registrar a conclusão.
- [ ] Testes: escolhe OpenRouter quando `OPENROUTER_API_KEY` existe; cai para OpenAI direta com `OPENAI_API_KEY`; erro de chave ausente quando nenhuma existe; envia os cabeçalhos `HTTP-Referer` e `X-Title` que o OpenRouter recomenda.
- [ ] Implementar. A disciplina leniente/estrita das tarefas 11 e 12 não muda.
- [ ] Para `gerarObjetoComBusca`: confirmar se o modelo de busca aceita saída estruturada pelo OpenRouter; se não aceitar, pedir JSON e validar com Zod, com uma nova tentativa em caso de falha.
- [ ] **Validação ao vivo** (é o primeiro uso real e grava em produção): com `npx dotenv -e .env.local`, rodar uma vez a pesquisa de temas e um briefing para um tema escolhido, pelo mesmo código das rotas. Relatar: temas criados, um briefing completo, tempo e custo aproximado (o OpenRouter devolve `usage`). Se a OpenAI recusar o schema estrito, corrigir e repetir.

### Task E2 (controlador): Conta de serviço do Google

Executada pelo controlador no navegador, não por implementador. Criar projeto no Google Cloud, habilitar Search Console API e Google Analytics Data API, criar conta de serviço e chave JSON, adicionar o email como usuário restrito em `sc-domain:ogpericiacontabil.com.br` e como Leitor na propriedade GA4, anotar o ID numérico da propriedade GA4. Gravar `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `GA4_PROPERTY_ID` na Vercel e no `.env.local`. Rodar a sincronização do Search Console uma vez de verdade. Parar se o Google exigir senha/2FA e seguir com o resto.

### Task E3: Google Analytics e rotina diária

**Files:** Create `src/lib/ga4.ts`, `src/app/api/cron/diario/route.ts`, tests. Modify `src/lib/db/schema.ts`, `vercel.ts`.

**Interfaces:**
- Produces: tabelas `ga4_diario` (`data date pk`, `sessoes`, `usuarios`, `sessoes_engajadas`, `eventos_chave`) e `ga4_paginas` (`snapshot_date`, `pagina`, `origem_midia`, `sessoes`, `usuarios`, `eventos_chave`, unique nos três primeiros); `buscarGa4(o)` injetável; `executarCronDiario(deps)` que roda Search Console e GA4 **independentes** (falha de um não impede o outro) e devolve status por fonte.

- [ ] Ler a doc do `googleapis` instalado para `analyticsdata.properties.runReport` com a mesma autenticação JWT de `gsc.ts` (escopo `analytics.readonly`).
- [ ] Testes com cliente falso: mapeamento de linhas, paginação, upsert idempotente, GA4 sem `GA4_PROPERTY_ID` → status "não configurado" sem derrubar o Search Console, e vice-versa.
- [ ] `vercel.ts`: `/api/cron/diario` às 06:00 UTC substitui `/api/cron/gsc` (a rota antiga continua existindo). Verificar na doc da Vercel o limite de crons do plano Hobby e registrar.
- [ ] Mesma autenticação Bearer `CRON_SECRET`, falhando fechado.

### Task E4: Sistema de design e casca do painel

**Files:** `src/app/globals.css`, `src/app/layout.tsx`, `src/app/(dash)/layout.tsx`, `src/components/ui/*`, `src/components/tema/*`, `public/logo-og.png`, `src/app/login/page.tsx`.

- [ ] Carregar as skills `anthropic-skills:frontend-design` e `dataviz` antes de desenhar.
- [ ] Tokens de cor em CSS custom properties para `escuro` e `claro`; dourado da marca extraído do logo (`https://ogpericiacontabil.com.br/wp-content/uploads/2026/04/Prancheta-2-768x199-1.png`, aprox. `#D8A020`); contraste AA verificado para texto e para o dourado sobre os dois fundos.
- [ ] Alternância: padrão segue `prefers-color-scheme`; escolha salva em cookie e em `localStorage`; script inline no `<head>` aplica o tema antes da pintura (Review Focus 5). Teste de que o HTML do servidor já sai com o atributo de tema quando há cookie.
- [ ] Componentes pequenos e reaproveitáveis: `Cartao`, `Indicador` (número + rótulo + variação), `Selo` (severidade/status), `Tabela`, `EstadoVazio`, `Botao` (incluindo o estado "Gerando…" existente), `Aviso`.
- [ ] Barra lateral com o logo e navegação agrupada: Visão geral · SEO (Oportunidades, Temas, Briefings, Tendências, Auditoria) · Dados (Tráfego) · CRM (Contatos, Funis, Importar). Itens de telas ainda inexistentes aparecem desabilitados com "em breve", nunca como link quebrado. Responsivo até 360 px.
- [ ] Tela de login no mesmo visual.

### Task E5: Redesign das telas e gráficos

**Files:** as cinco páginas existentes, nova `src/app/(dash)/trafego/page.tsx`, `src/components/graficos/*`.

- [ ] Reescrever Visão geral, Auditoria, Oportunidades, Temas e Briefings com os componentes da E4, sem mudar lógica nem rotas.
- [ ] Gráficos (biblioteca escolhida após conferir compatibilidade com React 19 e o tamanho do bundle, ou SVG próprio): cliques e impressões por dia (de `gsc_totais`/snapshots), sessões por dia (`ga4_diario`), problemas por severidade.
- [ ] Tela Tráfego: sessões, usuários, engajamento, eventos-chave, páginas de destino e origens dos últimos 28 dias.
- [ ] Todos os estados vazios e de erro mantidos.

### Task E6: Radar de temas em alta e teses sugeridas

**Files:** `src/lib/radar/*`, `src/app/api/cron/tendencias/route.ts`, `src/app/api/teses/*`, `src/app/(dash)/tendencias/page.tsx`, schema.

**Interfaces:**
- Produces: tabelas `tendencias` (`id`, `titulo`, `resumo`, `fonte_url`, `publicado_em date null`, `palavras_chave jsonb`, `coletado_em`, `hash` único) e `teses_sugeridas` (`id`, `tendencia_id null`, `titulo`, `keyword`, `keyword_normalizada`, `intencao`, `justificativa`, `potencial` enum `alto|medio|baixo`, `sinais jsonb`, `status` enum `nova|virou_tema|descartada`, `criado_em`); `topics.origem` ganha `tendencia`.

- [ ] Coleta diária com `gerarObjetoComBusca`: últimos 7 dias de decisões STF/STJ/TST/TRFs, leis e índices (Selic, IPCA-E, TR) e teses relevantes a cálculos judiciais e perícia contábil. No máximo 10 tendências por dia. Tendência sem URL http(s) de fonte não grava; `hash` da URL normalizada evita repetição (Review Focus 4).
- [ ] Termos em alta no Search Console: impressões da janela atual contra a anterior por query, a partir dos snapshots.
- [ ] Teses: modelo comum recebe tendências recentes, termos em alta e temas existentes; devolve até 8 teses com justificativa e potencial. A tela marca o potencial como **estimativa do modelo**. Deduplicação por `keyword_normalizada` contra temas e teses existentes.
- [ ] Tela Tendências: tendências com link da fonte e data; teses com "Virar tema" (cria tema `origem: 'tendencia'` com o mesmo índice único) e "Descartar"; botão "Atualizar agora".
- [ ] Cron `/api/cron/tendencias` às 07:00 UTC, ou incorporado ao diário se o Hobby limitar (decisão da E3).

### Task E7: CRM — contatos

**Files:** `src/lib/crm/*`, `src/app/(dash)/crm/contatos/*`, `src/app/(dash)/crm/importar/*`, `src/app/api/crm/*`, schema.

**Interfaces:**
- Produces: tabelas `contatos` (campos da spec §3D, `email_normalizado` único), `eventos_contato` (`contato_id`, `tipo`, `dados jsonb`, `em`); `normalizarEmail`; `upsertContato(dados, origem)` que **nunca** tira um contato de `descadastrado`; `registrarEvento`.

- [ ] Lista com busca, filtro por status, origem e tag; detalhe com linha do tempo; cadastro e edição manual.
- [ ] Importação CSV (planilha do Excel salva como CSV, separador `,` ou `;`, UTF-8 com ou sem BOM): pré-visualização, mapeamento de colunas, base legal obrigatória para o lote, deduplicação por email normalizado, relatório de criados/atualizados/ignorados com motivo (Review Focus 2 e 3). Limite de 5 000 linhas por lote.
- [ ] Exportar CSV dos contatos filtrados.

### Task E8: Brevo e webhooks

**Files:** `src/lib/brevo.ts`, `src/lib/crm/sincronizar.ts`, `src/app/api/webhooks/brevo/route.ts`, `src/app/api/webhooks/site/route.ts`, `src/proxy.ts` (liberar `/api/webhooks/*`).

- [ ] Ler a referência da API v3 do Brevo (contatos, listas, campanhas de email, webhooks) e registrar os endpoints usados.
- [ ] Cliente injetável: upsert de contato com atributos, adicionar/remover de lista, listar contatos paginado, criar rascunho de campanha. Sem `BREVO_API_KEY`: tudo vira pendente e a tela diz "Brevo não conectado".
- [ ] Sincronização: contatos pendentes são enviados; descadastrados nunca entram em lista.
- [ ] Webhook do Brevo: descadastro, hard bounce, spam, abertura, clique → evento na linha do tempo; descadastro/hard bounce/spam mudam o status e removem de todos os funis; idempotente (Review Focus 1).
- [ ] Webhook do site: aceita o webhook do Elementor Forms (JSON e form-urlencoded), cria/atualiza contato `origem: 'site'`, base legal `consentimento`, e inscreve no funil de boas-vindas.
- [ ] Importar contatos já existentes no Brevo.
- [ ] Tela de integração mostrando os dois endereços de webhook (sem expor o token na URL exibida além do necessário para copiar) e o estado da conexão.

### Task E9: Funis

**Files:** `src/lib/crm/funis.ts`, `src/lib/crm/funis-conteudo.ts`, `src/app/(dash)/crm/funis/*`, schema, cron diário.

**Interfaces:**
- Produces: tabelas `funis` (`slug` único, `nome`, `descricao`, `ativo`, `brevo_lista_id null`, `teto_diario null`, `exige_base_legal`) e `funil_inscricoes` (`contato_id`, `funil_id`, `status` `ativo|concluido|saiu`, `entrou_em`, unique em contato+funil); `garantirFunis()` idempotente.

- [ ] Quatro funis: `boas-vindas` (ativo), `nutricao-blog` (ativo), `reativacao` (ativo), `prospeccao-fria` (**inativo**). Ligar a prospecção fria exige confirmar o checklist LGPD na tela e definir teto diário.
- [ ] Textos prontos em pt-BR: 3 emails por funil (assunto, pré-cabeçalho, corpo), no tom de perito falando com advogado, sem promessa de resultado de processo, com descadastro. Tela do funil mostra os textos com botão de copiar e o passo a passo da automação no Brevo ("contato adicionado à lista X").
- [ ] Reativação: etapa do cron diário inscreve clientes sem interação há 180 dias, no máximo 50 por dia.
- [ ] Nutrição com o blog: quando um tema vira `publicado`, oferecer na tela do tema "Criar rascunho de campanha no Brevo" com título, resumo e link; **nunca enviar**.
- [ ] Inscrição e saída registradas na linha do tempo; inscrever adiciona à lista do Brevo, sair remove.

### Task E10 (controlador): revisão final, deploy e resumo

Revisão do branch inteiro em modelo mais capaz, uma onda de correção, re-revisão, deploy, verificação nas telas reais, merge na `main`, resumo ao usuário.
