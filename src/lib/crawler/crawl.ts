import { extrairSinais, normalizarUrl, type SinaisPagina } from './parse'
import type { ContextoAuditoria } from './rules'

export const USER_AGENT = 'OG-SEO-Audit/1.0 (+https://ogpericiacontabil.com.br)'
const LIMITE_PADRAO = 300
const INTERVALO_PADRAO_MS = 1000
const TIMEOUT_MS = 15_000
const MAX_REDIRECIONAMENTOS = 5
const MAX_SITEMAPS_FILHOS = 10
/** Código gravado em statusPorUrl quando a requisição estoura o tempo ou falha na rede. */
export const STATUS_SEM_RESPOSTA = 0

export type OpcoesRastreio = {
  siteUrl: string
  maxPaginas?: number
  fetchImpl?: typeof fetch
  /** Pausa entre requisições. Padrão 1000 ms; os testes passam 0. */
  intervaloMs?: number
}

type Regra = { prefixo: RegExp }

/** Lê os Disallow dos grupos `User-agent: *` ou que citam a nossa ferramenta. */
function lerRobots(texto: string): { disallow: Regra[]; sitemaps: string[] } {
  const disallow: Regra[] = []
  const sitemaps: string[] = []
  let grupoAplicavel = false
  let lendoAgentes = false
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.replace(/#.*/, '').trim()
    const i = linha.indexOf(':')
    if (i < 0) continue
    const campo = linha.slice(0, i).trim().toLowerCase()
    const valor = linha.slice(i + 1).trim()
    if (campo === 'sitemap') {
      if (valor) sitemaps.push(valor)
    } else if (campo === 'user-agent') {
      const agente = valor.toLowerCase()
      const casa = agente === '*' || agente.startsWith('og-seo-audit')
      grupoAplicavel = lendoAgentes ? grupoAplicavel || casa : casa
      lendoAgentes = true
    } else {
      lendoAgentes = false
      if (campo === 'disallow' && grupoAplicavel && valor) {
        // Suporta os curingas `*` e `$` do padrão de robots.txt.
        const padrao = valor
          .replace(/[.+?^{}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\$$/, '$')
        disallow.push({ prefixo: new RegExp(`^${padrao}`) })
      }
    }
  }
  return { disallow, sitemaps }
}

function extrairLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi)].map((m) => m[1])
}

export async function rastrear(opts: OpcoesRastreio): Promise<{ paginas: SinaisPagina[]; ctx: ContextoAuditoria }> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const limite = opts.maxPaginas ?? LIMITE_PADRAO
  const intervalo = opts.intervaloMs ?? INTERVALO_PADRAO_MS

  const inicio = normalizarUrl(opts.siteUrl, opts.siteUrl)
  if (!inicio) throw new Error(`URL inicial inválida: ${opts.siteUrl}`)
  const origem = new URL(inicio).origin

  // --- Requisição com intervalo, User-Agent e timeout ----------------------
  let ultimaRequisicao = 0
  async function buscar(
    url: string,
  ): Promise<{ status: number; tipo: string; location: string | null; corpo: () => Promise<string> } | null> {
    const espera = ultimaRequisicao + intervalo - Date.now()
    if (ultimaRequisicao > 0 && espera > 0) await new Promise((r) => setTimeout(r, espera))
    ultimaRequisicao = Date.now()
    try {
      const resposta = await fetchImpl(url, {
        redirect: 'manual',
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xml;q=0.9,*/*;q=0.5' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      return {
        status: resposta.status,
        tipo: (resposta.headers.get('content-type') ?? '').toLowerCase(),
        location: resposta.headers.get('location'),
        corpo: () => resposta.text(),
      }
    } catch {
      return null
    }
  }

  async function buscarTexto(url: string): Promise<string | null> {
    const r = await buscar(url)
    if (!r || r.status !== 200) return null
    try {
      return await r.corpo()
    } catch {
      return null
    }
  }

  // --- robots.txt e sitemap --------------------------------------------------
  const robotsTexto = (await buscarTexto(`${origem}/robots.txt`)) ?? ''
  const robots = lerRobots(robotsTexto)
  const bloqueada = (url: string): boolean => {
    const u = new URL(url)
    const caminho = u.pathname + u.search
    return robots.disallow.some((r) => r.prefixo.test(caminho))
  }

  const candidatosSitemap = robots.sitemaps.length > 0 ? robots.sitemaps : [`${origem}/sitemap.xml`]
  const urlsSitemap: string[] = []
  const jaNoSitemap = new Set<string>()
  const adicionarLocs = (locs: string[]) => {
    for (const loc of locs) {
      const n = normalizarUrl(loc, inicio)
      if (n && !jaNoSitemap.has(n)) {
        jaNoSitemap.add(n)
        urlsSitemap.push(n)
      }
    }
  }
  for (const endereco of candidatosSitemap) {
    const xml = await buscarTexto(endereco)
    if (!xml) continue
    if (/<sitemapindex/i.test(xml)) {
      for (const filho of extrairLocs(xml).slice(0, MAX_SITEMAPS_FILHOS)) {
        const xmlFilho = await buscarTexto(filho)
        if (xmlFilho) adicionarLocs(extrairLocs(xmlFilho))
      }
    } else {
      adicionarLocs(extrairLocs(xml))
    }
  }

  // --- Fila sequencial ------------------------------------------------------
  const vistos = new Set<string>([inicio]) // enfileiradas ou já processadas
  const fila: string[] = [inicio]
  for (const u of urlsSitemap) {
    if (!vistos.has(u) && !bloqueada(u)) {
      vistos.add(u)
      fila.push(u)
    }
  }

  const paginas: SinaisPagina[] = []
  const statusPorUrl: Record<string, number> = {}
  const redirecionamentos = new Map<string, string>()
  let urlInicial = inicio
  let urlsMenu: string[] = []
  let processadas = 0

  while (fila.length > 0 && processadas < limite) {
    const origemFila = fila.shift() as string
    processadas++

    let atual = origemFila
    for (let salto = 0; salto <= MAX_REDIRECIONAMENTOS; salto++) {
      const r = await buscar(atual)
      if (!r) {
        statusPorUrl[atual] = STATUS_SEM_RESPOSTA
        break
      }
      statusPorUrl[atual] = r.status

      if (r.status >= 300 && r.status < 400 && r.location) {
        const destino = normalizarUrl(r.location, atual)
        if (!destino || bloqueada(destino)) break // outra origem ou proibido: fica só o status
        redirecionamentos.set(atual, destino)
        if (origemFila === inicio) urlInicial = destino
        if (vistos.has(destino)) break // já enfileirado ou processado
        vistos.add(destino)
        atual = destino
        continue
      }

      if (r.status >= 200 && r.status < 300 && r.tipo.includes('text/html')) {
        let html: string
        try {
          html = await r.corpo()
        } catch {
          statusPorUrl[atual] = STATUS_SEM_RESPOSTA
          break
        }
        const sinais = extrairSinais(atual, html, r.status)
        paginas.push(sinais)
        if (origemFila === inicio) urlsMenu = sinais.linksInternos
        for (const link of sinais.linksInternos) {
          if (!vistos.has(link) && !bloqueada(link)) {
            vistos.add(link)
            fila.push(link)
          }
        }
      }
      break
    }
  }

  // Páginas que apontam para uma URL redirecionada passam a apontar para o destino,
  // senão o destino pareceria órfão (ninguém linka para ele diretamente).
  const resolver = (url: string): string => {
    let u = url
    for (let i = 0; i < MAX_REDIRECIONAMENTOS && redirecionamentos.has(u); i++) {
      u = redirecionamentos.get(u) as string
    }
    return u
  }
  for (const p of paginas) {
    p.linksInternos = [...new Set(p.linksInternos.map(resolver))]
  }
  urlsMenu = [...new Set(urlsMenu.map(resolver))]

  return {
    paginas,
    ctx: {
      urlInicial,
      sitemapResolvido: urlsSitemap.length > 0,
      urlsSitemap,
      urlsMenu,
      statusPorUrl,
    },
  }
}
