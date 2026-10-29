import { describe, expect, it } from 'vitest'
import { calcularTermosEmAlta, escolherDatas } from '../termos-em-alta'

describe('calcularTermosEmAlta', () => {
  it('ordena pelo aumento absoluto e trata query nova como anterior 0', () => {
    const r = calcularTermosEmAlta(
      [{ query: 'a', impressoes: 100 }, { query: 'b', impressoes: 50 }, { query: 'c', impressoes: 90 }],
      [{ query: 'a', impressoes: 90 }, { query: 'c', impressoes: 10 }],
    )
    expect(r.map((t) => [t.query, t.aumento])).toEqual([['c', 80], ['b', 50], ['a', 10]])
    expect(r.find((t) => t.query === 'b')).toMatchObject({ atual: 50, anterior: 0 })
  })
  it('descarta queda e estabilidade', () => {
    expect(calcularTermosEmAlta([{ query: 'a', impressoes: 5 }, { query: 'b', impressoes: 9 }], [{ query: 'a', impressoes: 8 }, { query: 'b', impressoes: 9 }])).toEqual([])
  })
  it('soma páginas da mesma query e ignora caixa e espaços', () => {
    const r = calcularTermosEmAlta([{ query: 'Selic ', impressoes: 10 }, { query: 'selic', impressoes: 15 }], [{ query: ' SELIC', impressoes: 5 }])
    expect(r).toEqual([{ query: 'Selic', atual: 25, anterior: 5, aumento: 20 }])
  })
  it('limita aos 20 maiores', () => {
    const atual = Array.from({ length: 30 }, (_, i) => ({ query: `q${i}`, impressoes: i + 1 }))
    const r = calcularTermosEmAlta(atual, [])
    expect(r).toHaveLength(20)
    expect(r[0].query).toBe('q29')
  })
  it('sem dados devolve vazio', () => expect(calcularTermosEmAlta([], [])).toEqual([]))
})

describe('escolherDatas', () => {
  it('sem snapshots: null', () => expect(escolherDatas([])).toBeNull())
  it('um só snapshot: sem anterior', () => expect(escolherDatas(['2026-10-29'])).toEqual({ atual: '2026-10-29', anterior: null }))
  it('escolhe o mais recente com 28 a 35 dias de diferença', () => {
    expect(escolherDatas(['2026-10-29', '2026-10-01', '2026-09-28', '2026-09-20', '2026-10-28'])).toEqual({ atual: '2026-10-29', anterior: '2026-10-01' })
  })
  it('janelas sobrepostas (menos de 28 dias) não servem', () => {
    expect(escolherDatas(['2026-10-29', '2026-10-15'])).toEqual({ atual: '2026-10-29', anterior: null })
  })
})
