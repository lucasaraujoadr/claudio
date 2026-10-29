import { describe, expect, it } from 'vitest'
import { normalizarKeyword } from '../keyword'

describe('normalizarKeyword', () => {
  it('ignora caixa e acentos', () => {
    expect(normalizarKeyword('PERÍCIA Contábil')).toBe('pericia contabil')
  })
  it('colapsa espaços internos e apara as pontas', () => {
    expect(normalizarKeyword('  pericia \t  contabil\n')).toBe('pericia contabil')
  })
  it('trata cedilha e til', () => {
    expect(normalizarKeyword('Liquidação de Sentença')).toBe('liquidacao de sentenca')
  })
  it('query do GSC e keyword da IA do mesmo assunto ficam iguais', () => {
    expect(normalizarKeyword('cálculos trabalhistas')).toBe(normalizarKeyword('calculos trabalhistas'))
  })
})
