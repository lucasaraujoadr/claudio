import { describe, it, expect } from 'vitest'
import { classificarOportunidades, montarOportunidades } from '../oportunidades'
import type { LinhaGsc } from '../gsc'

function linha(p: Partial<LinhaGsc>): LinhaGsc {
  return { query: 'q', page: 'https://ogpericiacontabil.com.br/a', clicks: 0, impressions: 1000, ctr: 0.01, position: 8, ...p }
}

describe('montarOportunidades', () => {
  it('filtra apenas a faixa de oportunidade', () => {
    const r = montarOportunidades([
      linha({ query: 'a', position: 3 }),
      linha({ query: 'b', position: 5 }),
      linha({ query: 'c', position: 20 }),
      linha({ query: 'd', position: 20.1 }),
    ])
    expect(r.map((o) => o.query).sort()).toEqual(['b', 'c'])
  })

  it('ordena por ganho estimado decrescente', () => {
    const r = montarOportunidades([
      linha({ query: 'pouco', impressions: 100 }),
      linha({ query: 'muito', impressions: 5000 }),
      linha({ query: 'medio', impressions: 1000 }),
    ])
    expect(r.map((o) => o.query)).toEqual(['muito', 'medio', 'pouco'])
    expect(r[0].ganho).toBeGreaterThan(r[1].ganho)
  })

  it('mantém a URL que já ranqueia em cada linha', () => {
    const r = montarOportunidades([linha({ query: 'x', page: 'https://ogpericiacontabil.com.br/x' })])
    expect(r[0].page).toBe('https://ogpericiacontabil.com.br/x')
  })

  it('devolve lista vazia quando nenhuma linha está na faixa', () => {
    expect(montarOportunidades([linha({ position: 2 }), linha({ position: 40 })])).toEqual([])
    expect(montarOportunidades([])).toEqual([])
  })

  it('descarta linhas com position, impressions ou ctr não finito sem quebrar a ordem', () => {
    const r = montarOportunidades([
      linha({ query: 'pouco', impressions: 100 }),
      linha({ query: 'nan-pos', position: NaN }),
      linha({ query: 'muito', impressions: 5000 }),
      linha({ query: 'nan-imp', impressions: NaN }),
      linha({ query: 'nan-ctr', ctr: NaN }),
      linha({ query: 'inf', impressions: Infinity }),
      linha({ query: 'medio', impressions: 1000 }),
    ])
    expect(r.map((o) => o.query)).toEqual(['muito', 'medio', 'pouco'])
    expect(r.every((o) => Number.isFinite(o.ganho))).toBe(true)
  })

  it('desempata ganho igual por impressões desc e depois por query', () => {
    // ctr alto zera o ganho de todas (ganho 0 igual)
    const r = montarOportunidades([
      linha({ query: 'b', impressions: 100, ctr: 0.9 }),
      linha({ query: 'a', impressions: 100, ctr: 0.9 }),
      linha({ query: 'c', impressions: 300, ctr: 0.9 }),
    ])
    expect(r.map((o) => o.query)).toEqual(['c', 'a', 'b'])
  })
})

describe('classificarOportunidades', () => {
  const op = (query: string, page = 'https://ogpericiacontabil.com.br/a', impressions = 1000) =>
    linha({ query, page, impressions })

  it('marca como coberta a query cujo tema existe, ignorando acento e caixa', () => {
    const r = classificarOportunidades([op('calculos trabalhistas'), op('pericia bancaria')], ['Cálculos Trabalhistas'])
    expect(r.todas.find((o) => o.query === 'calculos trabalhistas')?.coberta).toBe(true)
    expect(r.todas.find((o) => o.query === 'pericia bancaria')?.coberta).toBe(false)
    expect(r.abertas.map((o) => o.query)).toEqual(['pericia bancaria'])
  })

  it('conta queries abertas distintas, não linhas (query, page)', () => {
    const r = classificarOportunidades(
      [op('pericia bancaria', 'https://x/a'), op('pericia bancaria', 'https://x/b'), op('Perícia  Bancária', 'https://x/c'), op('outra')],
      [],
    )
    expect(r.abertas).toHaveLength(4)
    expect(r.queriesAbertas).toBe(2)
  })

  it('sem temas, tudo fica aberto; sem linhas, zero', () => {
    expect(classificarOportunidades([op('a')], []).queriesAbertas).toBe(1)
    expect(classificarOportunidades([], ['a'])).toEqual({ todas: [], abertas: [], queriesAbertas: 0 })
  })

  it('mantém a ordenação e o filtro de faixa de montarOportunidades', () => {
    const r = classificarOportunidades([linha({ query: 'fora', position: 2 }), op('menor', 'p', 100), op('maior', 'p', 5000)], [])
    expect(r.todas.map((o) => o.query)).toEqual(['maior', 'menor'])
  })
})
