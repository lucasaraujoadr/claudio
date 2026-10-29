import { describe, expect, it } from 'vitest'
import { avaliar } from '../rules'
import { rastrear } from '../crawl'

const SITE = 'https://ogpericiacontabil.com.br'

type Resposta = {
  status?: number
  tipo?: string
  corpo?: string
  location?: string
}

function pagina(titulo: string, links: string[] = []): Resposta {
  const as = links.map((l) => `<a href="${l}">x</a>`).join('')
  return { corpo: `<html><head><title>${titulo}</title></head><body><h1>${titulo}</h1>${as}</body></html>` }
}

/** fetch falso: mapa URL → resposta, com registro das chamadas. */
function fakeFetch(mapa: Record<string, Resposta>) {
  const chamadas: { url: string; redirect: RequestRedirect | undefined }[] = []
  const impl = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entrada)
    chamadas.push({ url, redirect: init?.redirect })
    const r = mapa[url]
    if (!r) return new Response('não encontrado', { status: 404, headers: { 'content-type': 'text/html' } })
    const headers: Record<string, string> = { 'content-type': r.tipo ?? 'text/html; charset=UTF-8' }
    if (r.location) headers.location = r.location
    return new Response(r.corpo ?? '', { status: r.status ?? 200, headers })
  }) as typeof fetch
  return { impl, chamadas, urls: () => chamadas.map((c) => c.url) }
}

const ROBOTS = (extra = '') =>
  `User-agent: *\nDisallow: /wp-admin/\n${extra}`

const sitemap = (...urls: string[]) =>
  `<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`

const opts = (f: ReturnType<typeof fakeFetch>, extra: { maxPaginas?: number } = {}) => ({
  siteUrl: SITE,
  fetchImpl: f.impl,
  intervaloMs: 0,
  ...extra,
})

describe('rastrear', () => {
  it('começa pelo sitemap do robots.txt quando ele resolve', async () => {
    const f = fakeFetch({
      [`${SITE}/robots.txt`]: { tipo: 'text/plain', corpo: ROBOTS(`Sitemap: ${SITE}/mapa.xml`) },
      [`${SITE}/mapa.xml`]: { tipo: 'application/xml', corpo: sitemap(`${SITE}/`, `${SITE}/sobre`, `${SITE}/isolada`) },
      [`${SITE}/`]: pagina('Home'),
      [`${SITE}/sobre/`]: pagina('Sobre'),
      [`${SITE}/isolada/`]: pagina('Isolada'),
    })
    const { paginas, ctx } = await rastrear(opts(f))
    expect(ctx.sitemapResolvido).toBe(true)
    expect(ctx.urlsSitemap).toEqual([`${SITE}/`, `${SITE}/sobre/`, `${SITE}/isolada/`])
    // a página só presente no sitemap (sem link vindo da home) foi visitada
    expect(paginas.map((p) => p.url).sort()).toEqual([`${SITE}/`, `${SITE}/isolada/`, `${SITE}/sobre/`])
  })

  it('marca sitemapResolvido false e parte da home quando o sitemap dá 404', async () => {
    const f = fakeFetch({
      [`${SITE}/robots.txt`]: { tipo: 'text/plain', corpo: ROBOTS(`Sitemap: ${SITE}/sitemap.xml`) },
      [`${SITE}/`]: pagina('Home', ['/sobre/']),
      [`${SITE}/sobre/`]: pagina('Sobre'),
    })
    const { paginas, ctx } = await rastrear(opts(f))
    expect(ctx.sitemapResolvido).toBe(false)
    expect(ctx.urlsSitemap).toEqual([])
    expect(ctx.statusPorUrl[`${SITE}/sitemap.xml`]).toBeUndefined()
    expect(paginas.map((p) => p.url).sort()).toEqual([`${SITE}/`, `${SITE}/sobre/`])
    expect(avaliar(paginas, ctx).some((p) => p.regra === 'sitemap-invalido' && p.severidade === 'critico')).toBe(true)
  })

  it('urlsMenu são os links internos da página inicial', async () => {
    const f = fakeFetch({
      [`${SITE}/`]: pagina('Home', ['/a/', '/b/', 'https://outro.com/x']),
      [`${SITE}/a/`]: pagina('A', ['/c/']),
      [`${SITE}/b/`]: pagina('B'),
      [`${SITE}/c/`]: pagina('C'),
    })
    const { ctx } = await rastrear(opts(f))
    expect(ctx.urlsMenu).toEqual([`${SITE}/a/`, `${SITE}/b/`])
    expect(ctx.urlInicial).toBe(`${SITE}/`)
  })

  it('para no teto de maxPaginas', async () => {
    const mapa: Record<string, Resposta> = {
      [`${SITE}/`]: pagina('Home', ['/1/', '/2/', '/3/', '/4/', '/5/']),
    }
    for (let i = 1; i <= 5; i++) mapa[`${SITE}/${i}/`] = pagina(`P${i}`)
    const f = fakeFetch(mapa)
    const { paginas } = await rastrear(opts(f, { maxPaginas: 3 }))
    expect(paginas).toHaveLength(3)
    const paginasPedidas = f.urls().filter((u) => u !== `${SITE}/robots.txt` && !u.endsWith('sitemap.xml'))
    expect(paginasPedidas).toHaveLength(3)
  })

  it('não sai do domínio nem entra em /wp-admin/', async () => {
    const f = fakeFetch({
      [`${SITE}/robots.txt`]: { tipo: 'text/plain', corpo: ROBOTS() },
      [`${SITE}/`]: pagina('Home', [
        '/wp-admin/',
        '/wp-admin/admin-ajax.php',
        'https://www.facebook.com/og',
        'http://ogpericiacontabil.com.br/http/',
        '/ok/',
      ]),
      [`${SITE}/ok/`]: pagina('Ok'),
    })
    const { paginas } = await rastrear(opts(f))
    expect(paginas.map((p) => p.url).sort()).toEqual([`${SITE}/`, `${SITE}/ok/`])
    // asserção sobre o que foi realmente pedido, não sobre a saída
    expect(f.urls().some((u) => u.includes('/wp-admin/'))).toBe(false)
    expect(f.urls().every((u) => new URL(u).origin === SITE)).toBe(true)
  })

  it('não visita a mesma URL duas vezes', async () => {
    const f = fakeFetch({
      [`${SITE}/`]: pagina('Home', ['/a/', '/b/', '/a/#topo']),
      [`${SITE}/a/`]: pagina('A', ['/b/', '/']),
      [`${SITE}/b/`]: pagina('B', ['/a/']),
    })
    await rastrear(opts(f))
    const urls = f.urls()
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('trata /sobre-nos e /sobre-nos/ como a mesma página, visitada uma vez', async () => {
    const f = fakeFetch({
      [`${SITE}/`]: pagina('Home', ['/sobre-nos', '/outra/']),
      [`${SITE}/outra/`]: pagina('Outra', ['/sobre-nos/']),
      [`${SITE}/sobre-nos/`]: pagina('Sobre', ['/']),
    })
    const { paginas } = await rastrear(opts(f))
    const sobre = paginas.filter((p) => p.url.includes('sobre-nos'))
    expect(sobre.map((p) => p.url)).toEqual([`${SITE}/sobre-nos/`])
    expect(f.urls().filter((u) => u.includes('sobre-nos'))).toHaveLength(1)
    // a url passada ao parser é a canônica: nenhuma página aparece órfã
    const { ctx } = await rastrear(opts(f))
    expect(avaliar(paginas, ctx).filter((p) => p.regra === 'pagina-orfa')).toEqual([])
  })

  it('registra e segue adiante quando a resposta é application/pdf', async () => {
    const f = fakeFetch({
      [`${SITE}/`]: pagina('Home', ['/guia.pdf', '/ok/']),
      [`${SITE}/guia.pdf`]: { tipo: 'application/pdf', corpo: '%PDF-1.4 <title>falso</title>' },
      [`${SITE}/ok/`]: pagina('Ok'),
    })
    const { paginas, ctx } = await rastrear(opts(f))
    expect(ctx.statusPorUrl[`${SITE}/guia.pdf`]).toBe(200)
    expect(paginas.map((p) => p.url)).not.toContain(`${SITE}/guia.pdf`)
    expect(paginas.map((p) => p.url)).toContain(`${SITE}/ok/`)
  })

  it('registra e segue adiante quando a resposta não é HTML', async () => {
    const f = fakeFetch({
      [`${SITE}/`]: pagina('Home', ['/foto.jpg', '/dados/', '/ok/']),
      [`${SITE}/foto.jpg`]: { tipo: 'image/jpeg', corpo: 'binário' },
      [`${SITE}/dados/`]: { tipo: 'application/json', corpo: '{"a":1}' },
      [`${SITE}/ok/`]: pagina('Ok'),
    })
    const { paginas, ctx } = await rastrear(opts(f))
    expect(ctx.statusPorUrl[`${SITE}/foto.jpg`]).toBe(200)
    expect(ctx.statusPorUrl[`${SITE}/dados/`]).toBe(200)
    expect(paginas.map((p) => p.url).sort()).toEqual([`${SITE}/`, `${SITE}/ok/`])
  })

  it('segue 301 e registra a página sob a URL de destino, não a de origem', async () => {
    const f = fakeFetch({
      [`${SITE}/`]: pagina('Home', ['/antiga/']),
      [`${SITE}/antiga/`]: { status: 301, location: '/nova/', corpo: '' },
      [`${SITE}/nova/`]: pagina('Nova'),
    })
    const { paginas, ctx } = await rastrear(opts(f))
    const urls = paginas.map((p) => p.url)
    expect(urls).toContain(`${SITE}/nova/`)
    expect(urls).not.toContain(`${SITE}/antiga/`)
    expect(ctx.statusPorUrl[`${SITE}/antiga/`]).toBe(301)
    expect(ctx.statusPorUrl[`${SITE}/nova/`]).toBe(200)
  })

  it('não gera órfã falsa para a URL que redirecionou', async () => {
    const f = fakeFetch({
      [`${SITE}/`]: pagina('Home', ['/antiga/']),
      [`${SITE}/antiga/`]: { status: 301, location: `${SITE}/nova/`, corpo: '' },
      [`${SITE}/nova/`]: pagina('Nova', ['/']),
    })
    const { paginas, ctx } = await rastrear(opts(f))
    const problemas = avaliar(paginas, ctx)
    // nem a origem (que não é página) nem o destino (alcançado via redirecionamento)
    expect(problemas.filter((p) => p.regra === 'pagina-orfa')).toEqual([])
    expect(problemas.filter((p) => p.regra === 'link-quebrado')).toEqual([])
  })

  it('preenche statusPorUrl com o código de cada URL visitada', async () => {
    const f = fakeFetch({
      [`${SITE}/`]: pagina('Home', ['/ok/', '/sumiu/', '/erro/']),
      [`${SITE}/ok/`]: pagina('Ok'),
      [`${SITE}/erro/`]: { status: 500, corpo: 'falha' },
    })
    const { ctx } = await rastrear(opts(f))
    expect(ctx.statusPorUrl).toMatchObject({
      [`${SITE}/`]: 200,
      [`${SITE}/ok/`]: 200,
      [`${SITE}/sumiu/`]: 404,
      [`${SITE}/erro/`]: 500,
    })
  })

  it('uma URL 404 vai para statusPorUrl e não entra em paginas', async () => {
    const f = fakeFetch({
      [`${SITE}/`]: pagina('Home', ['/sumiu/']),
    })
    const { paginas, ctx } = await rastrear(opts(f))
    expect(ctx.statusPorUrl[`${SITE}/sumiu/`]).toBe(404)
    expect(paginas.map((p) => p.url)).toEqual([`${SITE}/`])
    const problemas = avaliar(paginas, ctx)
    expect(problemas.some((p) => p.regra === 'link-quebrado' && p.url === `${SITE}/`)).toBe(true)
    expect(problemas.some((p) => p.url === `${SITE}/sumiu/`)).toBe(false)
  })

  it('timeout ou falha de rede grava 0 e o rastreamento continua', async () => {
    const base = fakeFetch({
      [`${SITE}/`]: pagina('Home', ['/lenta/', '/ok/']),
      [`${SITE}/ok/`]: pagina('Ok'),
    })
    const impl = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
      if (String(entrada).endsWith('/lenta/')) throw new DOMException('tempo esgotado', 'TimeoutError')
      return base.impl(entrada, init)
    }) as typeof fetch
    const { paginas, ctx } = await rastrear({ siteUrl: SITE, fetchImpl: impl, intervaloMs: 0 })
    expect(ctx.statusPorUrl[`${SITE}/lenta/`]).toBe(0)
    expect(paginas.map((p) => p.url)).toContain(`${SITE}/ok/`)
  })

  it('envia User-Agent identificando a ferramenta e um sinal de timeout', async () => {
    let init: RequestInit | undefined
    const impl = (async (_e: RequestInfo | URL, i?: RequestInit) => {
      init = i
      return new Response('', { status: 404 })
    }) as typeof fetch
    await rastrear({ siteUrl: SITE, fetchImpl: impl, intervaloMs: 0 })
    expect(new Headers(init?.headers).get('user-agent')).toMatch(/^OG-SEO-Audit\//)
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('respeita o intervalo entre requisições', async () => {
    const instantes: number[] = []
    const impl = (async () => {
      instantes.push(Date.now())
      return new Response('', { status: 404 })
    }) as typeof fetch
    await rastrear({ siteUrl: SITE, fetchImpl: impl, intervaloMs: 40 })
    expect(instantes.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < instantes.length; i++) {
      expect(instantes[i] - instantes[i - 1]).toBeGreaterThanOrEqual(35)
    }
  })
})
