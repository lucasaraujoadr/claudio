import { describe, it, expect } from 'vitest'
import { normalizarTags, normalizarUf, separarTags } from '../campos'

describe('campos', () => {
  it('UF por sigla ou por nome; o resto vira null', () => {
    expect(normalizarUf(' sp ')).toBe('SP')
    expect(normalizarUf('São Paulo')).toBe('SP')
    expect(normalizarUf('MATO GROSSO DO SUL')).toBe('MS')
    expect(normalizarUf('XX')).toBeNull()
    expect(normalizarUf('')).toBeNull()
  })

  it('tags normalizadas e sem repetição', () => {
    expect(normalizarTags([' Trabalhista ', 'trabalhista', '', 'Cálculo  Judicial'])).toEqual(['trabalhista', 'cálculo judicial'])
    expect(separarTags('a, b; c | a')).toEqual(['a', 'b', 'c'])
  })
})
