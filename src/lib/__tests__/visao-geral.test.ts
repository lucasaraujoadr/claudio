import { describe, expect, it } from 'vitest'
import { calcularVariacao, escolherSnapshotComparacao } from '../visao-geral'

describe('calcularVariacao', () => {
  it('calcula variação percentual positiva e negativa', () => {
    expect(calcularVariacao(150, 100)).toEqual({ delta: 50, percentual: 50 })
    expect(calcularVariacao(75, 100)).toEqual({ delta: -25, percentual: -25 })
  })

  it('devolve percentual null quando o período anterior é zero', () => {
    expect(calcularVariacao(10, 0)).toEqual({ delta: 10, percentual: null })
    expect(calcularVariacao(0, 0).percentual).toBe(0)
  })

  it('devolve percentual 0 quando os dois períodos são iguais', () => {
    expect(calcularVariacao(40, 40)).toEqual({ delta: 0, percentual: 0 })
  })

  it('nunca devolve Infinity nem NaN para entradas não finitas', () => {
    for (const [a, b] of [
      [Infinity, 10],
      [10, Infinity],
      [NaN, 5],
      [5, NaN],
      [Infinity, 0],
    ]) {
      const r = calcularVariacao(a, b)
      expect(Number.isFinite(r.delta)).toBe(true)
      expect(r.percentual === null || Number.isFinite(r.percentual)).toBe(true)
    }
  })
})

describe('escolherSnapshotComparacao', () => {
  it('escolhe o snapshot mais próximo de 28 dias antes', () => {
    const datas = ['2026-10-26', '2026-09-28', '2026-09-29', '2026-09-30']
    expect(escolherSnapshotComparacao('2026-10-26', datas)).toBe('2026-09-28')
  })

  it('aceita 28 ± 3 dias e rejeita fora disso', () => {
    expect(escolherSnapshotComparacao('2026-10-26', ['2026-09-25'])).toBe('2026-09-25')
    expect(escolherSnapshotComparacao('2026-10-26', ['2026-10-01'])).toBe('2026-10-01')
    expect(escolherSnapshotComparacao('2026-10-26', ['2026-09-24'])).toBeNull()
    expect(escolherSnapshotComparacao('2026-10-26', ['2026-10-02'])).toBeNull()
  })

  it('devolve null sem histórico e ignora o próprio snapshot atual', () => {
    expect(escolherSnapshotComparacao('2026-10-26', [])).toBeNull()
    expect(escolherSnapshotComparacao('2026-10-26', ['2026-10-26'])).toBeNull()
  })
})
