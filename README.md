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

## Brevo e webhooks (CRM)

- O CRM é a fonte da verdade; o Brevo só envia os emails. A tela **CRM → Integração** mostra o estado da conexão, quantos contatos estão pendentes/sincronizados/com erro, o botão **Sincronizar agora** e as duas URLs de webhook (com o token, mascarado, com botões de mostrar e copiar), com o passo a passo para o Brevo e para o Elementor.
- Atributos que precisam existir no Brevo (Contatos → Configurações → Atributos de contato, tipo Texto): `NOME`, `TELEFONE`, `ESCRITORIO`, `CIDADE`, `UF`. Campo vazio no CRM não é enviado.
- Contato **descadastrado** nunca é adicionado a lista do Brevo: na sincronização vai bloqueado (`emailBlacklisted`) e é tirado de toda lista.
- `POST /api/webhooks/brevo?token=…`: descadastro, hard bounce e spam viram "Descadastrado" e tiram o contato dos funis; abertura, clique e entrega só entram na linha do tempo. O mesmo evento repetido não grava nada (tabela `brevo_eventos_recebidos`). Email que não está no CRM e evento desconhecido são aceitos e ignorados.
- `POST /api/webhooks/site?token=…`: ação "Webhook" do Elementor Forms, com ou sem "Dados avançados" (form-urlencoded) ou JSON. Cria/atualiza o lead com origem "Site" e base legal "Consentimento"; a mensagem fica na linha do tempo. Até 20 envios por minuto por IP; corpo de até 64 KB.
- **Atenção:** a produção está atrás da proteção de login da Vercel (Deployment Protection), então o Brevo e o Elementor ainda **não conseguem** chamar `/api/webhooks/*`. Para ligar, restrinja a proteção às prévias (Preview) ou crie um "Protection Bypass for Automation" e acrescente `&x-vercel-protection-bypass=…` às URLs.

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
