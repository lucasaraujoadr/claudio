import type { Topic } from '@/lib/db/schema'
import { normalizarKeyword } from '@/lib/keyword'
import { gerarObjetoPadrao, type GerarObjeto } from './cliente'
import {
  META_MAX,
  META_MIN,
  TITLE_MAX,
  TITLE_MIN,
  briefingSchema,
  briefingSchemaModelo,
  type BriefingGerado,
  type BriefingModelo,
} from './schemas'

export const MAX_URLS_NO_PROMPT = 80

export type ContextoBriefing = { topico: Topic; urlsDoSite: string[] }

function limpar(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 200)
}

function semBarraFinal(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

// Sanitiza (como no prompt de temas), remove vazias/duplicadas e limita a MAX_URLS_NO_PROMPT.
function urlsPermitidas(urls: string[]): string[] {
  const vistas = new Set<string>()
  const saida: string[] = []
  for (const u of urls) {
    const limpa = limpar(u)
    const chave = semBarraFinal(limpa)
    if (!chave || vistas.has(chave)) continue
    vistas.add(chave)
    saida.push(limpa)
    if (saida.length >= MAX_URLS_NO_PROMPT) break
  }
  return saida
}

export function montarPromptBriefing(ctx: ContextoBriefing): string {
  const { topico } = ctx
  const urls = urlsPermitidas(ctx.urlsDoSite)
  const links =
    urls.length > 0
      ? `URLs do site que podem ser usadas como links internos (use SOMENTE estas; não invente nem altere URLs):\n${urls.map((u) => `- ${u}`).join('\n')}`
      : 'Não há URLs do site disponíveis: devolva a lista de links internos vazia.'

  return [
    'Você é estrategista de conteúdo SEO de um escritório de perícia contábil forense (ogpericiacontabil.com.br).',
    'Público: advogados em todo o Brasil (B2B), com atendimento 100% remoto.',
    `Tema: ${limpar(topico.titulo)}\nKeyword principal: ${limpar(topico.keyword)}\nIntenção de busca: ${topico.intencao}`,
    'Elabore o briefing de um artigo para um redator. O conteúdo deve ajudar um advogado a decidir se deve contratar um perito contábil forense.',
    `Title: de ${TITLE_MIN} a ${TITLE_MAX} caracteres, com a keyword principal. Mire em cerca de ${TITLE_MAX - 10} caracteres (uns ${Math.round((TITLE_MAX - 10) / 6)} palavras): o title é uma versão enxuta do tema, nunca o tema inteiro, e jamais passa de ${TITLE_MAX}. Meta description: de ${META_MIN} a ${META_MAX} caracteres.`,
    'Outline: seções H2, cada uma com subtópicos H3 quando fizer sentido.',
    'FAQ: de 4 a 6 perguntas reais que um advogado faria, com respostas objetivas.',
    'Keywords secundárias: termos relacionados à keyword principal.',
    links,
    'Cada link interno tem um texto âncora e a URL.',
    'Não invente estatísticas, leis, artigos, súmulas nem números de processos. Quando uma referência legal ajudaria o texto, instrua o redator a escrever "verificar a referência legal" em vez de citar uma.',
    'Responda em português do Brasil.',
  ].join('\n\n')
}

function descreverFalhas(bruto: BriefingModelo, erros: { path: PropertyKey[]; message: string }[]): string {
  const linhas: string[] = []
  const t = bruto.title.trim().length
  const m = bruto.metaDescription.trim().length
  if (t < TITLE_MIN || t > TITLE_MAX) {
    linhas.push(`- O title anterior tinha ${t} caracteres; ele deve ter entre ${TITLE_MIN} e ${TITLE_MAX}.`)
  }
  if (m < META_MIN || m > META_MAX) {
    linhas.push(`- A meta description anterior tinha ${m} caracteres; ela deve ter entre ${META_MIN} e ${META_MAX}.`)
  }
  const n = bruto.faq.length
  if (n < 4 || n > 6) linhas.push(`- O FAQ anterior tinha ${n} perguntas; ele deve ter entre 4 e 6.`)
  const outros = erros.filter((e) => !['title', 'metaDescription', 'faq'].includes(String(e.path[0])))
  for (const e of outros) linhas.push(`- Campo "${e.path.join('.') || 'resposta'}" inválido: ${e.message}.`)
  return linhas.join('\n')
}

const PALAVRAS_PENDENTES = new Set(
  [
    'de', 'da', 'do', 'das', 'dos', 'em', 'na', 'no', 'nos', 'nas', 'para', 'por', 'e', 'o', 'a', 'os', 'as', 'com', 'ou', 'que',
    'um', 'uma', 'sobre', 'entre', 'até', 'sem', 'sob', 'ao', 'aos', 'à', 'às', 'pelo', 'pela', 'pelos', 'pelas', 'num', 'numa',
    'como', 'quando', 'se', 'seu', 'sua', 'dum', 'duma',
  ].map(normalizarKeyword),
)

// Tira pontuação e palavras de ligação soltas no fim ("... em", "...:", "... (").
function semPendentes(texto: string): string {
  let t = texto.trim()
  for (;;) {
    const antes = t
    t = t.replace(/[\s,:;\-–—/&(]+$/u, '')
    const m = t.match(/(?:^|\s)([^\s]+)$/u)
    if (m && PALAVRAS_PENDENTES.has(normalizarKeyword(m[1])) && t.length > m[1].length) t = t.slice(0, t.length - m[1].length).trimEnd()
    if (t === antes) return t
  }
}

function cortarNaPalavra(texto: string, max: number): string {
  const t = texto.trim()
  if (t.length <= max) return t
  const cabeca = t.slice(0, max + 1)
  const i = cabeca.lastIndexOf(' ')
  return semPendentes(i > 0 ? cabeca.slice(0, i) : cabeca.slice(0, max))
}

/** Encurta o title no limite de palavra; null se ficar curto demais ou perder a keyword. */
export function repararTitle(title: string, keyword: string): string | null {
  const t = cortarNaPalavra(title, TITLE_MAX)
  if (t.length < TITLE_MIN || t.length > TITLE_MAX) return null
  return normalizarKeyword(t).includes(normalizarKeyword(keyword)) ? t : null
}

/** Encurta a meta (de preferência numa frase inteira); null se ficar curta ou perder a keyword que tinha. */
export function repararMeta(meta: string, keyword: string): string | null {
  const m = meta.trim()
  let t = cortarNaPalavra(m, META_MAX)
  if (m.length > META_MAX) {
    const fim = Math.max(t.lastIndexOf('. '), t.endsWith('.') ? t.length - 1 : -1)
    if (fim + 1 >= META_MIN) t = t.slice(0, fim + 1)
  }
  if (t.length < META_MIN || t.length > META_MAX) return null
  const k = normalizarKeyword(keyword)
  return normalizarKeyword(m).includes(k) && !normalizarKeyword(t).includes(k) ? null : t
}

export type AjusteBriefing = 'title' | 'metaDescription'
export type BriefingComAjustes = BriefingGerado & { ajustes: AjusteBriefing[] }

export async function gerarBriefing(
  ctx: ContextoBriefing,
  gerar: GerarObjeto = gerarObjetoPadrao,
  opcoes: { tolerante?: boolean } = {},
): Promise<BriefingComAjustes> {
  const urls = urlsPermitidas(ctx.urlsDoSite)
  const permitidas = new Map(urls.map((u) => [semBarraFinal(u), u]))
  const prompt = montarPromptBriefing({ ...ctx, urlsDoSite: urls })

  const tentar = async (p: string) => {
    const bruto = await gerar({ schema: briefingSchemaModelo, prompt: p })
    // Link interno só vale se estiver no site (seção 6.5); usa a forma canônica da lista.
    const vistos = new Set<string>()
    const linksInternos = bruto.linksInternos.flatMap((l) => {
      const canonica = permitidas.get(semBarraFinal(l.url))
      if (!canonica || vistos.has(canonica)) return []
      vistos.add(canonica)
      return [{ ancora: l.ancora, url: canonica }]
    })
    const filtrado = { ...bruto, linksInternos }
    return { bruto, filtrado, resultado: briefingSchema.safeParse(filtrado) }
  }

  const primeira = await tentar(prompt)
  if (primeira.resultado.success) return { ...primeira.resultado.data, ajustes: [] }

  const addendum = [
    'ATENÇÃO: a resposta anterior não atendeu aos limites exigidos. Corrija e responda de novo:',
    descreverFalhas(primeira.bruto, primeira.resultado.error.issues),
  ].join('\n')
  const segunda = await tentar(`${prompt}\n\n${addendum}`)
  if (segunda.resultado.success) return { ...segunda.resultado.data, ajustes: [] }

  // Modelos não contam caracteres: em vez de falhar, encurta title/meta sem nova chamada ao modelo.
  const ajustes: AjusteBriefing[] = []
  const reparado = { ...segunda.filtrado }
  if (!briefingSchema.shape.title.safeParse(reparado.title).success) {
    let t = repararTitle(reparado.title, ctx.topico.keyword)
    // Tolerante: keyword longa pode não caber inteira; aceita o corte na palavra.
    if (!t && opcoes.tolerante) {
      const c = cortarNaPalavra(reparado.title, TITLE_MAX)
      if (c.length >= TITLE_MIN && c.length <= TITLE_MAX) t = c
    }
    if (t) {
      reparado.title = t
      ajustes.push('title')
    }
  }
  if (!briefingSchema.shape.metaDescription.safeParse(reparado.metaDescription).success) {
    let m = repararMeta(reparado.metaDescription, ctx.topico.keyword)
    if (!m && opcoes.tolerante) {
      const c = cortarNaPalavra(reparado.metaDescription, META_MAX)
      if (c.length >= META_MIN && c.length <= META_MAX) m = c
    }
    if (m) {
      reparado.metaDescription = m
      ajustes.push('metaDescription')
    }
  }
  const final = ajustes.length > 0 ? briefingSchema.safeParse(reparado) : null
  if (final?.success) return { ...final.data, ajustes }
  throw new Error(
    `O briefing gerado não atendeu aos limites após uma nova tentativa: ${descreverFalhas(segunda.bruto, segunda.resultado.error.issues)}`,
  )
}

export function briefingParaMarkdown(b: BriefingGerado): string {
  const partes: string[] = [`# ${b.title}`, `**Meta description:** ${b.metaDescription}`]
  for (const s of b.outline) {
    partes.push(`## ${s.h2}`)
    if (s.h3.length > 0) partes.push(s.h3.map((h) => `### ${h}`).join('\n\n'))
  }
  partes.push('---', '## Notas para o redator', '### Perguntas frequentes (FAQ)')
  for (const f of b.faq) partes.push(`**${f.pergunta}**\n\n${f.resposta}`)
  partes.push('### Links internos')
  partes.push(
    b.linksInternos.length > 0
      ? b.linksInternos.map((l) => `- [${l.ancora.replace(/[\\\[\]]/g, '\\$&')}](${l.url})`).join('\n')
      : '_Nenhum link interno sugerido._',
  )
  partes.push('### Keywords secundárias')
  partes.push(
    b.keywordsSecundarias.length > 0 ? b.keywordsSecundarias.map((k) => `- ${k}`).join('\n') : '_Nenhuma._',
  )
  return partes.join('\n\n') + '\n'
}
