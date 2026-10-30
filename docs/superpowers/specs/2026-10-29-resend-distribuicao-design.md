# Resend no lugar do Brevo + distribuição do artigo

**Data:** 2026-10-29
**Base:** painel em produção, incluindo o módulo de artigos (`2026-10-29-artigos-wordpress-design.md`).
**Pedido do usuário:**

- Usar o Resend no lugar do Brevo.
- "Esse mesmo artigo tem que virar um artigo pro LinkedIn, pra newsletter, pro blog e um post pras redes sociais. A gente vai precisar de criação de arte ali dentro."
- O usuário aprovou a ordem (1. Resend, 2. distribuição) e escreveu "pode tocar".
- A IA continua no OpenRouter ("o sistema que vamos usar tem fallback").

## 1. Objetivo

Um artigo aprovado vira, no painel:

- o post do blog (já existe);
- um **artigo para o LinkedIn**;
- um **post para o LinkedIn**;
- um **carrossel** com arte pronta na identidade visual da marca;
- uma **newsletter** enviada pelo Resend.

Todo o email do CRM, funis e newsletter, passa a sair pelo Resend, com o painel no comando.

**Pronto quando:**

- (a) Um artigo real gera as quatro peças, todas editáveis.
- (b) O carrossel baixa em PNG (uma imagem por lâmina) e em PDF (para o LinkedIn), com o texto dentro das áreas.
- (c) A newsletter do artigo vai, como rascunho, para o Resend e pode ser enviada pelo painel com confirmação.
- (d) Os funis de email saem pelo Resend, com descadastro funcionando.
- (e) O código do Brevo sai do projeto.

## 2. Parte A — Resend

### 2.1 Por que esta divisão

O Resend tem dois tipos de envio, com regras diferentes:

| Tipo | Uso aqui | Limite grátis | Descadastro |
|---|---|---|---|
| **Marketing**: broadcasts para um segmento | Newsletter | Ilimitado, até 1.000 contatos/mês | Página hospedada pelo Resend (`{{{RESEND_UNSUBSCRIBE_URL}}}`) |
| **Transacional**: envio individual | Funis (boas-vindas, reativação, prospecção) | 100/dia, 3.000/mês | Link próprio do painel e os cabeçalhos `List-Unsubscribe` e `List-Unsubscribe-Post` (one-click) |

**Os funis não usam as Automations do Resend.** Elas são recentes e a documentação da API está incompleta (passos de espera e condições não estão descritos). Quem decide quem recebe qual email, e quando, é o **painel**: a rotina diária e o envio imediato da boas-vindas. As regras de LGPD já implementadas continuam valendo sem mudança.

### 2.2 Variáveis de ambiente

| Variável | Uso |
|---|---|
| `RESEND_API_KEY` | Chave da API |
| `RESEND_REMETENTE` | Ex.: `Oliveira Guimarães <contato@ogpericiacontabil.com.br>`. Domínio verificado no Resend com registros DNS na Hostinger. |
| `RESEND_RESPONDER_PARA` | Caixa que recebe as respostas, porque os emails pedem "responda a este email" |
| `RESEND_WEBHOOK_SECRET` | `whsec_…`, para verificar os webhooks do Resend |
| `DESCADASTRO_SEGREDO` | Segredo HMAC dos links de descadastro |

Sem `RESEND_API_KEY`, as telas mostram "Resend não conectado" e nada é enviado.

### 2.3 Cliente (`src/lib/resend.ts`)

- `fetch` injetável, sem SDK. Segue o padrão de `src/lib/brevo.ts` e `src/lib/wordpress.ts`: mensagens fixas em pt-BR e a chave nunca em erro nem log.
- **Operações:**
  - `enviarEmail` com `Idempotency-Key`;
  - `criarOuAtualizarContato`;
  - `adicionarAoSegmento` e `removerDoSegmento`;
  - `garantirSegmento(nome)`;
  - `criarBroadcast` (rascunho);
  - `enviarBroadcast`;
  - `lerBroadcast`.
- **Limite de requisições:** 10 por segundo, com retentativa curta para 429.

### 2.4 Funis pelo painel

- **Etapas:** cada funil mantém a lista de emails de `funis-conteudo.ts` (`esperarDias`, assunto, pré-cabeçalho, corpo). O marcador `{{ unsubscribe }}` vira o link próprio.
- **Tabela nova `envios_funil`:**
  - colunas: `inscricao_id`, `etapa` (índice), `enviado_em`, `resend_email_id`, `status` (`enviado` | `erro`), `erro`;
  - único em (`inscricao_id`, `etapa`): uma etapa nunca sai duas vezes;
  - a chave de idempotência no Resend é `funil-<inscricao>-<etapa>`.
- **Quando sai a próxima etapa:** ela é devida quando `entrou_em` (para a primeira) ou o `enviado_em` da etapa anterior, somado a `esperarDias`, já passou.
- **Rotina diária:**
  - envia as etapas devidas, até o limite do plano: `RESEND_LIMITE_DIARIO`, padrão 90, para deixar folga dos 100;
  - a boas-vindas tem prioridade, depois reativação, depois prospecção;
  - o que não couber fica para o dia seguinte;
  - a sequência é concluída depois da última etapa.
- **Boas-vindas imediata:** o webhook do formulário do site, em `after()`, envia a etapa 0 na hora, como hoje.
- **Antes de cada envio, o painel confere de novo:**
  - o contato não está `descadastrado`;
  - não teve os dados apagados;
  - a inscrição está `ativo`;
  - o funil está ligado.
- **Corpo do email:** HTML simples, com a marca (logo, cores, rodapé com o endereço da empresa), mais a versão em texto. Os templates ficam no código.
- **Saem:** listas do Brevo, `lista_sync`, `na_lista_em`, a tela de "passo a passo da automação no Brevo" e a conexão de lista.
  - A tela de funis passa a mostrar as etapas, os envios dos últimos 30 dias e o que está na fila de hoje.

### 2.5 Descadastro

- **Link de descadastro:** `/descadastro?t=<token>`, uma página pública.
  - O token é `base64url(contatoId.expiração).HMAC-SHA256(DESCADASTRO_SEGREDO)`, com validade de 10 anos (email antigo continua com descadastro funcionando).
  - A página mostra um botão "Confirmar descadastro". O link não age sozinho, porque leitores de link de antivírus abrem URLs.
- **One-click:** `POST /api/publico/descadastro` com o mesmo token. Atende o cabeçalho `List-Unsubscribe-Post`, que o Gmail e o Yahoo exigem em envios em massa.
- **Efeito:**
  - o contato fica `descadastrado`, de forma permanente, pelas regras atuais;
  - sai de todos os funis;
  - é removido do segmento da newsletter no Resend;
  - gera o evento `descadastrou`.
- **Proxy:** `src/proxy.ts` libera `/descadastro` e `/api/publico/*`. Cada rota pública exige token próprio, como os webhooks.

### 2.6 Newsletter (segmento e broadcast)

- **Segmento "Newsletter"** no Resend, mantido pelo painel:
  - **Entram:** contatos `lead` e `cliente` com base legal de `consentimento` ou `contrato` que estão no funil "Nutrição com o blog". A regra atual de inscrição continua.
  - **Saem:** descadastrados, apagados e quem saiu do funil.
  - **Sincronização:** pela rotina diária e na hora das mudanças, numa fila como a atual (`sync_status`).
  - **Dados enviados:** só email, nome e escritório. Nada além disso vai para o Resend (minimização).
- **Newsletter de um artigo** (parte B gera o conteúdo):
  - o painel cria o **broadcast como rascunho** no Resend, com o segmento, o assunto, o pré-cabeçalho e o HTML com `{{{RESEND_UNSUBSCRIBE_URL}}}`;
  - mostra a contagem de destinatários;
  - o botão **"Enviar newsletter"** exige confirmação na própria tela, e o envio fica registrado no artigo.
- **Agendamento:** opcional, com o `scheduled_at` do broadcast.

### 2.7 Webhook do Resend (`/api/webhooks/resend`)

- **Assinatura:** padrão Svix, verificada à mão. São os cabeçalhos `svix-id`, `svix-timestamp` (tolerância de 5 minutos) e `svix-signature`. O cálculo é HMAC-SHA256 do texto `${id}.${timestamp}.${corpo}`, usando o segredo em base64 depois de `whsec_`, com comparação em tempo constante.
- **Eventos tratados:**

  | Evento do Resend | Efeito no CRM |
  |---|---|
  | `email.delivered` | ignorado |
  | `email.opened` | evento `aberto` |
  | `email.clicked` | evento `clicado` |
  | `email.bounced` | evento `bounce`; hard bounce encerra as inscrições |
  | `email.complained` | evento `spam` e descadastra |
  | `contact.updated` com `unsubscribed: true` | descadastra; vem da página hospedada da newsletter |
- **Repetição:** a tabela `brevo_eventos_recebidos` é renomeada para `webhook_eventos_recebidos`, com a chave `svix-id`. Um evento repetido não grava nada.
- **De qual contato é o evento:** o painel encontra o contato pelo `envios_funil.resend_email_id` ou pelo email.

### 2.8 Migração dos dados

- O Brevo nunca foi conectado em produção: não há chave nem listas ligadas.
- **Colunas:**
  - `contatos.brevo_id` vira `resend_contato_id`;
  - o valor `brevo` de `contato_origem` é mantido (o enum não perde valor).
- **Removidas de `funis`:** `brevo_lista_id`, `lista_sync`, `lista_sync_erro` e `na_lista_em`.
- **Mudanças de banco:**
  - todas por `drizzle-kit push`, rodado pelo usuário;
  - o plano diz exatamente quais perguntas o push fará e o que responder;
  - a remoção de colunas só acontece depois de conferir que estão vazias.
- **Código removido:**
  - `src/lib/brevo.ts`;
  - rotas `api/crm/brevo/*`;
  - `api/webhooks/brevo`;
  - textos "Brevo" nas telas.
- **Importação de contatos do Brevo:** sai. A importação por planilha continua.

### 2.9 Pré-requisito de acesso público (decisão do usuário)

O link de descadastro, os webhooks do Resend e o formulário do site precisam alcançar o painel em produção. Hoje o **Deployment Protection da Vercel** pede login da Vercel em tudo.

O caminho recomendado é mudar a proteção para **"Standard Protection"**:

- protege só as prévias;
- a produção fica acessível, e o painel continua todo atrás da própria senha.

**Essa mudança de configuração de segurança é do usuário.** Até ela ser feita, os envios funcionam, mas o descadastro e os webhooks não chegam. Por isso o painel **não envia funis nem newsletter** enquanto a verificação de acesso público falhar. A verificação faz um GET em `/api/publico/saude` a partir do próprio servidor e espera resposta 200 sem login da Vercel. A tela de Integração mostra o status dessa verificação.

## 3. Parte B — Distribuição do artigo

### 3.1 Peças

São geradas a partir do artigo (título, HTML sem as marcas "verificar", keyword e link publicado). Cada peça é editável e pode ser regerada.

| Tipo | Conteúdo | Limites |
|---|---|---|
| `linkedin_artigo` | Título, subtítulo e corpo em blocos (parágrafo, H2, lista), adaptado ao LinkedIn: abertura com gancho, menos SEO, chamada no fim com o link do blog | 600–1.200 palavras |
| `linkedin_post` | Texto com gancho na 1ª linha, quebras curtas, 3 a 5 hashtags, chamada e link | Até 2.800 caracteres |
| `carrossel` | 6 a 8 lâminas: capa (título até 60 caracteres, subtítulo até 90); lâminas de conteúdo (título até 50, texto até 220, ou lista com até 4 itens de até 70); última lâmina de chamada (texto até 120 e "ogpericiacontabil.com.br"). Mais a legenda para o Instagram (até 2.000 caracteres, com hashtags). | Limites conferidos por Zod estrito depois da geração; o que passar é cortado na palavra |
| `newsletter` | Assunto (até 70), pré-cabeçalho (até 110), abertura curta, 3 a 5 pontos principais, botão "Ler o artigo completo" com o link do blog e UTM | — |

**Regras de conteúdo**, as mesmas do artigo:

- não prometer resultado;
- não citar honorários;
- não inventar número, lei ou decisão;
- tom de autoridade técnica falando com advogados.

Os trechos ainda marcados como "verificar" no artigo **impedem gerar as peças**: o usuário revisa o artigo primeiro.

### 3.2 Geração por IA

- A geração usa o `gerarObjetoPadrao` (OpenRouter), um schema por tipo, todos **estritos e nulláveis**. O teste `schemas-estritos` passa a cobrir também esses schemas.
- **"Gerar peças":** gera as quatro em paralelo. Cada uma tem a própria situação: `gerando` → `rascunho` | `erro`.
- **Reivindicação atômica por (artigo, tipo):** o mesmo padrão de `artigos`, com o limite de 10 minutos para uma geração presa.

### 3.3 Arte do carrossel (`src/lib/distribuicao/arte/*`)

- **Renderização:** `ImageResponse` de `next/og` (Satori), no servidor, em **1080×1350** (retrato 4:5, que serve ao Instagram e ao LinkedIn).
- **Template da marca:**
  - fundo `#0E0F11` com detalhe dourado `#DAA522`;
  - títulos em Source Serif 4 e texto em IBM Plex Sans (arquivos TTF no repositório, com a licença OFL);
  - logo em `public/logo-og.png`;
  - numeração "2/8";
  - rodapé com o domínio.
  - Há uma variação clara (fundo `#F5F3EE`), escolhida por peça.
- **Ajuste de texto:** o tamanho da fonte encolhe em degraus até caber. Se não couber nem no menor degrau, a tela avisa "texto longo demais na lâmina N" em vez de cortar em silêncio. A regra é uma função pura testada: a estimativa de linhas por largura média de caractere.
- **Rotas:**
  - `GET /api/distribuicao/[pecaId]/lamina/[n]` devolve o PNG;
  - `GET /api/distribuicao/[pecaId]/pdf` junta as lâminas num PDF com `pdf-lib`, que é a nova dependência;
  - `GET /api/distribuicao/[pecaId]/zip` devolve todos os PNGs num `.zip` com `fflate`, que também é nova.
- **Imagem gerada por IA:** fora do escopo.

### 3.4 Telas

- No editor do artigo, há uma aba nova **"Distribuição"**. Ela aparece quando o artigo está em `pronto` ou depois, com cartões para:
  - **LinkedIn — artigo:** editor de texto simples por blocos e "Copiar".
  - **LinkedIn — post:** texto, contador e "Copiar".
  - **Carrossel:** prévia das lâminas lado a lado, edição dos textos de cada lâmina, variação escura ou clara, e os botões "Baixar PNGs (.zip)" e "Baixar PDF (LinkedIn)", além de copiar a legenda.
  - **Newsletter:** prévia do email, "Criar rascunho no Resend" e "Enviar newsletter" com confirmação.
- **Cada cartão** tem "Regerar", a situação da peça, e o botão "Marcar como publicado" com campo opcional para a URL do post, para controle.
- **Tela `/distribuicao`:** lista os artigos e o estado de cada peça.

### 3.5 Publicação automática no LinkedIn e no Instagram

Fica **fora do escopo** desta fase. Ela exige aprovação de aplicativo na LinkedIn (Community Management API) e na Meta, e entra numa fase futura. Nesta fase o painel entrega tudo pronto para copiar e baixar.

## 4. Dados novos

- **`pecas_distribuicao`:**
  - `id`, `artigo_id` (FK), `tipo` (enum dos 4 tipos), `situacao` (enum `gerando` | `rascunho` | `erro` | `publicado`), `conteudo` (jsonb validado pelo schema do tipo), `variacao` (`escura` | `clara`, só no carrossel), `erro`, `publicado_em`, `url_publicada`, `modelo`, `criado_em` e `atualizado_em`;
  - único em (`artigo_id`, `tipo`).
- **`newsletters_envios`:** `id`, `artigo_id`, `resend_broadcast_id`, `situacao` (`rascunho` | `agendado` | `enviado` | `erro`), `destinatarios`, `enviado_em` e `erro`.
- **`envios_funil`:** descrita no item 2.4.

## 5. Segurança e LGPD

- **Credenciais:** nenhuma credencial vai para log, resposta ou cliente.
- **Rotas públicas:** só `/descadastro`, `/api/publico/*` e `/api/webhooks/*`, cada uma com token ou assinatura própria e comparação em tempo constante.
- **Dados enviados ao Resend:** o mínimo (item 2.6). Contato descadastrado nunca recebe nada, por nenhum caminho. Isso é testado em cada caminho de envio.
- **Prospecção fria:** continua desligada por padrão e mantém o bloco de LGPD em todo email.
- **Prompts das peças:** levam só o conteúdo do artigo, nenhum dado de contato.

## 6. Testes

- **Parte A (Resend):**
  - o cliente com `fetch` simulado (erros, 429, idempotência, a chave fora de mensagens);
  - a verificação Svix com vetores conhecidos e o caso de timestamp velho;
  - token de descadastro (validade, adulteração, expirado);
  - a fila dos funis em PGlite: etapa devida, limite diário, prioridade, descadastrado no meio da sequência, envio que nunca duplica;
  - segmento da newsletter (quem entra e quem sai);
  - o webhook (cada evento, repetição).
- **Parte B (distribuição):**
  - schemas estritos;
  - geração com IA simulada (limites e cortes);
  - ajuste de fonte;
  - a rota do PNG devolve `image/png` 1080×1350;
  - o PDF tem N páginas;
  - as telas com Testing Library.
- **Ponta a ponta**, no fim:
  - gerar as peças de um artigo real;
  - baixar o carrossel e conferir visualmente;
  - criar o rascunho da newsletter no Resend, quando a chave existir, **sem enviar**;
  - um email de funil de teste **só para o endereço do próprio usuário**, com a autorização dele.
