import { normalizarUrl, type SinaisPagina } from './parse'

export type Problema = {
  url: string | null // null = problema do site inteiro
  severidade: 'critico' | 'aviso' | 'info'
  regra: string
  mensagem: string
}

export type ContextoAuditoria = {
  urlInicial: string
  sitemapResolvido: boolean
  urlsSitemap: string[]
  urlsMenu: string[]
  statusPorUrl: Record<string, number>
}

type RegraPorPagina = (p: SinaisPagina, ctx: ContextoAuditoria) => Problema[]

function problema(
  url: string | null,
  severidade: Problema['severidade'],
  regra: string,
  mensagem: string,
): Problema[] {
  return [{ url, severidade, regra, mensagem }]
}

function aparado(valor: string | null): string {
  return valor?.trim() ?? ''
}

// --- Regras por página -----------------------------------------------------

const titleAusente: RegraPorPagina = (p) =>
  aparado(p.title) === ''
    ? problema(p.url, 'critico', 'title-ausente', 'A página não tem <title>')
    : []

const titleTamanho: RegraPorPagina = (p) => {
  const n = aparado(p.title).length
  if (n === 0 || (n >= 30 && n <= 60)) return []
  return problema(p.url, 'aviso', 'title-tamanho', `title com ${n} caracteres; o ideal é entre 30 e 60`)
}

const metaAusente: RegraPorPagina = (p) =>
  aparado(p.metaDescription) === ''
    ? problema(p.url, 'aviso', 'meta-ausente', 'A página não tem meta description')
    : []

const metaTamanho: RegraPorPagina = (p) => {
  const n = aparado(p.metaDescription).length
  if (n === 0 || (n >= 70 && n <= 160)) return []
  return problema(
    p.url,
    'aviso',
    'meta-tamanho',
    `meta description com ${n} caracteres; o ideal é entre 70 e 160`,
  )
}

const h1Ausente: RegraPorPagina = (p) =>
  p.h1Textos.length === 0 ? problema(p.url, 'critico', 'h1-ausente', 'A página não tem <h1>') : []

const h1Multiplo: RegraPorPagina = (p) =>
  p.h1Textos.length > 1
    ? problema(
        p.url,
        'aviso',
        'h1-multiplo',
        `${p.h1Textos.length} elementos H1 encontrados; deveria haver 1`,
      )
    : []

const conteudoRaso: RegraPorPagina = (p) =>
  p.palavras < 300
    ? problema(p.url, 'aviso', 'conteudo-raso', `Conteúdo com ${p.palavras} palavras; o mínimo recomendado é 300`)
    : []

const poucosLinksInternos: RegraPorPagina = (p) =>
  p.linksInternos.length < 2
    ? problema(
        p.url,
        'aviso',
        'poucos-links-internos',
        `A página tem ${p.linksInternos.length} link(s) interno(s); o mínimo recomendado é 2`,
      )
    : []

const canonicalDivergente: RegraPorPagina = (p) => {
  if (p.canonical === null || p.canonical.trim() === '') return []
  const alvo = normalizarUrl(p.canonical, p.url) ?? p.canonical
  const propria = normalizarUrl(p.url, p.url) ?? p.url
  return alvo === propria
    ? []
    : problema(p.url, 'aviso', 'canonical-divergente', `canonical aponta para ${p.canonical}, não para a própria página`)
}

const noindexInesperado: RegraPorPagina = (p, ctx) => {
  const esperada = ctx.urlsSitemap.includes(p.url) || ctx.urlsMenu.includes(p.url)
  return p.noindex && p.statusCode === 200 && esperada
    ? problema(p.url, 'critico', 'noindex-inesperado', 'A página tem noindex, mas está no sitemap ou no menu')
    : []
}

const PAGINAS_INSTITUCIONAIS = new Set([
  'sobre-nos',
  'para-advogados',
  'blog',
  'politica-de-privacidade',
])

// Devolve os tipos exigidos (todos) ou "um de" (algum), ou null se a URL não casa.
function schemaEsperado(url: string): { todos: string[] } | { algum: string[] } | null {
  let segmentos: string[]
  try {
    segmentos = new URL(url).pathname.split('/').filter(Boolean)
  } catch {
    return null
  }
  if (segmentos.length === 0) return { todos: ['Organization', 'WebSite'] }
  if (segmentos[0] === 'servicos') return { todos: ['Service'] }
  if (segmentos.length > 1) return null
  if (segmentos[0] === 'contato') return { todos: ['ContactPage'] }
  if (PAGINAS_INSTITUCIONAIS.has(segmentos[0])) return { todos: ['WebPage'] }
  return { algum: ['Article', 'BlogPosting'] }
}

const schemaAusente: RegraPorPagina = (p) => {
  const esperado = schemaEsperado(p.url)
  if (esperado === null) return []
  if ('todos' in esperado) {
    const faltam = esperado.todos.filter((t) => !p.schemaTypes.includes(t))
    return faltam.length === 0
      ? []
      : problema(p.url, 'aviso', 'schema-ausente', `JSON-LD ausente: faltam ${faltam.join(' e ')}`)
  }
  return esperado.algum.some((t) => p.schemaTypes.includes(t))
    ? []
    : problema(p.url, 'aviso', 'schema-ausente', `JSON-LD ausente: esperado ${esperado.algum.join(' ou ')}`)
}

const linkQuebrado: RegraPorPagina = (p, ctx) =>
  p.linksInternos.flatMap((link) => {
    const status = ctx.statusPorUrl[link]
    return status !== undefined && status >= 400
      ? problema(p.url, 'critico', 'link-quebrado', `Link interno quebrado: ${link} responde ${status}`)
      : []
  })

const imagemSemAlt: RegraPorPagina = (p) =>
  p.imagensSemAlt > 0
    ? problema(p.url, 'aviso', 'imagem-sem-alt', `${p.imagensSemAlt} imagem(ns) sem atributo alt`)
    : []

const REGRAS_POR_PAGINA: RegraPorPagina[] = [
  titleAusente,
  titleTamanho,
  metaAusente,
  metaTamanho,
  h1Ausente,
  h1Multiplo,
  conteudoRaso,
  poucosLinksInternos,
  canonicalDivergente,
  noindexInesperado,
  schemaAusente,
  linkQuebrado,
  imagemSemAlt,
]

// --- Regras que precisam da coleção inteira --------------------------------

function paginaOrfa(paginas: SinaisPagina[], ctx: ContextoAuditoria): Problema[] {
  const entrantes = new Set<string>()
  for (const p of paginas) {
    for (const link of p.linksInternos) if (link !== p.url) entrantes.add(link)
  }
  return paginas
    .filter((p) => p.url !== ctx.urlInicial && !entrantes.has(p.url))
    .flatMap((p) => problema(p.url, 'critico', 'pagina-orfa', 'Nenhuma outra página rastreada aponta para esta URL'))
}

function duplicados(
  paginas: SinaisPagina[],
  campo: (p: SinaisPagina) => string | null,
  severidade: Problema['severidade'],
  regra: string,
  rotulo: string,
): Problema[] {
  const grupos = new Map<string, SinaisPagina[]>()
  for (const p of paginas) {
    const valor = aparado(campo(p))
    if (valor === '') continue
    grupos.set(valor, [...(grupos.get(valor) ?? []), p])
  }
  return [...grupos.values()]
    .filter((g) => g.length > 1)
    .flatMap((g) =>
      g.flatMap((p) => {
        const outras = g.filter((o) => o !== p).map((o) => o.url)
        return problema(p.url, severidade, regra, `${rotulo} idêntico ao de: ${outras.join(', ')}`)
      }),
    )
}

function sitemapInvalido(ctx: ContextoAuditoria): Problema[] {
  return ctx.sitemapResolvido
    ? []
    : problema(null, 'critico', 'sitemap-invalido', 'O sitemap não pôde ser lido ou é inválido')
}

export function avaliar(paginas: SinaisPagina[], ctx: ContextoAuditoria): Problema[] {
  return [
    ...paginas.flatMap((p) => REGRAS_POR_PAGINA.flatMap((regra) => regra(p, ctx))),
    ...duplicados(paginas, (p) => p.title, 'critico', 'title-duplicado', 'title'),
    ...duplicados(paginas, (p) => p.metaDescription, 'aviso', 'meta-duplicada', 'meta description'),
    ...paginaOrfa(paginas, ctx),
    ...sitemapInvalido(ctx),
  ]
}
