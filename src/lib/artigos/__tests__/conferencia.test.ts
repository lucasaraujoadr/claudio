import { describe, it, expect } from 'vitest'
import { conferir, podePublicar } from '../conferencia'
import { hostSite } from '../../site'

const host = hostSite()
const palavras = (n: number) => Array.from({ length: n }, () => 'palavra').join(' ')

function completo(p: Record<string, unknown> = {}) {
  const conteudoHtml =
    `<p>Perícia contábil é essencial. ${palavras(950)}</p>` +
    `<h2>Primeira seção</h2><p>Veja <a href="https://${host}/a">um</a> e <a href="https://${host}/b">dois</a>.</p>` +
    `<h2>Segunda seção</h2><p>fim</p>`
  return {
    titulo: 'Perícia contábil: guia prático',
    slug: 'pericia-contabil-guia',
    metaDescription: 'x'.repeat(130),
    conteudoHtml,
    keyword: 'perícia contábil',
    categoriaId: 3,
    capaMediaId: 10,
    revisado: true,
    ...p,
  }
}

const nivel = (a: ReturnType<typeof completo>, id: string) => conferir(a).find((i) => i.id === id)?.nivel

describe('conferir', () => {
  it('artigo completo: tudo ok e publicável', () => {
    const itens = conferir(completo())
    expect(itens.map((i) => i.id)).toEqual([
      'verificar', 'titulo_vazio', 'slug', 'revisado', 'kw_titulo', 'kw_primeiro_paragrafo', 'kw_slug',
      'titulo_tamanho', 'meta_tamanho', 'links_internos', 'palavras', 'h2', 'h2_repetido', 'capa', 'categoria',
    ])
    expect(itens.every((i) => i.nivel === 'ok')).toBe(true)
    expect(podePublicar(itens)).toBe(true)
  })

  it('verificar pendente bloqueia e menciona a quantidade', () => {
    const a = completo({ conteudoHtml: completo().conteudoHtml + '<p><mark data-verificar>a</mark><mark data-verificar>b</mark></p>' })
    const i = conferir(a).find((x) => x.id === 'verificar')!
    expect(i.nivel).toBe('bloqueia')
    expect(i.texto).toContain('2')
    expect(podePublicar(conferir(a))).toBe(false)
  })

  it('título vazio bloqueia', () => {
    expect(nivel(completo({ titulo: '  ' }), 'titulo_vazio')).toBe('bloqueia')
  })

  it('slug inválido ou em uso bloqueia', () => {
    expect(nivel(completo({ slug: 'Com Espaço' }), 'slug')).toBe('bloqueia')
    expect(nivel(completo({ slug: '' }), 'slug')).toBe('bloqueia')
    const i = conferir(completo({ slugEmUso: 'https://x.com/p' })).find((x) => x.id === 'slug')!
    expect(i.nivel).toBe('bloqueia')
    expect(i.texto).toContain('endereço já usado em https://x.com/p')
  })

  it('revisado false bloqueia', () => {
    expect(nivel(completo({ revisado: false }), 'revisado')).toBe('bloqueia')
  })

  it('keyword com acento diferente conta como presente', () => {
    expect(nivel(completo({ titulo: 'PERICIA CONTABIL guia' }), 'kw_titulo')).toBe('ok')
    expect(nivel(completo({ titulo: 'Outro assunto' }), 'kw_titulo')).toBe('aviso')
  })

  it('keyword fora do primeiro parágrafo e do slug avisa', () => {
    expect(nivel(completo({ conteudoHtml: '<p>nada</p><h2>a</h2>' }), 'kw_primeiro_paragrafo')).toBe('aviso')
    expect(nivel(completo({ slug: 'outro-slug' }), 'kw_slug')).toBe('aviso')
  })

  it('título acima de 60 avisa', () => {
    expect(nivel(completo({ titulo: 'a'.repeat(60) }), 'titulo_tamanho')).toBe('ok')
    expect(nivel(completo({ titulo: 'a'.repeat(61) }), 'titulo_tamanho')).toBe('aviso')
  })

  it('meta: 119 aviso, 120 e 155 ok, 156 aviso', () => {
    const n = (k: number) => nivel(completo({ metaDescription: 'x'.repeat(k) }), 'meta_tamanho')
    expect([n(119), n(120), n(155), n(156)]).toEqual(['aviso', 'ok', 'ok', 'aviso'])
  })

  it('links internos: 1 aviso, 2 ok, externos não contam', () => {
    const h = (l: string) => completo({ conteudoHtml: `<p>perícia contábil ${palavras(950)}</p><h2>x</h2>${l}` })
    const int = `<a href="https://${host}/a">a</a>`
    const ext = '<a href="https://outro.com/z">z</a>'
    expect(nivel(h(int + ext + ext), 'links_internos')).toBe('aviso')
    expect(nivel(h(int + int + ext), 'links_internos')).toBe('ok')
  })

  it('menos de 900 palavras avisa', () => {
    expect(nivel(completo({ conteudoHtml: '<p>perícia contábil curto</p><h2>x</h2>' }), 'palavras')).toBe('aviso')
  })

  it('sem H2 avisa; H2 repetido avisa', () => {
    expect(nivel(completo({ conteudoHtml: '<p>perícia contábil</p>' }), 'h2')).toBe('aviso')
    expect(nivel(completo({ conteudoHtml: '<h2>Igual</h2><h2>igual </h2>' }), 'h2_repetido')).toBe('aviso')
  })

  it('sem capa e sem categoria avisam e não bloqueiam', () => {
    const a = completo({ capaMediaId: null, categoriaId: null })
    expect(nivel(a, 'capa')).toBe('aviso')
    expect(nivel(a, 'categoria')).toBe('aviso')
    expect(podePublicar(conferir(a))).toBe(true)
  })
})
