import * as cheerio from 'cheerio'

export type SinaisPagina = {
  url: string
  statusCode: number
  title: string | null
  metaDescription: string | null
  h1Textos: string[]
  palavras: number
  canonical: string | null
  noindex: boolean
  linksInternos: string[]
  imagensSemAlt: number
  schemaTypes: string[]
}

/**
 * Normaliza um link para deduplicação do crawl. Devolve null para outra
 * origem, esquema não-HTTP(S) ou entrada que `new URL` não consegue ler.
 */
export function normalizarUrl(bruta: string, base: string): string | null {
  try {
    const baseUrl = new URL(base)
    const url = new URL(bruta, baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.origin !== baseUrl.origin) return null
    url.hash = ''
    // URL já coloca o host em minúsculas; o caminho permanece intocado.
    const ultimoSegmento = url.pathname.split('/').pop() ?? ''
    if (!url.pathname.endsWith('/') && !ultimoSegmento.includes('.')) {
      url.pathname += '/'
    }
    return url.href
  } catch {
    return null
  }
}

function textoOuNull(valor: string | undefined): string | null {
  const limpo = valor?.trim()
  return limpo ? limpo : null
}

function coletarTipos(no: unknown, destino: Set<string>): void {
  if (Array.isArray(no)) {
    for (const item of no) coletarTipos(item, destino)
    return
  }
  if (typeof no !== 'object' || no === null) return
  const obj = no as Record<string, unknown>
  const tipo = obj['@type']
  if (typeof tipo === 'string') destino.add(tipo)
  else if (Array.isArray(tipo)) {
    for (const t of tipo) if (typeof t === 'string') destino.add(t)
  }
  if ('@graph' in obj) coletarTipos(obj['@graph'], destino)
}

function extrairSchemaTypes($: cheerio.CheerioAPI): string[] {
  const tipos = new Set<string>()
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      coletarTipos(JSON.parse($(el).text()), tipos)
    } catch {
      // JSON malformado em um bloco não pode derrubar os demais.
    }
  })
  return [...tipos]
}

function temNoindex($: cheerio.CheerioAPI): boolean {
  let achou = false
  $('meta[name]').each((_, el) => {
    const nome = (el.attribs.name ?? '').toLowerCase()
    if (nome !== 'robots' && nome !== 'googlebot') return
    const diretivas = (el.attribs.content ?? '').toLowerCase().split(',')
    if (diretivas.some((d) => d.trim() === 'noindex')) achou = true
  })
  return achou
}

function contarPalavras($: cheerio.CheerioAPI): number {
  const corpo = $('body').first().clone()
  corpo.find('script, style, noscript, nav, header, footer, svg').remove()
  return corpo.text().split(/\s+/).filter(Boolean).length
}

function vazio(url: string, statusCode: number): SinaisPagina {
  return {
    url,
    statusCode,
    title: null,
    metaDescription: null,
    h1Textos: [],
    palavras: 0,
    canonical: null,
    noindex: false,
    linksInternos: [],
    imagensSemAlt: 0,
    schemaTypes: [],
  }
}

export function extrairSinais(url: string, html: string, statusCode: number): SinaisPagina {
  try {
    const $ = cheerio.load(html)

    const links = new Set<string>()
    $('a[href]').each((_, el) => {
      const normalizado = normalizarUrl(el.attribs.href ?? '', url)
      if (normalizado) links.add(normalizado)
    })

    return {
      url,
      statusCode,
      title: textoOuNull($('title').first().text()),
      metaDescription: textoOuNull($('meta[name="description"]').first().attr('content')),
      h1Textos: $('h1')
        .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter(Boolean),
      palavras: contarPalavras($),
      canonical: textoOuNull($('link[rel="canonical"]').first().attr('href')),
      noindex: temNoindex($),
      linksInternos: [...links],
      imagensSemAlt: $('img').filter((_, el) => el.attribs.alt === undefined).length,
      schemaTypes: extrairSchemaTypes($),
    }
  } catch {
    return vazio(url, statusCode)
  }
}
