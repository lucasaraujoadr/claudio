import { describe, it, expect } from 'vitest'
import { paraHtml, normalizarSlug, slugValido, contarPalavras, artigoSchemaModelo, type ArtigoModelo } from '../formato'

function base(p: Partial<ArtigoModelo> = {}): ArtigoModelo {
  return {
    titulo: 'T',
    slug: 't',
    metaDescription: 'm',
    introducao: [{ tipo: 'paragrafo', texto: 'Intro' }],
    secoes: [
      {
        titulo: 'Seção 1',
        blocos: [{ tipo: 'paragrafo', texto: 'Corpo 1' }],
        subsecoes: [{ titulo: 'Sub 1', blocos: [{ tipo: 'paragrafo', texto: 'Corpo sub' }] }],
      },
    ],
    faq: [{ pergunta: 'Pergunta?', resposta: 'Resposta.' }],
    conclusao: [{ tipo: 'paragrafo', texto: 'Fale conosco' }],
    ...p,
  }
}

describe('paraHtml', () => {
  it('gera h2/h3, faq e conclusão na ordem', () => {
    const h = paraHtml(base(), [])
    expect(h).toBe(
      '<p>Intro</p><h2>Seção 1</h2><p>Corpo 1</p><h3>Sub 1</h3><p>Corpo sub</p>' +
        '<h2>Perguntas frequentes</h2><h3>Pergunta?</h3><p>Resposta.</p><p>Fale conosco</p>',
    )
  })
  it('link para url fora da lista vira texto', () => {
    const a = base({ introducao: [{ tipo: 'paragrafo', texto: 'Veja [meu post](https://x.com/inventado) já' }] })
    expect(paraHtml(a, ['https://x.com/real'])).toContain('<p>Veja meu post já</p>')
  })
  it('link permitido aceita com ou sem barra final', () => {
    const a = base({ introducao: [{ tipo: 'paragrafo', texto: 'Veja [post](https://x.com/real/) e [outro](https://x.com/b)' }] })
    const h = paraHtml(a, ['https://x.com/real', 'https://x.com/b/'])
    expect(h).toContain('<a href="https://x.com/real/">post</a>')
    expect(h).toContain('<a href="https://x.com/b">outro</a>')
  })
  it('aplica negrito e itálico', () => {
    const a = base({ introducao: [{ tipo: 'paragrafo', texto: 'a **b** e *c*' }] })
    expect(paraHtml(a, [])).toContain('<p>a <strong>b</strong> e <em>c</em></p>')
  })
  it('escapa <script> vindo do modelo', () => {
    const a = base({ introducao: [{ tipo: 'paragrafo', texto: '<script>alert(1)</script>' }], titulo: 'x' })
    const h = paraHtml(a, [])
    expect(h).not.toContain('<script>')
    expect(h).toContain('&lt;script&gt;')
  })
  it('bloco verificar vira mark com data-verificar', () => {
    const a = base({
      introducao: [
        { tipo: 'paragrafo', texto: 'Valor', verificar: 'conferir "valor"' },
        { tipo: 'lista', itens: ['a', 'b'], verificar: 'm' },
      ],
    })
    const h = paraHtml(a, [])
    expect(h).toContain('<p><mark data-verificar="conferir &quot;valor&quot;">Valor</mark></p>')
    expect(h).toContain('<ul><li><mark data-verificar="m">a</mark></li><li><mark data-verificar="m">b</mark></li></ul>')
  })
  it('lista numerada e citação', () => {
    const a = base({
      introducao: [
        { tipo: 'lista_numerada', itens: ['um'] },
        { tipo: 'citacao', texto: 'q' },
      ],
    })
    expect(paraHtml(a, [])).toContain('<ol><li>um</li></ol><blockquote><p>q</p></blockquote>')
  })
})

describe('slug', () => {
  it('normaliza acento, caixa e pontuação', () => {
    expect(normalizarSlug('Revisão do PASEP: 2026!')).toBe('revisao-do-pasep-2026')
  })
  it('corta em 75 sem hífen final', () => {
    const s = normalizarSlug('palavra '.repeat(30))
    expect(s.length).toBeLessThanOrEqual(75)
    expect(s.endsWith('-')).toBe(false)
    expect(slugValido(s)).toBe(true)
  })
  it('slugValido', () => {
    expect(slugValido('a-b')).toBe(true)
    expect(slugValido('A b')).toBe(false)
    expect(slugValido('')).toBe(false)
    expect(slugValido('a'.repeat(76))).toBe(false)
  })
})

describe('contarPalavras', () => {
  it('ignora tags', () => {
    expect(contarPalavras('<h2>Um dois</h2><p>três <strong>quatro</strong></p>')).toBe(4)
    expect(contarPalavras('')).toBe(0)
  })
})

describe('schema leniente', () => {
  it('aceita artigo sem limites de string', () => {
    expect(artigoSchemaModelo.safeParse(base({ titulo: 'x'.repeat(500) })).success).toBe(true)
  })
})
