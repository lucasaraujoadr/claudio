# Artigos — da tese ao post publicado no WordPress

**Data:** 2026-10-29
**Base:** painel em produção (`2026-10-28-dashboard-seo-design.md`, `2026-10-29-ecossistema-design.md`).
**Pedido do usuário:** "criarmos as teses, revisar e poder criar diretamente pela plataforma, pra subir direto pro site".

## 1. Objetivo

Fechar o ciclo do conteúdo dentro do painel: a tese, ou o tema, vira um
artigo completo escrito por IA. Você revisa e edita o artigo no painel e
o envia ao WordPress de ogpericiacontabil.com.br, como rascunho, agendado
ou publicado. Depois, o artigo passa a ser acompanhado pelo SEO que já
existe (Search Console, auditoria e oportunidades).

**Pronto quando:** um artigo gerado a partir de uma tese real é revisado
no painel e aparece no site com título, endereço, meta description,
categoria e capa corretos. Editar no painel e clicar em "Atualizar no
site" muda o post sem duplicá-lo.

## 2. O que o site tem hoje (verificado)

- **Posts:** usam o editor de blocos do WordPress (`<p class="wp-block-paragraph">`),
  não o Elementor. Ficam na raiz do domínio (`/revisao-pasep/`).
- **API:** a REST `wp/v2` está aberta para leitura. A escrita exige uma
  **senha de aplicativo** (Basic Auth). A senha de login comum não
  funciona na API e nunca é usada.
- **Categorias:** 9 categorias reais (ids 12–20) e a "Uncategorized" (id 1).
- **SEO:** a meta description vem do plugin **The SEO Framework**, nos
  campos protegidos `_genesis_description` e `_genesis_title`. Esses
  campos não aparecem na REST por padrão (ver §6).
- **Cache:** o LiteSpeed Cache limpa o post sozinho ao publicar ou atualizar.

## 3. Fluxo

```
Tese (radar) ─┐
              ├─► [Gerar artigo] ─► gerando ─► rascunho ─► (revisão) ─► pronto ─┬─► rascunho no WP
Tema ─────────┘                         │                                       ├─► agendado no WP
                                        └─► erro_geracao (tentar de novo)        └─► publicado no WP
                                                                                       │
                                                       editar no painel ─► "alterado" ─► [Atualizar no site]
```

1. **Gerar.** Gerar a partir de uma tese cria, ou reaproveita, o tema da
   mesma keyword normalizada. A tese passa a `virou_artigo`. Se o tema
   ainda não tem briefing, o briefing é gerado antes. Cada tema tem no
   máximo um artigo.
2. **Pesquisa.** Uma chamada ao `perplexity/sonar-pro`, por
   `gerarObjetoComBuscaEFontes`, levanta os fatos: leis, súmulas, temas
   do STJ/STF/TST, índices e prazos. Devolve as fontes.
3. **Redação.** Uma chamada ao `openai/gpt-4.1` escreve o artigo a
   partir do briefing, das notas da pesquisa e da lista de posts
   publicados do site (para os links internos). A saída é estruturada
   (§5) e vira HTML de forma determinística.
4. **Revisão.** Abre no editor do painel. Toda afirmação que dependa de
   fato verificável (número de lei, tese de tribunal, índice, data, valor)
   vem marcada como **"verificar"**.
5. **Envio.** "Enviar como rascunho", "Agendar" ou "Publicar agora".
   Agendar e publicar exigem duas condições: "revisei o conteúdo"
   marcado, e nenhum trecho "verificar" pendente.

## 4. Telas

- **`/artigos`:** lista com título, keyword, situação, data e link para
  o post no site. Filtra por situação.
- **`/artigos/[id]`:** a tela de revisão.
  - **Coluna principal:** o editor (TipTap) com parágrafo, H2, H3,
    negrito, itálico, lista, citação e link. "Verificar" é uma marcação
    amarela; um clique a remove. Também tem "Reescrever trecho": você
    seleciona o texto, escreve uma instrução, e a IA devolve o trecho
    novo para aceitar ou descartar.
  - **Coluna lateral:**
    - título SEO (com contador; ideal até 60), endereço (slug) e meta
      description (com contador; ideal de 120 a 155);
    - categoria, carregada do WP, e capa: envio de JPEG, PNG ou WebP de
      até 4 MB, que sobe para a mídia do WP e guarda o id;
    - lista de conferência de SEO (§7);
    - fontes da pesquisa;
    - "revisei o conteúdo";
    - os botões de envio;
    - a situação no WP, com o link.
  - **Pré-visualização:** o HTML final, como vai para o site.
- **Atalhos:** "Gerar artigo" no cartão de cada tese (`/tendencias`) e
  em cada tema (`/temas`). Se o artigo já existe, o botão vira "Abrir artigo".
- **Navegação:** novo item "Artigos" no menu.

Os textos da interface seguem o padrão atual do painel (pt-BR, tema
escuro e claro, componentes de `src/components/ui`).

## 5. Formato gerado pela IA

O schema enviado ao modelo é leniente, sem min/max em strings. A
validação estrita com Zod vem depois, com o mesmo conserto determinístico
de título e meta dos briefings.

```
titulo, slug, metaDescription,
introducao: Bloco[],
secoes: [{ titulo (H2), subsecoes?: [{ titulo (H3), blocos }], blocos: Bloco[] }],
faq: [{ pergunta, resposta }],
conclusao: Bloco[]   // termina com a chamada para contato
Bloco = { tipo: 'paragrafo' | 'lista' | 'lista_numerada' | 'citacao', texto | itens[], verificar?: string }
links: os links internos aparecem no texto como [âncora](url), e só são aceitos se a url estiver na lista de posts enviada.
```

- **Conversão:** `paraHtml()` transforma a saída em HTML. Um bloco com
  `verificar` vira `<mark data-verificar="motivo">`. Um link que não
  está na lista vira texto simples.
- **Tamanho:** de 1.200 a 2.000 palavras. Abaixo de 900, a lista de
  conferência avisa.
- **Proibido no texto** (instrução ao modelo e verificação depois):
  - prometer resultado de processo;
  - citar valores de honorários;
  - inventar número de processo.

  A chamada final convida o advogado a falar com a OG, sem
  sensacionalismo (código de ética do CFC).

## 6. Integração com o WordPress (`src/lib/wordpress.ts`)

- **Variáveis de ambiente:** `WP_URL` (padrão: `siteUrl()`), `WP_USUARIO` e
  `WP_SENHA_APP`. Ficam só na Vercel e no `.env.local`, e nunca vão para
  log nem para o cliente. Sem elas, os botões de envio ficam desativados
  com o aviso "WordPress não configurado". Gerar e editar continuam
  funcionando.
- **Funções:**
  - `listarCategorias()`, com cache de 1 h;
  - `enviarImagem(arquivo)`, que chama `POST /wp/v2/media` e devolve o id;
  - `criarPost(dados)` e `atualizarPost(id, dados)`;
  - `lerPost(id)`, que devolve status, link, `modified_gmt` e meta;
  - `slugEmUso(slug, exceto?)`.
- **Envio:** `status` (`draft`, `future` com `date_gmt`, ou `publish`),
  `title`, `slug`, `content` (HTML convertido para a marcação de blocos
  do Gutenberg: `<!-- wp:paragraph -->…`, `wp:heading`, `wp:list`,
  `wp:quote`), `excerpt` = meta description, `categories`,
  `featured_media` e `meta._genesis_description`/`_genesis_title`.
- **Marcas "verificar":** removidas do HTML enviado (o texto fica, sem a
  marcação). Agendar e publicar ficam bloqueados enquanto houver alguma.
- **Meta do The SEO Framework:** esses campos só gravam pela REST se
  forem registrados com `show_in_rest`. Depois de cada envio, o painel
  lê o post de volta.
  - Se o campo voltou, ótimo.
  - Se não voltou, o painel mostra "a meta description foi para o resumo
    do post; libere o campo no WP para gravar direto". O The SEO
    Framework usa o resumo como descrição quando o campo está vazio,
    então o resultado no Google é o mesmo.
  - O trecho que libera o campo (um mu-plugin de ~10 linhas, com
    `register_post_meta` e `auth_callback` = `edit_posts`) fica no
    README. **Instalar no site é uma alteração no WordPress de produção
    e só acontece com aprovação explícita do usuário.**
- **Conflito:** o `modified_gmt` é guardado a cada envio. Antes de
  atualizar, o painel lê o post. Se ele mudou no WP desde então, aparece
  o aviso "este post foi editado no WordPress depois do último envio".
  A opção é sobrescrever ou cancelar; nunca sobrescreve em silêncio.
- **Post apagado no WP** (404 na leitura): o artigo volta a "pronto" sem
  `wpPostId` e o envio cria outro post.
- **Slug em uso por outro post:** o envio é bloqueado com a mensagem
  "endereço já usado em <link>".
- **Erros:** 401/403 → "senha de aplicativo inválida ou usuário sem
  permissão de Editor"; rede e 5xx → mensagem simples com a opção de
  tentar de novo. O erro fica gravado no artigo e nada é marcado como
  enviado.

## 7. Lista de conferência de SEO (`src/lib/artigos/conferencia.ts`)

É uma função pura sobre o artigo. Cada item é `ok`, `aviso` ou
`bloqueia`. Bloqueia, em agendar e publicar:

- trecho "verificar" pendente;
- título vazio;
- slug inválido ou em uso;
- "revisei o conteúdo" desmarcado.

Avisos:

- keyword fora do título;
- keyword fora do primeiro parágrafo;
- keyword fora do slug;
- título acima de 60 caracteres;
- meta fora da faixa de 120 a 155 caracteres;
- menos de 2 links internos;
- menos de 900 palavras;
- sem H2;
- sem capa;
- sem categoria (vira "Uncategorized");
- H2 repetido.

## 8. Dados

Tabela nova `artigos`:

| Campo | Tipo e observação |
|---|---|
| `id` | serial |
| `topic_id` | único, FK topics |
| `tese_id` | FK teses_sugeridas, opcional |
| `situacao` | enum `gerando`, `erro_geracao`, `rascunho`, `pronto`, `agendado`, `publicado` |
| `titulo` | |
| `slug` | |
| `meta_description` | |
| `conteudo_html` | sanitizado no servidor, lista branca de tags |
| `fontes` | jsonb `{titulo?, url}[]`, só http(s) e sem repetição |
| `categoria_id` | int, opcional |
| `capa_media_id` | int, opcional |
| `capa_url` | opcional |
| `revisado` | bool |
| `agendado_para` | timestamptz, opcional |
| `wp_post_id` | opcional |
| `wp_status` | |
| `wp_link` | |
| `wp_modificado_gmt` | |
| `enviado_em` | |
| `alterado_apos_envio` | bool |
| `erro` | text, opcional |
| `modelo` | |
| `gerado_em` | |
| `criado_em` | |
| `atualizado_em` | |

Outras mudanças no banco:

- O enum `tese_status` ganha `virou_artigo`.
- **Concorrência:** gerar faz uma reivindicação atômica (insert com
  `situacao='gerando'` e conflito no `topic_id`). Dois cliques não pagam
  duas gerações. Um `gerando` com mais de 10 min é considerado preso, e
  a geração pode ser tentada de novo.
- **Ao publicar** (`wp_status=publish`):
  - `topics.status='publicado'`;
  - `topics.url_publicada=wp_link`.
- **Ao agendar:** o cron diário consulta o WP. Quando o post já estiver
  publicado, atualiza para `publicado` da mesma forma.
- **Mudança de schema:** pelo `drizzle-kit push`. Nunca DDL à mão. Sem
  mudar a migração pendente do `funil_inscricoes` (fora do escopo).

## 9. Depois de publicar

- "Criar campanha no Brevo com este artigo": reaproveita
  `criarRascunhoCampanhaBlog(topicId)`. Só aparece com o Brevo configurado.
- O post entra no rastreamento normal: auditoria, Search Console e
  oportunidades. Não há código novo além do `url_publicada`.

## 10. Fora do escopo

- Imagem gerada por IA.
- Tags do WP.
- Publicar em redes sociais.
- Editar no painel posts antigos criados direto no WP.
- Vários autores.

## 11. Segurança e LGPD

- As rotas e server actions ficam atrás da sessão do painel, como hoje.
- **Credenciais:** só em variável de ambiente. Nunca vão para log, para
  a resposta da API, nem para o cliente.
- **HTML:**
  - sanitizado ao salvar e ao enviar;
  - lista branca: `p h2 h3 strong em ul ol li blockquote a mark br`;
  - `href` só http(s), mais âncoras internas.
- **Prompts:** sem dado de contato do CRM; só o conteúdo do site e do tema.
- **Upload:** tipo conferido pelos bytes iniciais, não pela extensão;
  limite de 4 MB (o corpo de uma função Vercel vai até 4,5 MB).

## 12. Testes

- **Funções puras:**
  - `paraHtml`;
  - a conversão para blocos do Gutenberg;
  - a sanitização (incluindo `javascript:`, `onerror` e `<script>`);
  - a lista de conferência;
  - a remoção das marcas "verificar".
- **Cliente WP:** testado com um `fetch` simulado. Casos:
  - criar, atualizar, conflito de `modified_gmt` e 404;
  - 401 e 403, slug em uso, meta não gravada;
  - o Basic Auth montado sem aparecer em erro nenhum.
- **Banco (PGlite):**
  - reivindicação atômica e o `gerando` preso;
  - tese virando `virou_artigo`;
  - tema virando publicado;
  - o cron de agendados.
- **IA:** testada com `GerarObjeto` simulado. Casos:
  - link interno fora da lista vira texto;
  - schema estrito rejeita e repara.
- **Ponta a ponta:**
  - no fim, uma geração real com a chave OpenRouter;
  - com a senha de aplicativo cadastrada, um envio real **como
    rascunho** (nunca publicado sem o usuário), conferido no WP e depois
    apagado por ele;
  - o resto validado no navegador com o `agent-browser`.
