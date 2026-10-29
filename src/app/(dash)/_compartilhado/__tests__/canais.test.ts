import { describe, expect, it } from 'vitest'
import { agruparPorCanal, canalDe, separarOrigemMidia, topPaginas } from '../canais'

describe('canalDe', () => {
  it.each([
    ['google / cpc', 'pago'],
    ['bing / ppc', 'pago'],
    ['facebook / paid_social', 'pago'],
    ['google / organic', 'organico'],
    ['bing / organic', 'organico'],
    ['(direct) / (none)', 'direto'],
    ['oliveiraguimaraes.com / referral', 'referencia'],
    ['facebook.com / referral', 'social'],
    ['l.wl.co / referral', 'social'],
    ['m.facebook.com / referral', 'social'],
    ['ig / social', 'social'],
    ['instagram / organic', 'social'],
    ['chatgpt.com / ai-assistant', 'outros'],
    ['(data not available)', 'outros'],
    ['newsletter / email', 'outros'],
  ] as const)('%s → %s', (origem, canal) => {
    expect(canalDe(origem)).toBe(canal)
  })

  it('não confunde domínio que só contém o nome de uma rede', () => {
    expect(canalDe('notfacebook.com.br / referral')).toBe('referencia')
  })

  it('separa fonte e mídia pela última barra', () => {
    expect(separarOrigemMidia('Google / CPC')).toEqual({ fonte: 'google', midia: 'cpc' })
    expect(separarOrigemMidia('(data not available)')).toEqual({ fonte: '(data not available)', midia: '' })
  })
})

const linhas = [
  { pagina: '/', origemMidia: 'google / cpc', sessoes: 60, eventosChave: 2 },
  { pagina: '/', origemMidia: '(direct) / (none)', sessoes: 10, eventosChave: 0 },
  { pagina: '/pericia/', origemMidia: 'google / cpc', sessoes: 20, eventosChave: 1 },
  { pagina: '/pericia/', origemMidia: 'bing / cpc', sessoes: 5, eventosChave: 0 },
  { pagina: '/contato/', origemMidia: 'google / organic', sessoes: 5, eventosChave: 1 },
  { pagina: '/zero/', origemMidia: 'google / organic', sessoes: 0, eventosChave: 0 },
]

describe('agruparPorCanal', () => {
  it('soma por canal, ordena e guarda os valores brutos', () => {
    const g = agruparPorCanal(linhas)
    expect(g.map((c) => [c.canal, c.sessoes])).toEqual([['pago', 85], ['direto', 10], ['organico', 5]])
    expect(g[0].participacao).toBeCloseTo(0.85)
    expect(g[0].eventosChave).toBe(3)
    expect(g[0].origens).toEqual([
      { origemMidia: 'google / cpc', sessoes: 80, eventosChave: 3 },
      { origemMidia: 'bing / cpc', sessoes: 5, eventosChave: 0 },
    ])
  })

  it('sem linhas, sem canais (e sem divisão por zero)', () => {
    expect(agruparPorCanal([])).toEqual([])
  })
})

describe('topPaginas', () => {
  it('soma as origens de cada página e aponta o canal principal', () => {
    const t = topPaginas(linhas, 2)
    expect(t.map((p) => [p.pagina, p.sessoes, p.canalPrincipal])).toEqual([['/', 70, 'pago'], ['/pericia/', 25, 'pago']])
    expect(t[0].participacaoCanalPrincipal).toBeCloseTo(60 / 70)
    expect(t[0].participacao).toBeCloseTo(0.7)
  })

  it('página sem sessão fica de fora', () => {
    expect(topPaginas(linhas).map((p) => p.pagina)).not.toContain('/zero/')
  })
})
