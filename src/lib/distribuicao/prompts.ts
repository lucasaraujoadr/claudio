import type { TipoPeca } from './schemas'
import { LIMITES } from './schemas'

const TEXTO_MAX = 14_000

export type ContextoPeca = {
  titulo: string
  keyword: string
  /** Texto do artigo já sem marcas "verificar" (veja `htmlParaTexto`). */
  texto: string
  /** Link do blog: o publicado ou o previsto. */
  link: string
}

function limpar(s: string, max = 300): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, max)
}

const BASE = [
  'Você é redator sênior da OG Perícia Contábil (Oliveira Guimarães), escritório de perícia contábil forense que atende advogados de todo o Brasil.',
  'Escreva em português do Brasil, em tom de autoridade técnica, claro e sóbrio, falando com advogados.',
]

const PROIBICOES =
  'Proibido: prometer resultado de processo, citar valores de honorários, inventar número de processo, lei, súmula, decisão, índice ou estatística. Use somente o que estiver no texto do artigo. Sem sensacionalismo, respeitando o código de ética do CFC.'

const CTA =
  'A chamada final convida o advogado a ler o artigo completo e a falar com a OG: perícia contábil 100% remota, para todo o Brasil.'

function instrucao(tipo: TipoPeca, link: string): string {
  const A = LIMITES.artigo
  const P = LIMITES.post
  const C = LIMITES.carrossel
  const N = LIMITES.newsletter
  switch (tipo) {
    case 'linkedin_artigo':
      return [
        `Adapte o artigo para um ARTIGO DO LINKEDIN: título com até ${A.titulo} caracteres, subtítulo (ou null) com até ${A.subtitulo}, e corpo em blocos (paragrafo, h2 ou lista) com de ${A.palavrasMin} a ${A.palavrasMax} palavras.`,
        'Abra com um gancho, use menos linguagem de SEO e parágrafos curtos. Nos blocos "paragrafo" e "h2" preencha "texto" e deixe "itens" null; no bloco "lista" preencha "itens" e deixe "texto" null.',
        `No último parágrafo, faça a chamada para ler o artigo completo no blog, com este link, escrito exatamente assim: ${link}`,
        CTA,
      ].join('\n')
    case 'linkedin_post':
      return [
        `Escreva um POST DO LINKEDIN com até ${P.texto} caracteres: gancho na primeira linha, quebras de linha curtas, uma chamada e o link do blog escrito exatamente assim: ${link}`,
        `Inclua em "hashtags" de ${P.hashtagsMin} a ${P.hashtagsMax} hashtags, sem o caractere "#", e não as repita no texto.`,
        CTA,
      ].join('\n')
    case 'carrossel':
      return [
        `Crie um CARROSSEL com de ${C.laminasMin} a ${C.laminasMax} lâminas: a primeira é "capa", as do meio são "conteudo" e a última é "chamada".`,
        `Capa: "titulo" com até ${C.capaTitulo} caracteres e "subtitulo" com até ${C.capaSubtitulo} (ou null).`,
        `Conteúdo: "titulo" com até ${C.titulo} caracteres e, ou "texto" com até ${C.texto} caracteres, ou "itens" com até ${C.itens} itens de até ${C.item} caracteres (o outro campo fica null). Uma ideia por lâmina.`,
        `Chamada: só "texto", com até ${C.chamada} caracteres; o domínio ogpericiacontabil.com.br já aparece na arte. Campos que não se aplicam ao tipo da lâmina ficam null.`,
        `Em "legenda", escreva a legenda do Instagram com até ${C.legenda} caracteres, com hashtags e o link do blog escrito exatamente assim: ${link}`,
        CTA,
      ].join('\n')
    case 'newsletter':
      return [
        `Escreva uma NEWSLETTER por email: "assunto" com até ${N.assunto} caracteres, "preCabecalho" com até ${N.preCabecalho}, "abertura" curta com até ${N.abertura} e de ${N.pontosMin} a ${N.pontosMax} "pontos" principais de até ${N.ponto} caracteres cada.`,
        'Não inclua o link nem botão no texto: o botão "Ler o artigo completo" é montado à parte. Não use HTML.',
        CTA,
      ].join('\n')
  }
}

export function montarPromptPeca(tipo: TipoPeca, ctx: ContextoPeca): string {
  const texto = ctx.texto.length > TEXTO_MAX ? ctx.texto.slice(0, TEXTO_MAX) : ctx.texto
  return [
    ...BASE,
    `Artigo de origem: ${limpar(ctx.titulo)}\nKeyword principal: ${limpar(ctx.keyword)}\nLink do blog: ${limpar(ctx.link, 300)}`,
    `Texto do artigo:\n${texto}`,
    instrucao(tipo, limpar(ctx.link, 300)),
    PROIBICOES,
  ].join('\n\n')
}
