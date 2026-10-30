import { describe, expect, it } from 'vitest'
import { ajustarFonte } from '../arte/ajuste'

const caixa = { largura: 888, alturaMax: 400 }

describe('ajustarFonte', () => {
  it('escolhe o maior degrau que cabe', () => {
    const r = ajustarFonte('Perícia contábil', caixa, [72, 64, 56, 48])
    expect(r).toEqual({ tamanho: 72, linhas: 1 })
  })

  it('desce de degrau quando o texto não cabe no maior', () => {
    const texto = 'palavra '.repeat(30).trim()
    const r = ajustarFonte(texto, caixa, [72, 64, 56, 48, 36])
    expect(r).not.toBeNull()
    expect(r!.tamanho).toBeLessThan(72)
    expect(r!.linhas * r!.tamanho * 1.25).toBeLessThanOrEqual(400)
  })

  it('texto enorme → null', () => {
    expect(ajustarFonte('palavra '.repeat(500), caixa, [36, 32, 28, 26])).toBeNull()
  })

  it('palavra mais larga que a caixa não cabe', () => {
    expect(ajustarFonte('x'.repeat(200), caixa, [36])).toBeNull()
  })
})
