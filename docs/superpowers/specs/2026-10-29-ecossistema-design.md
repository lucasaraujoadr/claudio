# Ecossistema OG — SEO, dados diários e CRM

**Data:** 2026-10-29
**Base:** o painel de SEO entregue em `docs/superpowers/specs/2026-10-28-dashboard-seo-design.md`, já em produção.
**Aprovação:** o usuário autorizou explicitamente aprovar spec e plano sem consulta e executar até o fim.

## 1. Objetivo

Transformar o painel de SEO no sistema central de marketing da Oliveira
Guimarães — cálculos e perícias: dados de busca e tráfego atualizados
sozinhos todo dia, radar diário de temas em alta com sugestão de teses,
e um CRM que guarda os contatos e dispara funis de email pelo Brevo.

O usuário pediu, nas palavras dele: "centralizar tudo aqui dentro".

## 2. Decisões do usuário

| Pergunta | Resposta | Como foi lida |
|---|---|---|
| Ligação com o Google | "tudo" | Search Console **e** Analytics, feitos por mim pelo Chrome dele |
| Design | "tudo" | Tema escuro e claro, com alternância, seguindo a preferência do sistema |
| Origem dos contatos | "do melhor jeito" | As quatro: formulário do site, planilha, cadastro manual, Brevo |
| Funis | "do melhor jeito" | Boas-vindas, nutrição com o blog e reativação ativos; prospecção fria pronta e **desligada** |
| IA | chave OpenRouter fornecida | OpenRouter substitui a OpenAI direta |

## 3. Quatro subprojetos

Cada um é entregue funcionando antes do próximo depender dele.

### A. Ligar o que já existe

- **IA via OpenRouter.** `OPENROUTER_API_KEY` já está na Vercel. O cliente
  único (`src/lib/ai/cliente.ts`) passa a falar com
  `https://openrouter.ai/api/v1`. `OPENAI_API_KEY` continua aceita como
  alternativa. Modelo padrão `openai/gpt-4.1`; modelo com busca na web
  `perplexity/sonar-pro`. A disciplina de schema leniente para o modelo e
  validação estrita depois continua obrigatória.
- **Validação ao vivo:** uma pesquisa de temas real e um briefing real,
  gravados no banco de produção — são o primeiro uso de verdade.
- **Google:** conta de serviço criada no Google Cloud do usuário, com
  Search Console API e Google Analytics Data API habilitadas, adicionada
  como usuário restrito na propriedade `sc-domain:ogpericiacontabil.com.br`
  e como Leitor na propriedade GA4. Feito pelo controlador no navegador.
  Se o Google exigir senha ou 2FA, essa parte para e o resto segue.

### B. Redesign

- Identidade: logo em dourado (`#D8A020` aproximado, refinado na
  implementação) sobre fundo transparente; nome "Oliveira Guimarães —
  cálculos e perícias".
- Dois temas, escuro (grafite quase preto, dourado em destaques e
  números) e claro (gelo/branco, dourado como acento, grafite no texto),
  com botão de alternância e padrão pela preferência do sistema. Tokens de
  cor em CSS custom properties; contraste AA em ambos.
- Barra lateral com o logo, navegação agrupada (Visão geral · SEO · Dados ·
  CRM), cartões, tabelas legíveis, estados vazios ilustrados.
- Gráficos onde há série temporal: cliques/impressões por dia, sessões por
  dia, problemas da auditoria por severidade.
- Regra central do projeto continua: dado ausente nunca aparece como zero.

### C. Dados diários e radar de temas

- **GA4:** sincronização diária de sessões, usuários, sessões engajadas e
  eventos-chave por dia, e por página de destino e origem/mídia dos últimos
  28 dias. Tabelas próprias. Visão geral e uma tela de tráfego leem delas.
- **Cron:** a rotina diária passa a fazer Search Console + Analytics; uma
  segunda rotina diária faz o radar de temas. Se o plano Hobby limitar o
  número de crons, as duas viram uma só rotina orquestrada.
- **Radar de temas em alta:** modelo com busca na web pesquisa os últimos
  7 dias de decisões do STF/STJ/TST/TRFs, leis, índices (Selic, IPCA-E,
  TR) e teses (revisional bancária, PASEP, RMC, trabalhistas) relevantes a
  cálculos judiciais e perícia contábil. Cada tendência guarda título,
  resumo, **URL da fonte**, data e palavras-chave. Sem fonte, não grava.
- **Teses sugeridas:** cruzam as tendências com os termos que estão
  subindo no Search Console (impressões da janela atual contra a anterior)
  e com os temas já existentes. Cada sugestão traz justificativa, keyword
  principal, intenção e uma **estimativa de potencial** marcada na tela
  como estimativa do modelo, não medição. Botão "virar tema" reaproveita a
  normalização de keyword (sem duplicar).

### D. CRM + Brevo

- **O CRM é a fonte da verdade** dos contatos e da participação nos
  funis. O Brevo é o motor de envio.
- **Contatos:** nome, email (único, normalizado), telefone, escritório,
  cidade/UF, origem (`site`, `planilha`, `manual`, `brevo`), base legal
  LGPD (`consentimento`, `legitimo_interesse`, `contrato`), status (`lead`,
  `cliente`, `inativo`, `descadastrado`), tags, notas, id no Brevo,
  situação de sincronização.
- **Linha do tempo** por contato: criado, entrou/saiu de funil, enviado,
  aberto, clicado, descadastrado, bounce, mudança de status.
- **Entradas:** webhook do formulário do site (Elementor Forms) com token;
  importação de planilha CSV com mapeamento de colunas e base legal
  obrigatória para o lote; cadastro manual; importação dos contatos do
  Brevo.
- **Funis:** cada funil corresponde a uma lista no Brevo; a sequência de
  emails roda numa automação do Brevo disparada por "contato adicionado à
  lista" (automações não são criáveis por API — o painel mostra o passo a
  passo e os textos prontos dos emails).
  - Boas-vindas de lead do site — entrada automática pelo formulário.
  - Nutrição com o blog — quando um tema vira `publicado`, o painel cria
    um **rascunho** de campanha no Brevo para os inscritos. Nunca envia
    sozinho.
  - Reativação de clientes — status `cliente` sem interação há 180 dias.
  - Prospecção fria — **desligada por padrão**; para ligar exige base
    legal `legitimo_interesse` registrada, descadastro em todo email e
    teto diário de envios.
- **Webhook do Brevo:** eventos de descadastro, bounce, abertura e clique
  atualizam a linha do tempo; descadastro e hard bounce mudam o status e
  tiram o contato de todos os funis. Contato descadastrado nunca volta a
  ser sincronizado para lista.
- **Sem chave do Brevo** (o usuário ainda vai criar a conta): o CRM
  funciona por completo, a sincronização fica pendente e a tela diz
  "Brevo não conectado". Ao configurar `BREVO_API_KEY`, um botão
  sincroniza o que estiver pendente.

## 4. Segurança

- Todos os webhooks exigem token próprio (`SITE_WEBHOOK_TOKEN`,
  `BREVO_WEBHOOK_TOKEN`), comparado em tempo constante, falhando fechado
  sem a variável. O proxy libera `/api/webhooks/*` pelo mesmo motivo que
  libera `/api/cron/*`: quem chama não tem cookie.
- Nenhum segredo em arquivo versionado. Chaves só na Vercel e no
  `.env.local`.
- Dados de contato são pessoais (LGPD): nada de contato vai para o prompt
  de IA.

## 5. Fora de escopo

- Envio de email pelo próprio painel (o Brevo envia).
- Publicação automática no WordPress.
- Redes sociais.
- Login por usuário (continua senha única + SSO da Vercel).

## 6. Critério de entrega

Cada subprojeto: testes, build, revisão por tarefa, deploy em produção e
verificação nas telas reais. No fim, revisão do branch inteiro e resumo ao
usuário com tudo o que ficou pendente e por quê.
