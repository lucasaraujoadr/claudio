import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extrairSinais, normalizarUrl } from '../parse'

const BASE = 'https://ogpericiacontabil.com.br'

function fixture(nome: string): string {
  return readFileSync(join(__dirname, 'fixtures', `${nome}.html`), 'utf8')
}

describe('extrairSinais com fixtures reais', () => {
  it('extrai title, meta e h1 da home', () => {
    const s = extrairSinais(`${BASE}/`, fixture('home'), 200)
    expect(s.url).toBe(`${BASE}/`)
    expect(s.statusCode).toBe(200)
    expect(s.title).toBe('Perícia Contábil Judicial para Advogados - OG Perícia Contábil')
    expect(s.metaDescription).toBe(
      'Atuação nacional em perícia contábil judicial, liquidação de sentença, assistência técnica e cálculos judiciais para advogados.',
    )
    expect(s.h1Textos).toHaveLength(9)
    expect(s.h1Textos[0]).toBe('Perícia contábil e cálculos judiciais para advogados em todo o Brasil')
    expect(s.canonical).toBe(`${BASE}/`)
  })

  it('extrai title e h1 do post', () => {
    const s = extrairSinais(`${BASE}/cartao-rmc-riscos/`, fixture('post'), 200)
    expect(s.title).toBe('Cartão RMC: Riscos e Como Identificar Abusos - OG Perícia Contábil')
    expect(s.h1Textos).toEqual(['Blog', 'Cartão RMC: Riscos e Como Identificar Abusos'])
    expect(s.canonical).toBe(`${BASE}/cartao-rmc-riscos/`)
  })

  it('conta palavras do corpo ignorando script, style e nav', () => {
    expect(extrairSinais(`${BASE}/`, fixture('home'), 200).palavras).toBe(877)
    expect(extrairSinais(`${BASE}/servicos/`, fixture('servicos'), 200).palavras).toBe(585)
    expect(extrairSinais(`${BASE}/cartao-rmc-riscos/`, fixture('post'), 200).palavras).toBe(1341)
  })

  it('não trata a meta robots do SEO Framework como noindex', () => {
    expect(extrairSinais(`${BASE}/`, fixture('home'), 200).noindex).toBe(false)
  })

  it('lê @type de JSON-LD, inclusive dentro de @graph', () => {
    const s = extrairSinais(`${BASE}/`, fixture('home'), 200)
    // Só nós de @graph: tipos aninhados (SearchAction, ListItem...) não entram.
    expect(s.schemaTypes).toEqual(['WebSite', 'WebPage', 'Organization'])
    const post = extrairSinais(`${BASE}/cartao-rmc-riscos/`, fixture('post'), 200)
    expect(post.schemaTypes).toEqual(['WebSite', 'WebPage'])
  })

  it('conta imagens sem alt, ignorando alt="" decorativo', () => {
    expect(extrairSinais(`${BASE}/`, fixture('home'), 200).imagensSemAlt).toBe(0)
    expect(extrairSinais(`${BASE}/servicos/`, fixture('servicos'), 200).imagensSemAlt).toBe(0)
  })

  it('devolve só links internos absolutos, normalizados e sem duplicatas', () => {
    const s = extrairSinais(`${BASE}/`, fixture('home'), 200)
    expect(s.linksInternos.length).toBeGreaterThan(5)
    expect(s.linksInternos).toContain(`${BASE}/servicos/`)
    expect(new Set(s.linksInternos).size).toBe(s.linksInternos.length)
    for (const l of s.linksInternos) {
      expect(l.startsWith(`${BASE}/`)).toBe(true)
      expect(l).not.toContain('#')
    }
  })
})

describe('extrairSinais com HTML sintético', () => {
  const sinais = (html: string) => extrairSinais(`${BASE}/p/`, html, 200)

  it('devolve canonical null quando a tag não existe', () => {
    expect(sinais('<html><head><title>x</title></head><body></body></html>').canonical).toBeNull()
  })

  it('detecta noindex em meta robots e googlebot', () => {
    expect(sinais('<meta name="robots" content="noindex,nofollow,max-snippet:-1">').noindex).toBe(true)
    expect(sinais('<meta name="robots" content="max-snippet:-1, NOINDEX">').noindex).toBe(true)
    expect(sinais('<meta name="googlebot" content="noindex">').noindex).toBe(true)
    expect(sinais('<meta name="robots" content="index,follow">').noindex).toBe(false)
  })

  it('conta imagens sem atributo alt, mas não alt vazio', () => {
    const s = sinais('<img src="a.jpg"><img src="b.jpg" alt=""><img src="c.jpg" alt="foto"><img src="d.jpg">')
    expect(s.imagensSemAlt).toBe(2)
  })

  it('resolve links relativos, descarta externos e esquemas não-HTTP', () => {
    const s = sinais(`
      <a href="/servicos">a</a><a href="contato/">b</a><a href="https://outro.com/x">c</a>
      <a href="mailto:a@b.com">d</a><a href="tel:123">e</a><a href="javascript:void(0)">f</a>
      <a href="/servicos/#topo">dup</a>`)
    expect(s.linksInternos).toEqual([`${BASE}/servicos/`, `${BASE}/p/contato/`])
  })

  it('inclui links de navegação e conta palavras sem nav/header/footer', () => {
    const s = sinais('<nav><a href="/menu/">menu menu menu</a></nav><body><p>um dois três</p><footer>rodapé</footer></body>')
    expect(s.linksInternos).toEqual([`${BASE}/menu/`])
    expect(s.palavras).toBe(3)
  })

  it('lê @type em objeto, array, @graph e @type em array; ignora JSON malformado', () => {
    const s = sinais(`
      <script type="application/ld+json">{ quebrado</script>
      <script type="application/ld+json">{"@type":"Organization"}</script>
      <script type="application/ld+json">[{"@type":"Person"},{"@type":["Article","BlogPosting"]}]</script>
      <script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Organization"}]}</script>`)
    expect(s.schemaTypes).toEqual(['Organization', 'Person', 'Article', 'BlogPosting', 'WebPage'])
  })

  it('não lança em HTML truncado, sem head ou vazio', () => {
    expect(() => sinais('<html><head><title>Corta')).not.toThrow()
    expect(() => sinais('<div><a href="/x')).not.toThrow()
    const vazio = sinais('')
    expect(vazio).toEqual({
      url: `${BASE}/p/`, statusCode: 200, title: null, metaDescription: null, h1Textos: [],
      palavras: 0, canonical: null, noindex: false, linksInternos: [], imagensSemAlt: 0, schemaTypes: [],
    })
    expect(sinais('<p>só corpo</p>').title).toBeNull()
  })

  it('não lança com URL de página inválida', () => {
    expect(() => extrairSinais('não é url', '<a href="/x">x</a>', 0)).not.toThrow()
  })
})

describe('normalizarUrl', () => {
  it('resolve relativa contra a base', () => {
    expect(normalizarUrl('../a', `${BASE}/x/y/`)).toBe(`${BASE}/x/a/`)
  })
  it('remove fragmento e garante barra final', () => {
    expect(normalizarUrl('/servicos#topo', BASE)).toBe(`${BASE}/servicos/`)
  })
  it('mantém a raiz com barra única', () => {
    expect(normalizarUrl(BASE, BASE)).toBe(`${BASE}/`)
  })
  it('minúscula no host, nunca no caminho', () => {
    expect(normalizarUrl('https://OGPericiaContabil.com.br/Servicos/Foo', BASE)).toBe(`${BASE}/Servicos/Foo/`)
  })
  it('não adiciona barra em caminho com extensão', () => {
    expect(normalizarUrl('/wp-content/a.pdf', BASE)).toBe(`${BASE}/wp-content/a.pdf`)
    expect(normalizarUrl('/img/foto.JPG?v=2', BASE)).toBe(`${BASE}/img/foto.JPG?v=2`)
  })
  it('mantém a query string como está', () => {
    expect(normalizarUrl('/busca?q=Perícia&b=1', BASE)).toBe(`${BASE}/busca/?q=Per%C3%ADcia&b=1`)
    expect(normalizarUrl('/busca/?s=A', BASE)).toBe(`${BASE}/busca/?s=A`)
  })
  it('null para outra origem, esquema não-HTTP e inválido', () => {
    expect(normalizarUrl('https://google.com/', BASE)).toBeNull()
    expect(normalizarUrl('http://ogpericiacontabil.com.br/', BASE)).toBeNull()
    expect(normalizarUrl('mailto:a@b.com', BASE)).toBeNull()
    expect(normalizarUrl('tel:+5511', BASE)).toBeNull()
    expect(normalizarUrl('javascript:void(0)', BASE)).toBeNull()
    expect(normalizarUrl('http://', BASE)).toBeNull()
    expect(normalizarUrl('/x', 'não é base')).toBeNull()
  })
})
