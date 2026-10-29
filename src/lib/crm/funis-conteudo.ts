import type { BaseLegal } from './campos'
import type { SlugFunil } from './funis-regras'

/**
 * Conteúdo fixo dos funis: definição dos quatro funis, os textos prontos dos emails (pt-BR,
 * tom de perito contábil falando com advogado) e o passo a passo da automação no Brevo.
 *
 * Regras dos textos: nada de promessa de resultado do processo; nenhum número, lei ou
 * decisão inventados; uma chamada clara (mandar os documentos do processo ou marcar uma
 * conversa pelo WhatsApp); linha de descadastro em todo email.
 *
 * Marcadores que o usuário resolve antes de ativar: `[link do WhatsApp]` (trocado na hora de
 * mostrar quando `WHATSAPP_LINK` existe) e `[fonte do contato]` (prospecção fria). O
 * `{{ unsubscribe }}` é o marcador de descadastro do editor do Brevo.
 */

export type DefinicaoFunil = {
  slug: SlugFunil
  nome: string
  descricao: string
  /** Estado na criação; depois o usuário liga e desliga na tela. */
  ativoInicial: boolean
  exigeBaseLegal: BaseLegal | null
  /** Quem entra, em uma frase (mostrada na tela). */
  quemEntra: string
}

export const DEFINICOES_FUNIS: readonly DefinicaoFunil[] = [
  {
    slug: 'boas-vindas',
    nome: 'Boas-vindas',
    descricao: 'Sequência para o advogado que pediu contato pelo formulário do site.',
    ativoInicial: true,
    exigeBaseLegal: null,
    quemEntra: 'Leads que chegam pelo formulário do site (entrada automática pelo webhook).',
  },
  {
    slug: 'nutricao-blog',
    nome: 'Nutrição com o blog',
    descricao: 'Leads e clientes que recebem os artigos novos do blog, em campanhas criadas como rascunho.',
    ativoInicial: true,
    exigeBaseLegal: null,
    quemEntra: 'Leads e clientes com base legal de consentimento ou contrato, escolhidos na tela (por email ou por tag de importação).',
  },
  {
    slug: 'reativacao',
    nome: 'Reativação de clientes',
    descricao: 'Clientes sem interação real (formulário, clique, mudança de status ou edição manual) há 180 dias.',
    ativoInicial: true,
    exigeBaseLegal: null,
    quemEntra: 'Clientes sem interação real há 180 dias (rotina diária, no máximo 50 por dia), ou escolhidos na tela. Envios, aberturas, importações e sincronizações não contam como interação.',
  },
  {
    slug: 'prospeccao-fria',
    nome: 'Prospecção fria',
    descricao: 'Primeiro contato com escritórios que ainda não pediram nada. Desligada por padrão.',
    ativoInicial: false,
    exigeBaseLegal: 'legitimo_interesse',
    quemEntra: 'Somente leads com base legal de legítimo interesse, dentro do teto diário, depois do checklist de LGPD.',
  },
]

export function definicaoFunil(slug: SlugFunil): DefinicaoFunil {
  const d = DEFINICOES_FUNIS.find((f) => f.slug === slug)
  if (!d) throw new Error(`funil desconhecido: ${slug}`)
  return d
}

export type EmailFunil = {
  /** Dias depois do email anterior (o primeiro: depois da entrada na lista). */
  esperarDias: number
  assunto: string
  preCabecalho: string
  corpo: string
}

export const LINHA_DESCADASTRO =
  'Se não quiser mais receber estes emails, descadastre-se por este link: {{ unsubscribe }}'

const ASSINATURA = `Atenciosamente,
Oliveira Guimarães — cálculos e perícias`

/**
 * Bloco fixo de LGPD no fim de todo email de prospecção fria: a base legal, a oferta de
 * explicar a fonte, apagar o dado ou parar de enviar, e o descadastro.
 */
export const BLOCO_LGPD_PROSPECCAO = [
  'Por que você recebeu este email: usamos o seu contato profissional, obtido em [fonte do contato], com base no legítimo interesse previsto na LGPD, para apresentar serviços ligados à advocacia.',
  'Se preferir, responda a este email e explicamos de onde veio o dado, apagamos o seu cadastro ou paramos de enviar.',
  'Para não receber mais nenhum email: {{ unsubscribe }}',
].join('\n')

function email(esperarDias: number, assunto: string, preCabecalho: string, paragrafos: string[], rodape = LINHA_DESCADASTRO): EmailFunil {
  return {
    esperarDias,
    assunto,
    preCabecalho,
    corpo: [...paragrafos, ASSINATURA, rodape].join('\n\n'),
  }
}
const frio = (esperarDias: number, assunto: string, preCabecalho: string, paragrafos: string[]) =>
  email(esperarDias, assunto, preCabecalho, paragrafos, BLOCO_LGPD_PROSPECCAO)

export const EMAILS_FUNIS: Record<SlugFunil, readonly EmailFunil[]> = {
  'boas-vindas': [
    email(0, 'Recebemos seu contato', 'Como funciona a análise do seu caso e o que enviar primeiro.', [
      'Prezado(a) Dr(a).,',
      'Recebemos a sua mensagem pelo site. Obrigado por nos procurar.',
      'Para avaliarmos o caso com segurança, o primeiro passo é ver os documentos. Em geral, ajudam: a petição inicial, a sentença ou o acórdão que fixou os critérios, as decisões sobre a liquidação e os documentos financeiros do caso (contracheques, extratos, contratos ou planilhas já juntadas).',
      'Com esse material, dizemos com clareza o que é possível calcular, o que falta e qual o prazo do trabalho, antes de qualquer compromisso.',
      'Para enviar os documentos, basta responder a este email. Se preferir conversar antes, fale conosco pelo WhatsApp: [link do WhatsApp].',
    ]),
    email(3, 'O que o cálculo pode (e não pode) fazer pelo seu processo', 'Um cálculo ou parecer técnico útil é aquele que o juízo consegue conferir.', [
      'Prezado(a) Dr(a).,',
      'Um cálculo judicial bem feito não muda o direito discutido no processo: ele mostra, de forma verificável, quanto aquele direito representa segundo os critérios da decisão.',
      'Por isso o nosso trabalho segue três cuidados: cada valor tem a sua origem indicada nos autos; cada critério (índice, juros, período) é o fixado na decisão ou está explicitado quando há divergência; e a memória de cálculo permite que o juízo e a parte contrária conferam linha a linha.',
      'Não prometemos resultado do processo. O que entregamos é um trabalho técnico feito para ser conferido e debatido tecnicamente.',
      'Se houver um caso em andamento, responda a este email com os documentos ou chame no WhatsApp: [link do WhatsApp].',
    ]),
    email(7, 'Ainda podemos ajudar no seu caso?', 'Se o momento não é agora, fica o canal aberto.', [
      'Prezado(a) Dr(a).,',
      'Escrevemos há alguns dias, depois do seu contato pelo site. Se o caso ainda estiver em aberto, podemos fazer a análise inicial a partir dos documentos que o(a) senhor(a) já tem.',
      'Atendemos advogados em todo o Brasil, com cálculos judiciais, pareceres técnicos e assistência técnica em perícias contábeis. Todo o trabalho pode ser feito a distância.',
      'Para seguir, responda a este email com os documentos do processo ou marque uma conversa pelo WhatsApp: [link do WhatsApp]. Se o momento não for agora, não há nada a fazer: este é o último email desta sequência.',
    ]),
  ],
  'nutricao-blog': [
    email(0, 'Você vai receber os nossos artigos técnicos', 'Conteúdo de perícia contábil para quem advoga.', [
      'Prezado(a) Dr(a).,',
      'A partir de agora, enviaremos os artigos que publicamos no blog sobre cálculos judiciais e perícia contábil. São textos curtos, escritos para quem advoga, com foco no que costuma gerar dúvida na hora de conferir ou impugnar um cálculo.',
      'Nos próximos dias enviaremos dois textos curtos de apresentação; depois disso, só escrevemos quando houver artigo novo.',
      'Se tiver um tema que gostaria de ver tratado, ou um caso em que um cálculo precisa de revisão, responda a este email. Também atendemos pelo WhatsApp: [link do WhatsApp].',
    ]),
    email(5, 'Como conferir um cálculo da parte contrária', 'Um roteiro de conferência antes de concordar ou impugnar.', [
      'Prezado(a) Dr(a).,',
      'Ao receber um cálculo da parte contrária ou do perito do juízo, algumas perguntas ajudam a decidir se vale impugnar:',
      '1. Os critérios usados (índice de correção, juros, período, base de cálculo) são os da decisão que está sendo liquidada?\n2. Cada valor de partida tem origem nos autos, com a folha ou o documento indicado?\n3. A memória de cálculo permite refazer as contas, ou só apresenta totais?\n4. Há parcelas que a decisão não concedeu, ou parcelas concedidas que ficaram de fora?',
      'Se alguma resposta for "não" ou "não sei", vale uma revisão técnica antes do prazo. Envie o cálculo e a decisão respondendo a este email, ou fale conosco pelo WhatsApp: [link do WhatsApp].',
    ]),
    email(10, 'Quando vale ter um assistente técnico', 'O papel do assistente técnico na perícia contábil.', [
      'Prezado(a) Dr(a).,',
      'Na perícia contábil, o assistente técnico acompanha o trabalho do perito do juízo em nome da parte: formula quesitos, acompanha diligências, analisa o laudo e apresenta parecer quando há divergência.',
      'Ele é mais útil quando entra cedo, na fase de quesitos, porque é ali que se define o que o perito vai responder.',
      'Se houver uma perícia contábil designada ou prestes a ser, podemos analisar o caso e dizer em que ponto a assistência técnica pode contribuir. Responda a este email com os documentos ou chame no WhatsApp: [link do WhatsApp].',
    ]),
  ],
  reativacao: [
    email(0, 'Faz tempo que não conversamos', 'Seguimos à disposição para os seus próximos casos.', [
      'Prezado(a) Dr(a).,',
      'Já trabalhamos juntos e faz algum tempo desde o nosso último contato. Escrevemos só para lembrar que seguimos à disposição para os seus próximos casos: cálculos judiciais, liquidação de sentença, pareceres técnicos e assistência técnica em perícias contábeis.',
      'Se houver algum processo em que um cálculo precise ser feito ou revisado, responda a este email com os documentos ou fale conosco pelo WhatsApp: [link do WhatsApp].',
    ]),
    email(7, 'Algum processo na fase de liquidação?', 'A fase de liquidação costuma ter prazos curtos.', [
      'Prezado(a) Dr(a).,',
      'Muitos casos passam meses parados e, de repente, voltam com prazo curto para apresentar ou impugnar cálculos. Se algum dos seus processos estiver chegando a essa fase, podemos adiantar a análise dos documentos para que o prazo não aperte.',
      'Para começar, basta responder a este email com a decisão e os documentos do caso, ou marcar uma conversa pelo WhatsApp: [link do WhatsApp].',
    ]),
    email(14, 'Último lembrete desta sequência', 'Sem novos emails desta série depois deste.', [
      'Prezado(a) Dr(a).,',
      'Este é o último email desta sequência. Se não houver nada no momento, não é preciso responder.',
      'Quando surgir um caso que envolva cálculo ou perícia contábil, é só responder a qualquer um destes emails ou chamar no WhatsApp: [link do WhatsApp].',
    ]),
  ],
  'prospeccao-fria': [
    frio(0, 'Cálculos e perícia contábil para escritórios de advocacia', 'Apresentação breve, sem compromisso.', [
      'Prezado(a) Dr(a).,',
      'Somos a Oliveira Guimarães, um escritório de cálculos e perícias que atende advogados em todo o Brasil. Cálculos judiciais e perícia contábil aparecem em muitas áreas da advocacia, e por isso escrevemos para nos apresentar.',
      'Fazemos cálculos de liquidação, revisão de cálculos da parte contrária, pareceres técnicos e assistência técnica em perícias contábeis, com memória de cálculo que o juízo consegue conferir. Não prometemos resultado de processo; entregamos trabalho técnico verificável.',
      'Se fizer sentido, responda a este email com os documentos de um caso para uma análise inicial, ou fale conosco pelo WhatsApp: [link do WhatsApp].',
    ]),
    frio(5, 'Um roteiro para conferir cálculos judiciais', 'Quatro perguntas antes de concordar ou impugnar.', [
      'Prezado(a) Dr(a).,',
      'Deixamos um roteiro curto que usamos ao conferir um cálculo: os critérios são os da decisão? Cada valor de partida tem origem nos autos? A memória permite refazer as contas? Alguma parcela concedida ficou de fora, ou entrou parcela não concedida?',
      'Se algum caso levantar essas dúvidas, podemos olhar os documentos. Responda a este email ou chame no WhatsApp: [link do WhatsApp].',
    ]),
    frio(10, 'Encerrando o contato', 'Não enviaremos outros emails desta série.', [
      'Prezado(a) Dr(a).,',
      'Este é o último email desta apresentação. Se em algum momento precisar de cálculos judiciais ou de assistência técnica em perícia contábil, basta responder a este email ou chamar no WhatsApp: [link do WhatsApp].',
    ]),
  ],
}

/** Folga, em dias, depois do último email antes de marcar a sequência como concluída. */
export const FOLGA_CONCLUSAO_DIAS = 3

/**
 * Dias até a inscrição ser marcada `concluido` (soma das esperas + folga). `null` = não
 * conclui (a nutrição com o blog continua recebendo as campanhas dos artigos novos).
 */
export function duracaoSequenciaDias(slug: SlugFunil): number | null {
  if (slug === 'nutricao-blog') return null
  return EMAILS_FUNIS[slug].reduce((s, e) => s + e.esperarDias, 0) + FOLGA_CONCLUSAO_DIAS
}

export const MARCADOR_WHATSAPP = '[link do WhatsApp]'
const MARCADOR = /\[(link do WhatsApp|fonte do contato)\]/g

/** Troca os marcadores resolvidos pelo ambiente (hoje: `WHATSAPP_LINK`). */
export function aplicarMarcadores(texto: string, valores: { whatsapp?: string | null }): string {
  const w = valores.whatsapp?.trim()
  return w ? texto.split(MARCADOR_WHATSAPP).join(w) : texto
}

/** Marcadores ainda não resolvidos num conjunto de textos, sem repetição, na ordem em que aparecem. */
export function marcadoresPendentes(textos: readonly string[]): string[] {
  const achados = new Set<string>()
  for (const t of textos) for (const m of t.matchAll(MARCADOR)) achados.add(m[0])
  return [...achados]
}

/** Link do WhatsApp configurado (`WHATSAPP_LINK`), só se for http(s). */
export function linkWhatsapp(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.WHATSAPP_LINK?.trim()
  if (!v) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

/** Nome da lista no Brevo para um funil (criada por "Conectar ao Brevo"). */
export function nomeListaBrevo(nomeFunil: string): string {
  return `Painel OG — ${nomeFunil}`
}

/** Pasta do Brevo onde o painel cria as listas (a API exige uma pasta). */
export const PASTA_BREVO = 'Painel OG — Funis'

/** Passo a passo para criar a automação no Brevo (automações não são criáveis por API). */
export function passosAutomacao(slug: SlugFunil, nomeLista: string): string[] {
  const emails = EMAILS_FUNIS[slug]
  const passos = [
    'No Brevo, abra Automações → Criar automação → Fluxo personalizado.',
    `Ponto de entrada: "Contato adicionado a uma lista" → escolha a lista "${nomeLista}".`,
  ]
  emails.forEach((e, i) => {
    if (i > 0) passos.push(`Adicione um atraso: "Aguardar ${e.esperarDias} dia${e.esperarDias === 1 ? '' : 's'}".`)
    passos.push(`Enviar email ${i + 1}: assunto "${e.assunto}", pré-cabeçalho e corpo copiados do email ${i + 1} abaixo.`)
  })
  passos.push(
    'Em cada email, confira que não sobrou marcador entre colchetes (como [link do WhatsApp]) e que o link de descadastro {{ unsubscribe }} funciona no editor do Brevo; envie um email de teste para você antes de ativar.',
    slug === 'reativacao'
      ? 'Nas configurações da automação, permita que o contato entre de novo: o CRM só reinscreve um cliente que concluiu a sequência há mais de 180 dias e continua sem interação (nunca quem foi removido à mão).'
      : 'Nas configurações da automação, não permita que o contato entre de novo: o CRM já decide quem reentra.',
    'Para que quem sai do funil não receba os emails seguintes, ponha antes de cada envio a condição "o contato está na lista" (o CRM remove da lista quem sai e, alguns dias depois do último email, quem concluiu a sequência).',
    'Ative a automação.',
  )
  return passos
}

// ---------------------------------------------------------------------------
// Rascunho de campanha da nutrição com o blog
// ---------------------------------------------------------------------------

export type DadosTemaCampanha = {
  topicId: number
  titulo: string
  keyword: string
  urlPublicada: string
  briefing: { title: string; metaDescription: string } | null
}

export type CampanhaComposta = {
  nome: string
  assunto: string
  preCabecalho: string
  link: string
  texto: string
  html: string
}

function escaparHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Link do artigo com UTM da campanha (mantém os parâmetros que já existirem). */
export function linkComUtm(url: string, topicId: number): string {
  const u = new URL(url)
  u.searchParams.set('utm_source', 'brevo')
  u.searchParams.set('utm_medium', 'email')
  u.searchParams.set('utm_campaign', `nutricao-blog-tema-${topicId}`)
  return u.toString()
}

/**
 * Monta o rascunho da campanha a partir do tema publicado e do briefing (título e meta
 * description). Não usa dado de contato nem IA. Sem briefing, usa o título do tema e uma
 * frase neutra.
 */
export function comporCampanhaBlog(t: DadosTemaCampanha): CampanhaComposta {
  const titulo = (t.briefing?.title || t.titulo).trim()
  const resumo = (t.briefing?.metaDescription || `Publicamos um artigo novo sobre ${t.keyword.trim()}.`).trim()
  const link = linkComUtm(t.urlPublicada, t.topicId)
  const assunto = `Novo artigo: ${titulo}`
  const texto = [
    'Prezado(a) Dr(a).,',
    'Publicamos um artigo novo no blog:',
    titulo,
    resumo,
    `Leia o artigo completo: ${link}`,
    'Se tiver um caso em que este tema aparece, responda a este email com os documentos do processo.',
    ASSINATURA,
    LINHA_DESCADASTRO,
  ].join('\n\n')
  const p = (s: string) => `<p style="margin:0 0 16px">${s}</p>`
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1f2933;max-width:600px">',
    p('Prezado(a) Dr(a).,'),
    p('Publicamos um artigo novo no blog:'),
    `<h2 style="font-size:20px;margin:0 0 12px">${escaparHtml(titulo)}</h2>`,
    p(escaparHtml(resumo)),
    p(`<a href="${escaparHtml(link)}">Leia o artigo completo</a>`),
    p('Se tiver um caso em que este tema aparece, responda a este email com os documentos do processo.'),
    p('Atenciosamente,<br>Oliveira Guimarães — cálculos e perícias'),
    `<p style="margin:24px 0 0;font-size:12px;color:#616e7c">Se não quiser mais receber estes emails, <a href="{{ unsubscribe }}">descadastre-se aqui</a>.</p>`,
    '</div>',
  ].join('\n')
  return { nome: `Blog — ${titulo}`.slice(0, 200), assunto, preCabecalho: resumo.slice(0, 150), link, texto, html }
}
