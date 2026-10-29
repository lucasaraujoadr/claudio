import { describe, it, expect } from 'vitest'
import {
  CTR_POR_POSICAO,
  ctrNaPosicao,
  ganhoEstimado,
  ehOportunidade,
} from '../ctr'

describe('ehOportunidade', () => {
  // Review Focus 5
  it('inclui os limites 5 e 20', () => {
    expect(ehOportunidade(5)).toBe(true)
    expect(ehOportunidade(20)).toBe(true)
  })
  it('exclui 4,9 e 20,1', () => {
    expect(ehOportunidade(4.9)).toBe(false)
    expect(ehOportunidade(20.1)).toBe(false)
  })
})

describe('ganhoEstimado', () => {
  it('calcula impressoes x delta de CTR até a posição 3', () => {
    expect(ganhoEstimado({ impressoes: 1000, ctrAtual: 0.02 })).toBeCloseTo(90)
  })
  it('devolve 0 e nunca negativo quando o CTR atual já supera o alvo', () => {
    expect(ganhoEstimado({ impressoes: 1000, ctrAtual: 0.5 })).toBe(0)
  })
  it('devolve 0 com zero impressões', () => {
    expect(ganhoEstimado({ impressoes: 0, ctrAtual: 0.01 })).toBe(0)
  })
})

describe('ctrNaPosicao', () => {
  it('usa o valor da posição 20 para posições acima de 20', () => {
    expect(ctrNaPosicao(25)).toBe(CTR_POR_POSICAO[20])
  })
  it('usa o valor da posição 1 para posição menor que 1', () => {
    expect(ctrNaPosicao(0.4)).toBe(CTR_POR_POSICAO[1])
  })
  it('arredonda posição fracionária para o inteiro mais próximo', () => {
    expect(ctrNaPosicao(7.4)).toBe(CTR_POR_POSICAO[7])
    expect(ctrNaPosicao(7.6)).toBe(CTR_POR_POSICAO[8])
  })
})
