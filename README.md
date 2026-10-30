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
- Todo dia às **04:00 (horário de Brasília)** roda `/api/cron/tendencias` (radar de tendências): uma busca na web (modelo com busca, via OpenRouter) por decisões, leis e índices dos últimos 7 dias e uma geração de até 8 teses de artigo. Só vira tendência o item cuja URL é http(s), não é página de busca ou listagem e foi realmente citada pelo provedor de busca; o resto é descartado e contado. O potencial das teses é uma **estimativa qualitativa do modelo**, não volume de busca. Os termos em alta usam o Search Console (impressões de 28 dias contra os 28 anteriores, por query); sem dados, a tela diz isso. O resultado fica em `sincronizacoes` (`fonte = 'tendencias'`) e a tela é **Tendências**.
- Teto de custo do radar: no máximo uma busca e uma geração de teses por execução (a busca pode ser repetida uma vez pelo cliente se o JSON vier fora do formato). Se o radar já terminou com sucesso no dia (fuso de Brasília), nem uma nova tentativa do cron nem o botão "Atualizar agora" gastam de novo; a tela passa a oferecer "Atualizar mesmo assim" (`forcar`), que gasta uma busca e uma geração a mais.
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
| `RESEND_API_KEY` | Chave de API do Resend (Resend → API Keys → Create API Key, permissão de envio). Opcional: sem ela o CRM funciona, os contatos ficam "pendente", nenhum email sai e a tela **CRM → Integração** diz "Resend não conectado". |
| `RESEND_REMETENTE` | Remetente com domínio verificado no Resend, ex.: `Oliveira Guimarães <contato@ogpericiacontabil.com.br>`. Sem ele (ou sem a chave) o Resend conta como não conectado. |
| `RESEND_RESPONDER_PARA` | Endereço que recebe as respostas aos emails (cabeçalho Reply-To). Opcional. |
| `RESEND_WEBHOOK_SECRET` | Segredo de assinatura do webhook do Resend (Webhooks → o webhook → Signing Secret, começa com `whsec_`). Sem ele o webhook recusa tudo. |
| `RESEND_LIMITE_DIARIO` | Quantos emails de funil a rotina diária pode enviar por dia. Opcional; o padrão é 90 (o plano gratuito do Resend permite 100 por dia). O que passar do limite fica para o dia seguinte, com a boas-vindas na frente. |
| `DESCADASTRO_SEGREDO` | Texto aleatório longo (`openssl rand -base64 32`) que assina o token do link de descadastro de cada email. Sem ele, nenhum email de funil sai. **Trocar o valor invalida os links de descadastro dos emails já enviados**: não troque sem necessidade. |
| `URL_PUBLICA_PAINEL` | Endereço público do painel, sem barra no final (ex.: `https://claudio-psi-lime.vercel.app`). É o que vai nos links de descadastro e na verificação de acesso público. Opcional: o padrão é o domínio de produção atual. |
| `SITE_WEBHOOK_TOKEN` | Token do webhook do formulário do site (`/api/webhooks/site?token=…`). Já configurado. Sem ele o webhook recusa tudo. |
| `WHATSAPP_LINK` | Link do WhatsApp do escritório (ex.: `https://wa.me/55…`). Opcional: entra no lugar de `[link do WhatsApp]` nos emails prontos dos funis. |

## Resend, webhooks e acesso público (CRM)

- O CRM é a fonte da verdade; o **painel envia os emails pelo Resend** (funis, pela rotina diária; a newsletter, pela distribuição dos artigos). A tela **CRM → Integração** mostra se o Resend está conectado, o domínio remetente, quantos contatos estão pendentes/com erro, o estado do acesso público, o botão **Sincronizar agora** e o passo a passo do DNS, do webhook do Resend e do webhook do Elementor.
- Para o Resend vão só o **email e o nome** (e, no corpo do email, o nome na saudação). Telefone, escritório, cidade, notas e tags ficam só no CRM. Contato descadastrado ou com dados apagados nunca entra no segmento da newsletter e vai ao Resend só como supressão.
- Editar telefone, cidade, escritório, UF, tags ou notas não deixa o contato "pendente"; mudar nome, status ou base legal deixa.

### Domínio remetente (DNS)

1. No Resend: **Domains → Add Domain** e adicione `ogpericiacontabil.com.br`.
2. O Resend mostra os registros DNS (SPF, DKIM e, opcionalmente, DMARC). Copie cada um exatamente como aparece (tipo, nome e valor).
3. Na Hostinger: **Domínios → ogpericiacontabil.com.br → DNS / Zona DNS** e crie os registros, um a um. Se já existir um registro SPF (TXT começando com `v=spf1`), não crie um segundo: o Resend informa como combinar.
4. De volta ao Resend, clique em **Verify**. A propagação leva de minutos a algumas horas.
5. Defina `RESEND_REMETENTE` com um endereço desse domínio e faça um novo deploy.

### Webhook do Resend

- URL: `<URL_PUBLICA_PAINEL>/api/webhooks/resend` (a tela de Integração mostra a URL pronta).
- No Resend: **Webhooks → Add Webhook**, cole a URL e assine estes eventos: `email.opened`, `email.clicked`, `email.bounced`, `email.complained` e `contact.updated`. Copie o **Signing Secret** para `RESEND_WEBHOOK_SECRET` na Vercel e faça um novo deploy.
- A assinatura (padrão Svix) é verificada em tempo constante, com tolerância de 5 minutos no timestamp. O mesmo `svix-id` repetido não grava nada (tabela `webhook_eventos_recebidos`).
- Efeitos: abertura e clique entram só na linha do tempo; reclamação de spam e `contact.updated` com `unsubscribed: true` (descadastro pela página hospedada do Resend) viram "Descadastrado" e tiram o contato dos funis; bounce permanente tira o contato dos funis sem mudar o status (não é pedido de descadastro, e o Resend já suprime o endereço); bounce temporário só entra na linha do tempo. Evento de email que não está no CRM é aceito e ignorado.
- `POST /api/webhooks/site?token=…`: ação "Webhook" do Elementor Forms, com ou sem "Dados avançados" (form-urlencoded) ou JSON. Cria/atualiza o lead com origem "Site" e base legal "Consentimento"; a mensagem fica na linha do tempo. Até 60 envios por minuto por IP; corpo de até 64 KB. E-mail inválido ou acima do limite responde HTTP 200 `{ok:false}` sem gravar nada (o Elementor trata qualquer outro status como falha e mostraria erro ao visitante; o envio só não aparece no CRM). Token errado responde 401.

### Proteção da Vercel (acesso público)

O link de descadastro, os webhooks e o formulário do site precisam alcançar o painel em produção sem o login da Vercel. Hoje a produção está atrás do **Deployment Protection**.

- **Decisão: mudar para "Standard Protection"** (Vercel → Settings → Deployment Protection). Ela protege só as prévias; a produção fica acessível, e o painel continua todo atrás da própria senha (`DASHBOARD_PASSWORD`). Essa é uma mudança de segurança do projeto e é sua.
- **Por que o envio fica bloqueado sem isso:** sem acesso público o descadastro não abriria e os webhooks não chegariam, e enviar email sem poder descadastrar fere a LGPD. A rotina diária faz um GET em `/api/publico/saude` a partir do próprio servidor e só envia se vier 200 com `{ok:true}`; senão, nenhum email de funil sai (ficam na fila do dia seguinte) e a tela de Integração mostra "Bloqueado" com a instrução. A checagem é refeita sozinha a cada poucos minutos.
- As únicas rotas públicas são `/descadastro`, `/api/publico/*` e `/api/webhooks/*`; cada uma exige token ou assinatura. O link de descadastro aberto por antivírus (GET) não descadastra: só o POST com o token.

## Funis (CRM → Funis)

- Quatro funis. Em cada um, a tela mostra as etapas (assunto, espera em dias e a **prévia renderizada** do email, como o contato recebe), os **envios dos últimos 30 dias** (enviados e erros), a **fila de hoje** e os membros.
  - **Boas-vindas** (ligado): entra automaticamente o lead que preenche o formulário do site. Logo depois da resposta ao Elementor (`after()`) a primeira etapa é enviada na hora, se houver acesso público; senão sai na rotina diária.
  - **Nutrição com o blog** (ligado): leads e clientes com base legal de consentimento ou contrato, inscritos pela tela (emails colados ou uma tag de importação). Não tem sequência: a inscrição define quem recebe a **newsletter** dos artigos novos (distribuição dos artigos).
  - **Reativação** (ligado): clientes **sem interação real** há 180 dias, inscritos pela rotina diária, no máximo 50 por dia. Conta como interação: formulário, clique em email, mudança de status, edição manual e a criação do contato. Não contam: envio e abertura de email (o Apple Mail "abre" sozinho), importação, sincronização e entrada/saída de funil. A rotina reinscreve só quem **concluiu** a sequência há mais de 180 dias — nunca quem foi removido à mão.
  - **Prospecção fria** (**desligado por padrão**): só leads com base legal de legítimo interesse. Para ligar, a tela exige marcar o checklist de LGPD (avaliação de legítimo interesse documentada, fonte dos contatos documentada, descadastro em todo email, volume baixo e aquecido) e um teto diário; a data da confirmação fica gravada. Todo email desta série termina com um bloco fixo: a base legal, a fonte do contato (`[fonte do contato]`, a trocar: email com esse marcador não é enviado), a oferta de explicar a fonte, apagar o dado ou parar de enviar, e o descadastro.
- **Rotina diária** (`/api/cron/diario`, fonte `funis` em `sincronizacoes`): garante os quatro funis, apaga lotes de planilha com mais de 24 horas, tira descadastrados, inscreve a reativação e a prospecção fria (se ligada, no teto), sincroniza os contatos pendentes com o Resend e envia as etapas devidas, até `RESEND_LIMITE_DIARIO`, com a boas-vindas na frente. Sem `RESEND_API_KEY`/`RESEND_REMETENTE`, as inscrições e a limpeza continuam, nenhum email sai e a fonte aparece como "não configurada". Uma falha aqui não afeta o Search Console nem o GA4. Passados 90 s, a etapa para entre subetapas e lotes e registra "Interrompido por tempo" (o restante segue no dia seguinte).
- **Concluído:** depois do último email da sequência, a inscrição fica concluída.
- **Falhas de envio:** recusa do Resend sobre o contato é tentada de novo no dia seguinte, até 3 tentativas (na 3ª o contato sai do funil); erro da conta (limite, chave inválida) não conta tentativa. Se a resposta do Resend **não voltou** (rede ou erro 5xx), o email pode ter saído: ele **nunca é repetido sozinho** e aparece na tela do funil em **"Envios a conferir no Resend"**, com contato, etapa e data. Confira no painel do Resend se saiu; a sequência desse contato fica parada nessa etapa até alguém resolver (por exemplo, removendo o contato do funil).
- Contato **descadastrado** nunca entra em funil e sai de todos ao se descadastrar (link do email, webhook do Resend, mudança manual de status ou, por segurança, na rotina diária). A checagem é refeita imediatamente antes de cada envio. Reativar no CRM só libera o contato: ele não volta sozinho a funil nem à newsletter.
- **Apagar dados a pedido** (LGPD art. 18, no detalhe do contato): apaga nome, telefone, escritório, cidade, UF, notas, tags e os detalhes da linha do tempo e marca como descadastrado; fica só o email, para que planilha, formulário ou importação não cadastrem a pessoa de novo. Não tem volta: o contato não pode mais ser editado nem reativado. No Resend o contato fica só como supressão; para apagar o registro de lá, apague o contato no próprio Resend.
- Entrar e sair ficam na linha do tempo do contato (`entrou_funil`, `saiu_funil`).
- Marcadores nos emails: `[link do WhatsApp]` é trocado automaticamente quando `WHATSAPP_LINK` está definido (sem ele, a frase do WhatsApp sai do email); `[fonte do contato]` (prospecção fria) é trocado à mão.
- A origem `brevo` dos contatos antigos continua existindo e aparece como "Brevo (legado)"; o painel não usa mais o Brevo.

## Banco de dados: `drizzle-kit push` (para quem roda o push)

O schema muda só em `src/lib/db/schema.ts`; o `drizzle-kit push` é rodado por você, nunca pelo agente. **O push e o deploy do código precisam acontecer juntos**: o código antigo lê colunas que o push remove (`brevo_id`, `brevo_lista_id`, `lista_sync`, `na_lista_em`) e quebra se o push vier antes do deploy, e o código novo quebra se o deploy vier antes do push.

Antes, confirme no banco que o que sai está vazio ou é descartável: `select count(*) from contatos where brevo_id is not null`; `select count(*) from funis where brevo_lista_id is not null`; `select count(*) from brevo_eventos_recebidos`; e, se a tabela `envios_funil` já existir, `select count(*) from envios_funil` (o Brevo nunca foi conectado em produção; o esperado é 0 em tudo).

Perguntas esperadas e respostas:

1. Enums e tabelas novas (`envio_status` com `enviado | erro | incerto`, `newsletter_situacao`, `peca_tipo`, `peca_situacao`, `envios_funil`, `newsletters_envios`, `pecas_distribuicao`): sem pergunta. `envios_funil` nasce com as colunas `rodada` (obrigatória), `tentativas` e `primeira_tentativa_em`, e com o índice único `envios_funil_inscricao_rodada_etapa_uq` (inscrição, rodada, etapa). Se a tabela já existisse de um push anterior, o push acrescentaria o valor `incerto` ao enum, as três colunas e trocaria o índice antigo `envios_funil_inscricao_etapa_uq` pelo novo; a coluna `rodada` é `not null` sem padrão, então isso só funciona com a tabela vazia (se perguntar se pode truncar a tabela, responda sim, depois de conferir que ela está vazia).
2. "Is `resend_contato_id` column in `contatos` table created or renamed from another column?": **rename from `brevo_id`** se a contagem de `brevo_id` não nulo for 0 (evita aviso de perda). Se houver valores, responda **create column** (não leve ids do Brevo para o campo do Resend) e aceite o drop.
3. "Is `webhook_eventos_recebidos` table created or renamed from another table?": **create table** (as colunas são diferentes das de `brevo_eventos_recebidos`; um rename abriria perguntas de coluna e deixaria `contato_id` NOT NULL).
4. Aviso de perda de dados ao remover `brevo_eventos_recebidos` ("table with N items"): **yes**, depois de confirmar que o conteúdo é descartável.
5. Aviso ao remover `funis.brevo_lista_id` (o índice `funis_brevo_lista_id_uq` cai junto, sem pergunta): **yes**, se todos forem nulos. Não há coluna nova em `funis`, logo não há pergunta de rename.
6. Avisos ao remover `funil_inscricoes.lista_sync`, `lista_sync_erro` e `na_lista_em` ("column ... with N items"): **yes**. Também não há coluna nova nessa tabela.
7. Qualquer outra pergunta de rename (por exemplo envolvendo `rodada`, `tentativas` ou `primeira_tentativa_em` em `envios_funil`): **create**; nada ali vem de coluna antiga.
8. Confirmação final ("Yes, I want to execute all statements"): sim, depois de ver a lista.

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

## Artigos e WordPress

O módulo **Artigos** gera um artigo com IA a partir de uma tese ou tema escolhido e envia o resultado ao WordPress do site.

Fluxo: escolha a tese ou o tema → **Gerar artigo** → revise no editor → envie como **rascunho**, **agendado** ou **publicado**. Publicar exige marcar "revisei o conteúdo" e não pode haver nenhum trecho marcado "verificar".

> **Antes de publicar este código**, rode `npx dotenv -e .env.local -- npx drizzle-kit push` para criar as tabelas e colunas novas do módulo.

Variáveis de ambiente (na Vercel, como as demais):

| Variável | De onde vem |
| --- | --- |
| `WP_USUARIO` | Login do usuário do WordPress que cria os artigos (um usuário com função **Editor**). |
| `WP_SENHA_APP` | Senha de aplicativo desse usuário. **Não** é a senha de login. Veja como criar abaixo. |
| `WP_URL` | Opcional: endereço do WordPress. Se não estiver definida, usa `SITE_URL`. |

### Criar a senha de aplicativo

1. No wp-admin, vá em **Usuários** e abra o usuário com função **Editor**.
2. Role até **Senhas de aplicativo**, digite o nome **Painel SEO** e clique em **Adicionar**.
3. Copie a senha exibida. Ela tem 6 grupos de 4 letras ou números, separados por espaço, e aparece só uma vez. Cadastre-a como `WP_SENHA_APP` na Vercel.

### Meta description (opcional: mu-plugin)

Por padrão, a meta description vai para o **resumo** (excerpt) do post. Para gravá-la no campo do The SEO Framework (`_genesis_description`), é preciso instalar o mu-plugin abaixo, que expõe esses campos na API REST do WordPress.

> **Atenção:** instalar o mu-plugin altera o site de produção. Essa decisão é do dono do site. Não instale sem combinar. O arquivo vai em `wp-content/mu-plugins/`.

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

### Rotina diária e agendamentos

A rotina diária (`/api/cron/diario`) também sincroniza os artigos agendados no WordPress. O painel só fica sabendo que o WordPress publicou um agendado quando essa rotina roda, então essa visão pode ficar até um dia atrasada. O envio, porém, sempre consulta o WordPress antes de agir, então um post já no ar nunca é tirado do ar por engano.

Para despublicar um artigo, use o wp-admin; o painel não despublica.

### Se um envio falhar

Se o envio falhar depois que o WordPress já criou o post (por exemplo, por timeout), o próximo envio do mesmo artigo é bloqueado com a mensagem `endereço já usado em <link>`. Apague ou renomeie esse post no wp-admin e envie de novo.
