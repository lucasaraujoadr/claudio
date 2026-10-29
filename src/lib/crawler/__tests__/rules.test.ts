import { describe, expect, it } from 'vitest'
import type { SinaisPagina } from '../parse'
import { avaliar, type ContextoAuditoria, type Problema } from '../rules'

const BASE = 'https://ogpericiacontabil.com.br/'

function texto(n: number): string {
  return 'a'.repeat(n)
}

// Página saudável: nenhuma regra dispara. Cada teste sobrescreve só o que mede.
function pagina(sobrescreve: Partial<SinaisPagina> = {}): SinaisPagina {
  return {
    url: `${BASE}sobre-nos/`,
    statusCode: 200,
    title: texto(45),
    metaDescription: texto(100),
    h1Textos: ['Título'],
    palavras: 500,
    canonical: null,
    noindex: false,
    linksInternos: [`${BASE}a/`, `${BASE}b/`],
    imagensSemAlt: 0,
    schemaTypes: ['WebPage'],
    ...sobrescreve,
  }
}

function ctx(sobrescreve: Partial<ContextoAuditoria> = {}): ContextoAuditoria {
  return {
    urlInicial: BASE,
    sitemapResolvido: true,
    urlsSitemap: [],
    urlsMenu: [],
    statusPorUrl: {},
    ...sobrescreve,
  }
}

// Avalia uma página que recebe link de uma "âncora" para não ser órfã.
function regrasDe(p: SinaisPagina, c = ctx(), extras: SinaisPagina[] = []): Problema[] {
  const ancora = pagina({
    url: BASE,
    title: texto(50),
    metaDescription: texto(90),
    schemaTypes: ['Organization', 'WebSite'],
    linksInternos: [p.url, `${BASE}x/`],
  })
  return avaliar([ancora, p, ...extras], c)
}

function achou(problemas: Problema[], regra: string, url?: string): Problema[] {
  return problemas.filter((x) => x.regra === regra && (url === undefined || x.url === url))
}

describe('página saudável', () => {
  it('não produz nenhum problema', () => {
    expect(regrasDe(pagina())).toEqual([])
  })
})

describe('title-ausente', () => {
  it('acusa title nulo ou vazio, como critico', () => {
    const r = achou(regrasDe(pagina({ title: null })), 'title-ausente')
    expect(r).toHaveLength(1)
    expect(r[0].severidade).toBe('critico')
    expect(achou(regrasDe(pagina({ title: '   ' })), 'title-ausente')).toHaveLength(1)
  })
  it('não acusa title presente', () => {
    expect(achou(regrasDe(pagina()), 'title-ausente')).toHaveLength(0)
  })
})

describe('title-duplicado', () => {
  it('acusa as duas páginas, não só a segunda', () => {
    const a = pagina({ url: `${BASE}a/`, title: texto(40) })
    const b = pagina({ url: `${BASE}b/`, title: texto(40) })
    const r = achou(avaliar([a, b], ctx({ urlInicial: a.url })), 'title-duplicado')
    expect(r.map((x) => x.url).sort()).toEqual([a.url, b.url])
    expect(r[0].severidade).toBe('critico')
  })
  it('não acusa titles distintos', () => {
    const a = pagina({ url: `${BASE}a/`, title: texto(40) })
    const b = pagina({ url: `${BASE}b/`, title: texto(41) })
    expect(achou(avaliar([a, b], ctx({ urlInicial: a.url })), 'title-duplicado')).toHaveLength(0)
  })
  it('não trata title ausente como duplicado entre si', () => {
    const a = pagina({ url: `${BASE}a/`, title: null })
    const b = pagina({ url: `${BASE}b/`, title: null })
    expect(achou(avaliar([a, b], ctx({ urlInicial: a.url })), 'title-duplicado')).toHaveLength(0)
  })
})

describe('title-tamanho', () => {
  it('aceita 30 e 60, acusa 29 e 61', () => {
    expect(achou(regrasDe(pagina({ title: texto(30) })), 'title-tamanho')).toHaveLength(0)
    expect(achou(regrasDe(pagina({ title: texto(60) })), 'title-tamanho')).toHaveLength(0)
    const curto = achou(regrasDe(pagina({ title: texto(29) })), 'title-tamanho')
    const longo = achou(regrasDe(pagina({ title: texto(61) })), 'title-tamanho')
    expect(curto).toHaveLength(1)
    expect(longo).toHaveLength(1)
    expect(longo[0].severidade).toBe('aviso')
    expect(longo[0].mensagem).toContain('61')
  })
  it('conta o valor aparado', () => {
    expect(achou(regrasDe(pagina({ title: `  ${texto(30)}  ` })), 'title-tamanho')).toHaveLength(0)
  })
})

describe('meta-ausente', () => {
  it('acusa meta nula, como aviso', () => {
    const r = achou(regrasDe(pagina({ metaDescription: null })), 'meta-ausente')
    expect(r).toHaveLength(1)
    expect(r[0].severidade).toBe('aviso')
  })
  it('não acusa meta presente', () => {
    expect(achou(regrasDe(pagina()), 'meta-ausente')).toHaveLength(0)
  })
})

describe('meta-duplicada', () => {
  it('acusa as duas páginas', () => {
    const a = pagina({ url: `${BASE}a/`, metaDescription: texto(100) })
    const b = pagina({ url: `${BASE}b/`, metaDescription: texto(100) })
    const r = achou(avaliar([a, b], ctx({ urlInicial: a.url })), 'meta-duplicada')
    expect(r.map((x) => x.url).sort()).toEqual([a.url, b.url])
    expect(r[0].severidade).toBe('aviso')
  })
  it('não acusa metas distintas', () => {
    const a = pagina({ url: `${BASE}a/`, metaDescription: texto(100) })
    const b = pagina({ url: `${BASE}b/`, metaDescription: texto(101) })
    expect(achou(avaliar([a, b], ctx({ urlInicial: a.url })), 'meta-duplicada')).toHaveLength(0)
  })
})

describe('meta-tamanho', () => {
  it('aceita 70 e 160, acusa 69 e 161', () => {
    expect(achou(regrasDe(pagina({ metaDescription: texto(70) })), 'meta-tamanho')).toHaveLength(0)
    expect(achou(regrasDe(pagina({ metaDescription: texto(160) })), 'meta-tamanho')).toHaveLength(0)
    expect(achou(regrasDe(pagina({ metaDescription: texto(69) })), 'meta-tamanho')).toHaveLength(1)
    const longo = achou(regrasDe(pagina({ metaDescription: texto(161) })), 'meta-tamanho')
    expect(longo).toHaveLength(1)
    expect(longo[0].severidade).toBe('aviso')
    expect(longo[0].mensagem).toContain('161')
  })
})

describe('h1', () => {
  it('h1-ausente acusa zero H1 e não acusa h1-multiplo', () => {
    const p = regrasDe(pagina({ h1Textos: [] }))
    expect(achou(p, 'h1-ausente')).toHaveLength(1)
    expect(achou(p, 'h1-ausente')[0].severidade).toBe('critico')
    expect(achou(p, 'h1-multiplo')).toHaveLength(0)
  })
  it('h1-ausente não acusa um H1', () => {
    expect(achou(regrasDe(pagina()), 'h1-ausente')).toHaveLength(0)
  })
  it('h1-multiplo acusa mais de um, com a contagem, e não acusa h1-ausente', () => {
    const p = regrasDe(pagina({ h1Textos: ['a', 'b', 'c'] }))
    const r = achou(p, 'h1-multiplo')
    expect(r).toHaveLength(1)
    expect(r[0].severidade).toBe('aviso')
    expect(r[0].mensagem).toBe('3 elementos H1 encontrados; deveria haver 1')
    expect(achou(p, 'h1-ausente')).toHaveLength(0)
  })
  it('h1-multiplo não acusa exatamente um', () => {
    expect(achou(regrasDe(pagina()), 'h1-multiplo')).toHaveLength(0)
  })
})

describe('conteudo-raso', () => {
  it('aceita 300 palavras e acusa 299', () => {
    expect(achou(regrasDe(pagina({ palavras: 300 })), 'conteudo-raso')).toHaveLength(0)
    const r = achou(regrasDe(pagina({ palavras: 299 })), 'conteudo-raso')
    expect(r).toHaveLength(1)
    expect(r[0].severidade).toBe('aviso')
    expect(r[0].mensagem).toContain('299')
  })
})

describe('pagina-orfa', () => {
  it('não acusa a URL inicial, mesmo sem link entrante', () => {
    const inicial = pagina({ url: BASE, schemaTypes: ['Organization', 'WebSite'], linksInternos: [] })
    expect(achou(avaliar([inicial], ctx()), 'pagina-orfa')).toHaveLength(0)
  })
  it('acusa página sem link entrante, como critico', () => {
    const solta = pagina({ url: `${BASE}solta/`, schemaTypes: ['Article'] })
    const inicial = pagina({ url: BASE, schemaTypes: ['Organization', 'WebSite'], linksInternos: [] })
    const r = achou(avaliar([inicial, solta], ctx()), 'pagina-orfa')
    expect(r).toHaveLength(1)
    expect(r[0].url).toBe(solta.url)
    expect(r[0].severidade).toBe('critico')
  })
  it('não acusa página que recebe link de qualquer outra', () => {
    expect(achou(regrasDe(pagina()), 'pagina-orfa')).toHaveLength(0)
  })
  it('link para si mesma não salva a página', () => {
    const p = pagina({ url: `${BASE}solta/`, schemaTypes: ['Article'], linksInternos: [`${BASE}solta/`] })
    const inicial = pagina({ url: BASE, schemaTypes: ['Organization', 'WebSite'], linksInternos: [] })
    expect(achou(avaliar([inicial, p], ctx()), 'pagina-orfa')).toHaveLength(1)
  })
})

describe('poucos-links-internos', () => {
  it('acusa menos de 2 links', () => {
    const r = achou(regrasDe(pagina({ linksInternos: [`${BASE}a/`] })), 'poucos-links-internos')
    expect(r).toHaveLength(1)
    expect(r[0].severidade).toBe('aviso')
  })
  it('não acusa 2 links', () => {
    expect(achou(regrasDe(pagina()), 'poucos-links-internos')).toHaveLength(0)
  })
})

describe('canonical-divergente', () => {
  it('acusa canonical apontando para outra URL', () => {
    const r = achou(regrasDe(pagina({ canonical: `${BASE}outra/` })), 'canonical-divergente')
    expect(r).toHaveLength(1)
    expect(r[0].severidade).toBe('aviso')
    expect(r[0].mensagem).toContain(`${BASE}outra/`)
  })
  it('não acusa canonical autorreferente nem ausente', () => {
    expect(achou(regrasDe(pagina({ canonical: `${BASE}sobre-nos/` })), 'canonical-divergente')).toHaveLength(0)
    expect(achou(regrasDe(pagina({ canonical: null })), 'canonical-divergente')).toHaveLength(0)
  })
})

describe('noindex-inesperado', () => {
  const url = `${BASE}sobre-nos/`
  it('só acusa página 200 que está no sitemap ou no menu', () => {
    const noSitemap = regrasDe(pagina({ noindex: true }), ctx({ urlsSitemap: [url] }))
    const noMenu = regrasDe(pagina({ noindex: true }), ctx({ urlsMenu: [url] }))
    expect(achou(noSitemap, 'noindex-inesperado')).toHaveLength(1)
    expect(achou(noSitemap, 'noindex-inesperado')[0].severidade).toBe('critico')
    expect(achou(noMenu, 'noindex-inesperado')).toHaveLength(1)
  })
  it('ignora página fora do sitemap e do menu', () => {
    expect(achou(regrasDe(pagina({ noindex: true })), 'noindex-inesperado')).toHaveLength(0)
  })
  it('ignora página que não responde 200', () => {
    const r = regrasDe(pagina({ noindex: true, statusCode: 404 }), ctx({ urlsSitemap: [url] }))
    expect(achou(r, 'noindex-inesperado')).toHaveLength(0)
  })
  it('não acusa página indexável', () => {
    expect(achou(regrasDe(pagina(), ctx({ urlsSitemap: [url] })), 'noindex-inesperado')).toHaveLength(0)
  })
})

describe('schema-ausente', () => {
  const p = (path: string, schemaTypes: string[]) => pagina({ url: `${BASE}${path}`, schemaTypes })
  const roda = (pg: SinaisPagina) =>
    achou(avaliar([pg], ctx({ urlInicial: pg.url })), 'schema-ausente')

  it('home exige Organization e WebSite', () => {
    expect(roda(p('', ['Organization']))).toHaveLength(1)
    expect(roda(p('', ['WebSite']))).toHaveLength(1)
    expect(roda(p('', ['Organization', 'WebSite']))).toHaveLength(0)
    expect(roda(p('', []))[0].severidade).toBe('aviso')
  })
  it('usa o mapa de padrão de URL corrigido', () => {
    expect(roda(p('servicos/', []))).toHaveLength(1)
    expect(roda(p('servicos/pericia/', ['Service']))).toHaveLength(0)
    expect(roda(p('servicos/pericia/', ['WebPage']))).toHaveLength(1)
    for (const s of ['sobre-nos', 'para-advogados', 'blog', 'politica-de-privacidade']) {
      expect(roda(p(`${s}/`, ['WebPage']))).toHaveLength(0)
      expect(roda(p(`${s}/`, ['Article']))).toHaveLength(1)
    }
    expect(roda(p('contato/', ['ContactPage']))).toHaveLength(0)
    expect(roda(p('contato/', ['WebPage']))).toHaveLength(1)
  })
  it('trata URL de raiz fora da lista como post e espera Article ou BlogPosting', () => {
    expect(roda(p('cartao-rmc-riscos/', ['WebSite', 'WebPage']))).toHaveLength(1)
    expect(roda(p('cartao-rmc-riscos/', ['Article']))).toHaveLength(0)
    expect(roda(p('cartao-rmc-riscos/', ['BlogPosting']))).toHaveLength(0)
  })
  it('não acusa URL mais profunda que não casa com nenhum padrão', () => {
    expect(roda(p('blog/algo/', []))).toHaveLength(0)
    expect(roda(p('a/b/c/', []))).toHaveLength(0)
  })
})

describe('link-quebrado', () => {
  it('usa statusPorUrl e acusa 404 e 500, como critico', () => {
    const p = pagina({ linksInternos: [`${BASE}a/`, `${BASE}b/`, `${BASE}c/`] })
    const r = achou(
      regrasDe(p, ctx({ statusPorUrl: { [`${BASE}a/`]: 404, [`${BASE}b/`]: 500, [`${BASE}c/`]: 200 } })),
      'link-quebrado',
      p.url,
    )
    expect(r).toHaveLength(2)
    expect(r[0].severidade).toBe('critico')
    expect(r.map((x) => x.mensagem).join('|')).toContain(`${BASE}a/`)
  })
  it('URL ausente do mapa não é link quebrado', () => {
    expect(achou(regrasDe(pagina()), 'link-quebrado')).toHaveLength(0)
  })
  it('200 e 301 não são link quebrado', () => {
    const c = ctx({ statusPorUrl: { [`${BASE}a/`]: 301, [`${BASE}b/`]: 200 } })
    expect(achou(regrasDe(pagina(), c), 'link-quebrado')).toHaveLength(0)
  })
})

describe('imagem-sem-alt', () => {
  it('acusa imagensSemAlt > 0 e informa a contagem', () => {
    const r = achou(regrasDe(pagina({ imagensSemAlt: 3 })), 'imagem-sem-alt')
    expect(r).toHaveLength(1)
    expect(r[0].severidade).toBe('aviso')
    expect(r[0].mensagem).toContain('3')
  })
  it('não acusa zero', () => {
    expect(achou(regrasDe(pagina()), 'imagem-sem-alt')).toHaveLength(0)
  })
})

describe('sitemap-invalido', () => {
  it('emite problema com url null quando sitemapResolvido é false', () => {
    const r = achou(regrasDe(pagina(), ctx({ sitemapResolvido: false })), 'sitemap-invalido')
    expect(r).toHaveLength(1)
    expect(r[0].url).toBeNull()
    expect(r[0].severidade).toBe('critico')
  })
  it('não emite quando o sitemap resolveu', () => {
    expect(achou(regrasDe(pagina()), 'sitemap-invalido')).toHaveLength(0)
  })
})
