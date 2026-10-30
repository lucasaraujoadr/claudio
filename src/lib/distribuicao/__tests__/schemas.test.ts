import { describe, expect, it } from 'vitest'
import { repararPeca } from '../schemas'

const lam = (tipo: 'capa' | 'conteudo' | 'chamada', o: Record<string, unknown> = {}) => ({
  tipo, titulo: null, subtitulo: null, texto: null, itens: null, ...o,
})
function carrossel(n: number, capa: Record<string, unknown> = {}) {
  const meio = Array.from({ length: n - 2 }, (_, i) => lam('conteudo', { titulo: `Ponto ${i}`, texto: 'Texto curto.' }))
  return { laminas: [lam('capa', { titulo: 'Capa', subtitulo: 'Sub', ...capa }), ...meio, lam('chamada', { texto: 'Fale com a OG.' })], legenda: 'Legenda #pericia' }
}

describe('repararPeca', () => {
  it('carrossel com 9 lâminas → erro', () => {
    expect(() => repararPeca('carrossel', carrossel(9))).toThrow()
    expect(() => repararPeca('carrossel', carrossel(5))).toThrow()
    expect(repararPeca('carrossel', carrossel(8)).ajustes).toEqual([])
  })
  it('título da capa com 80 → cortado com ajuste', () => {
    const titulo = 'Perícia contábil trabalhista: como o advogado deve pedir os cálculos corretos'
    const { valor, ajustes } = repararPeca('carrossel', carrossel(6, { titulo }))
    const capa = (valor as { laminas: { titulo: string }[] }).laminas[0]
    expect(capa.titulo.length).toBeLessThanOrEqual(60)
    expect(titulo.startsWith(capa.titulo)).toBe(true)
    expect(ajustes.join()).toContain('título da capa')
  })
  it('lâmina com mais de 4 itens fica com 4', () => {
    const c = carrossel(6)
    c.laminas[1] = lam('conteudo', { titulo: 'x', texto: 'y', itens: ['a', 'b', 'c', 'd', 'e'] })
    const { valor, ajustes } = repararPeca('carrossel', c)
    expect((valor as { laminas: { itens: string[] }[] }).laminas[1].itens).toHaveLength(4)
    expect(ajustes.length).toBe(1)
  })
  it('lâmina de conteúdo sem texto nem itens → erro', () => {
    const c = carrossel(6)
    c.laminas[2] = lam('conteudo', { titulo: 'vazio' })
    expect(() => repararPeca('carrossel', c)).toThrow()
  })
  it('post: tira # das hashtags, exige 3 a 5', () => {
    const { valor } = repararPeca('linkedin_post', { texto: 'Olá', hashtags: ['#a', 'b', ' #c '] })
    expect((valor as { hashtags: string[] }).hashtags).toEqual(['a', 'b', 'c'])
    expect(() => repararPeca('linkedin_post', { texto: 'Olá', hashtags: ['a', 'b'] })).toThrow()
    expect(() => repararPeca('linkedin_post', { texto: 'Olá', hashtags: ['a', 'b', 'c', 'd', 'e', 'f'] })).toThrow()
  })
  it('post acima de 2.800 é cortado na palavra', () => {
    const { valor, ajustes } = repararPeca('linkedin_post', { texto: 'palavra '.repeat(500), hashtags: ['a', 'b', 'c'] })
    expect((valor as { texto: string }).texto.length).toBeLessThanOrEqual(2800)
    expect(ajustes).toHaveLength(1)
  })
  it('newsletter: pontos fora de 3-5 → erro; assunto longo cortado', () => {
    const base = { assunto: 'Assunto '.repeat(15), preCabecalho: 'p', abertura: 'a', pontos: ['1', '2', '3'] }
    const r = repararPeca('newsletter', base)
    expect((r.valor as { assunto: string }).assunto.length).toBeLessThanOrEqual(70)
    expect(() => repararPeca('newsletter', { ...base, pontos: ['1', '2'] })).toThrow()
  })
  it('artigo do LinkedIn fora de 600–1.200 palavras só avisa', () => {
    const bruto = { titulo: 'T', subtitulo: null, blocos: [{ tipo: 'paragrafo', texto: 'curto texto', itens: null }] }
    const { ajustes } = repararPeca('linkedin_artigo', bruto)
    expect(ajustes.join()).toContain('palavras')
  })
  it('artigo do LinkedIn sem blocos úteis → erro', () => {
    expect(() => repararPeca('linkedin_artigo', { titulo: 'T', subtitulo: null, blocos: [{ tipo: 'lista', texto: null, itens: null }] })).toThrow()
  })
})
