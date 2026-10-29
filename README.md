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
| `BREVO_API_KEY` | Chave de API do Brevo (Brevo → SMTP e API → Chaves de API). Opcional: sem ela o CRM funciona, os contatos ficam "pendente" e a tela **CRM → Integração** diz "Brevo não conectado". |
| `BREVO_WEBHOOK_TOKEN` | Token do webhook de eventos do Brevo (`/api/webhooks/brevo?token=…`). Já configurado. Sem ele o webhook recusa tudo. |
| `SITE_WEBHOOK_TOKEN` | Token do webhook do formulário do site (`/api/webhooks/site?token=…`). Já configurado. Sem ele o webhook recusa tudo. |
| `WHATSAPP_LINK` | Link do WhatsApp do escritório (ex.: `https://wa.me/55…`). Opcional: entra no lugar de `[link do WhatsApp]` nos emails prontos dos funis. |
| `BREVO_REMETENTE_EMAIL` / `BREVO_REMETENTE_NOME` | Remetente (já validado no Brevo) dos rascunhos de campanha da nutrição com o blog. Opcional: sem ele, a tela mostra o texto para copiar. |

## Brevo e webhooks (CRM)

- O CRM é a fonte da verdade; o Brevo só envia os emails. A tela **CRM → Integração** mostra o estado da conexão, quantos contatos estão pendentes/sincronizados/com erro, o botão **Sincronizar agora** e as duas URLs de webhook (com o token, mascarado, com botões de mostrar e copiar), com o passo a passo para o Brevo e para o Elementor.
- Atributos que precisam existir no Brevo (Contatos → Configurações → Atributos de contato, tipo Texto): `NOME`, `TELEFONE`, `ESCRITORIO`, `CIDADE`, `UF`. Campo vazio no CRM não é enviado.
- Contato **descadastrado** nunca é adicionado a lista do Brevo: na sincronização vai bloqueado (`emailBlacklisted`) e é tirado de toda lista.
- `POST /api/webhooks/brevo?token=…`: descadastro, hard bounce e spam viram "Descadastrado" e tiram o contato dos funis; abertura, clique e entrega só entram na linha do tempo. O mesmo evento repetido não grava nada (tabela `brevo_eventos_recebidos`). Email que não está no CRM e evento desconhecido são aceitos e ignorados.
- `POST /api/webhooks/site?token=…`: ação "Webhook" do Elementor Forms, com ou sem "Dados avançados" (form-urlencoded) ou JSON. Cria/atualiza o lead com origem "Site" e base legal "Consentimento"; a mensagem fica na linha do tempo. Até 60 envios por minuto por IP; corpo de até 64 KB. E-mail inválido ou acima do limite responde HTTP 200 `{ok:false}` sem gravar nada (o Elementor trata qualquer outro status como falha e mostraria erro ao visitante; o envio só não aparece no CRM). Token errado responde 401.
- **Atenção:** a produção está atrás da proteção de login da Vercel (Deployment Protection), então o Brevo e o Elementor ainda **não conseguem** chamar `/api/webhooks/*`. Para ligar, restrinja a proteção às prévias (Preview) ou crie um "Protection Bypass for Automation" e acrescente `&x-vercel-protection-bypass=…` às URLs.

## Funis (CRM → Funis)

- Quatro funis, cada um ligado a uma lista do Brevo; a sequência de emails roda numa **automação do Brevo** disparada por "contato adicionado à lista" (automações não podem ser criadas pela API — a tela mostra o passo a passo e os três emails prontos de cada funil, com botões de copiar).
  - **Boas-vindas** (ligado): entra automaticamente o lead que preenche o formulário do site. Com chave e lista conectada, logo depois da resposta ao Elementor (`after()`) o contato é enviado ao Brevo e posto na lista (timeout de 5 s por chamada); se falhar, fica pendente para a rotina diária.
  - **Nutrição com o blog** (ligado): leads e clientes com base legal de consentimento ou contrato, inscritos pela tela (emails colados ou uma tag de importação). Em **Temas**, um tema publicado oferece "Criar rascunho de campanha no Brevo": cria só um **rascunho** para a lista deste funil, com título, resumo e link do artigo — o painel **nunca envia**. Sem chave, sem lista ou sem remetente, a tela mostra o texto para copiar.
  - **Reativação** (ligado): clientes **sem interação real** há 180 dias, inscritos pela rotina diária, no máximo 50 por dia. Conta como interação: formulário, clique em email, mudança de status, edição manual e a criação do contato. Não contam: envio e abertura de email (o Apple Mail "abre" sozinho), importação, sincronização e entrada/saída de funil. A rotina reinscreve só quem **concluiu** a sequência há mais de 180 dias — nunca quem foi removido à mão.
  - **Prospecção fria** (**desligado por padrão**): só leads com base legal de legítimo interesse. Para ligar, a tela exige marcar o checklist de LGPD (avaliação de legítimo interesse documentada, fonte dos contatos documentada, descadastro em todo email, volume baixo e aquecido) e um teto diário; a data da confirmação fica gravada. Todo email desta série termina com um bloco fixo: a base legal, a fonte do contato (`[fonte do contato]`, a trocar), a oferta de explicar a fonte, apagar o dado ou parar de enviar, e o descadastro.
- **Concluído:** alguns dias depois do último email (soma das esperas + 3 dias, contados de quando o contato **entrou na lista do Brevo**, não da inscrição — sem Brevo conectado, ninguém conclui), a rotina diária marca a inscrição como concluída e tira o contato da lista. Cada funil precisa de uma lista própria do Brevo: a tela recusa uma lista já ligada a outro funil. Na automação do Brevo, permita a reentrada: quem decide quem entra de novo é o CRM. A nutrição com o blog não conclui: a lista dela recebe as campanhas dos artigos novos.
- Contato **descadastrado** nunca entra em funil e sai de todos ao se descadastrar (webhook do Brevo, mudança manual de status, contato encontrado bloqueado no Brevo durante a sincronização ou, por segurança, na rotina diária). Reativar no CRM não desbloqueia no Brevo: desbloqueie lá também.
- **Apagar dados a pedido** (LGPD art. 18, no detalhe do contato): apaga nome, telefone, escritório, cidade, UF, notas, tags e os detalhes da linha do tempo e marca como descadastrado; fica só o email, para que planilha, formulário ou importação não cadastrem a pessoa de novo. Não tem volta: o contato não pode mais ser editado nem reativado. No Brevo o contato fica bloqueado; para apagar o que está guardado lá, apague o contato no Brevo.
- Entrar e sair ficam na linha do tempo do contato (`entrou_funil`, `saiu_funil`). Entrar adiciona à lista do funil (sempre por `adicionarContatosALista`, que recusa descadastrados); sair remove. Sem `BREVO_API_KEY` ou sem lista conectada, a inscrição fica guardada como **pendente** e vai para o Brevo depois — nunca é erro. O contato precisa existir no Brevo antes de entrar na lista: quem ainda não foi sincronizado espera a próxima rodada.
- "Conectar ao Brevo", em cada funil: cria a lista "Painel OG — <funil>" na pasta "Painel OG — Funis" (a API exige pasta) ou usa o número de uma lista existente.
- Rotina diária (`/api/cron/diario`, fonte `funis` em `sincronizacoes`): garante os quatro funis, apaga lotes de planilha com mais de 24 horas, tira descadastrados, inscreve a reativação e a prospecção fria (se ligada, no teto) e, com chave, envia os contatos pendentes e atualiza as listas. Uma falha aqui não afeta o Search Console nem o GA4. Passados 90 s, a etapa para entre subetapas e lotes e registra "Interrompido por tempo" (o restante segue no dia seguinte). O botão "Atualizar listas do Brevo" faz a mesma sincronização na hora.
- Marcadores nos emails: `[link do WhatsApp]` é trocado automaticamente quando `WHATSAPP_LINK` está definido; `[fonte do contato]` (prospecção fria) é trocado à mão. A tela do funil mostra o aviso "Antes de ativar a automação" enquanto sobrar algum, e os destaca nos textos. Confira o link de descadastro `{{ unsubscribe }}` no editor do Brevo e envie um teste antes de ativar.

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
