import { describe, expect, it } from 'vitest'
import {
  caminhoArea,
  caminhoLinha,
  contarComDado,
  datasEntre,
  formatarCompacto,
  formatarDiaMes,
  indiceMaisProximo,
  indicesRotulosX,
  larguraPercentual,
  serieDiaria,
  somarDias,
  temDado,
  ticksEixo,
} from '../serie'

describe('datas', () => {
  it('soma dias atravessando mês e ano, em UTC', () => {
    expect(somarDias('2026-10-28', 4)).toBe('2026-11-01')
    expect(somarDias('2026-01-01', -1)).toBe('2025-12-31')
    // Horário de verão / fuso da máquina não interferem.
    expect(somarDias('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('lista as datas de um intervalo, inclusive', () => {
    expect(datasEntre('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    expect(datasEntre('2026-10-02', '2026-10-01')).toEqual([])
    expect(datasEntre('lixo', '2026-10-01')).toEqual([])
  })

  it('formata dia/mês', () => {
    expect(formatarDiaMes('2026-10-05')).toBe('05/10')
  })
})

describe('serieDiaria (sem dado ≠ zero)', () => {
  it('um ponto por dia; dia sem linha vira null, não 0', () => {
    const s = serieDiaria([{ data: '2026-10-01', v: 3 }, { data: '2026-10-03', v: 0 }], (l) => l.v, '2026-10-01', '2026-10-04')
    expect(s).toEqual([
      { data: '2026-10-01', valor: 3 },
      { data: '2026-10-02', valor: null },
      { data: '2026-10-03', valor: 0 },
      { data: '2026-10-04', valor: null },
    ])
  })

  it('valor não finito vira null', () => {
    expect(serieDiaria([{ data: '2026-10-01', v: NaN }], (l) => l.v, '2026-10-01', '2026-10-01')[0].valor).toBeNull()
  })

  it('temDado só é verdadeiro com algum número de verdade', () => {
    expect(temDado([null, null])).toBe(false)
    expect(temDado([])).toBe(false)
    expect(temDado([null, 0])).toBe(true)
    expect(contarComDado([null, 0, 5])).toBe(2)
  })
})

describe('eixo', () => {
  it('marcas limpas a partir de zero que cobrem o máximo', () => {
    expect(ticksEixo(55)).toEqual([0, 20, 40, 60])
    expect(ticksEixo(100)).toEqual([0, 25, 50, 75, 100])
    expect(ticksEixo(7)).toEqual([0, 2, 4, 6, 8])
  })

  it('máximo zero ou inválido ainda dá uma escala, sem passo fracionário', () => {
    expect(ticksEixo(0)).toEqual([0, 1])
    expect(ticksEixo(NaN)).toEqual([0, 1])
    expect(ticksEixo(1)).toEqual([0, 1])
  })

  it('rótulos compactos em pt-BR', () => {
    expect(formatarCompacto(950)).toBe('950')
    expect(formatarCompacto(1200)).toMatch(/^1,2\s?mil$/)
  })

  it('rótulos do eixo X espaçados e sempre com o último', () => {
    expect(indicesRotulosX(90, 6)).toEqual([0, 18, 36, 53, 71, 89])
    expect(indicesRotulosX(3, 6)).toEqual([0, 1, 2])
    expect(indicesRotulosX(0, 6)).toEqual([])
  })

  it('crosshair acha o ponto mais próximo e fica dentro dos limites', () => {
    expect(indiceMaisProximo(50, 11, 0, 100)).toBe(5)
    expect(indiceMaisProximo(-20, 11, 0, 100)).toBe(0)
    expect(indiceMaisProximo(500, 11, 0, 100)).toBe(10)
    expect(indiceMaisProximo(10, 1, 0, 100)).toBe(0)
  })
})

describe('caminhos SVG', () => {
  const x = (i: number) => i * 10
  const y = (v: number) => 100 - v

  it('linha interrompe nas lacunas', () => {
    expect(caminhoLinha([1, 2, null, 4], x, y)).toBe('M0,99L10,98M30,96')
    expect(caminhoLinha([null, null], x, y)).toBe('')
  })

  it('área por trecho contínuo, ignorando ponto isolado', () => {
    expect(caminhoArea([1, 2, null, 4], x, y, 100)).toBe('M0,99L10,98L10,100L0,100Z')
  })

  it('largura das barras relativa à maior', () => {
    expect(larguraPercentual(46, 92)).toBe(50)
    expect(larguraPercentual(0, 92)).toBe(0)
    expect(larguraPercentual(5, 0)).toBe(0)
  })
})
