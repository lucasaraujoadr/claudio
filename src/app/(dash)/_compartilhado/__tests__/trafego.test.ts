import { describe, expect, it } from 'vitest'
import { datasEntre } from '@/components/graficos/serie'
import { faixaSincronizada, janelasComparacao, preencherDiasGa4, resumirTrafego, serieTrafego, type DiaGa4 } from '../trafego'

function dia(data: string, sessoes: number): DiaGa4 {
  return { data, sessoes, usuarios: sessoes, sessoesEngajadas: Math.floor(sessoes / 2), eventosChave: 0 }
}

/** Dias de `inicio` a `fim` com 10 sessões, menos os de `faltando`. */
function serie(inicio: string, fim: string, faltando: string[] = [], sessoes = 10): DiaGa4[] {
  return datasEntre(inicio, fim).filter((d) => !faltando.includes(d)).map((d) => dia(d, sessoes))
}

describe('janelasComparacao', () => {
  it('28 dias terminando no fim e os 28 imediatamente anteriores', () => {
    expect(janelasComparacao('2026-10-28')).toEqual({
      atual: { inicio: '2026-10-01', fim: '2026-10-28' },
      anterior: { inicio: '2026-09-03', fim: '2026-09-30' },
    })
  })
})

describe('faixaSincronizada', () => {
  it('vai do primeiro ao último dia gravado', () => {
    expect(faixaSincronizada(serie('2026-07-31', '2026-10-28'))).toEqual({ inicio: '2026-07-31', fim: '2026-10-28' })
  })

  it('estende até a véspera (UTC) da última sincronização bem-sucedida', () => {
    const f = faixaSincronizada(serie('2026-07-31', '2026-10-26'), new Date('2026-10-29T06:37:46Z'))
    expect(f).toEqual({ inicio: '2026-07-31', fim: '2026-10-28' })
  })

  it('sincronização antiga não encurta a faixa; sem dias, null', () => {
    expect(faixaSincronizada(serie('2026-10-01', '2026-10-28'), new Date('2026-10-10T06:00:00Z'))?.fim).toBe('2026-10-28')
    expect(faixaSincronizada([])).toBeNull()
  })
})

describe('preencherDiasGa4 (dia ausente: zero dentro da faixa, sem dado fora)', () => {
  it('dentro da faixa sincronizada, dia sem linha é 0 — o Analytics omite dias sem sessão', () => {
    const dias = serie('2026-10-01', '2026-10-05', ['2026-10-03'])
    const p = preencherDiasGa4(dias, 'sessoes', { inicio: '2026-10-01', fim: '2026-10-05' }, '2026-09-29', '2026-10-05')
    expect(p.map((x) => x.valor)).toEqual([null, null, 10, 10, 0, 10, 10])
  })
})

describe('resumirTrafego', () => {
  it('sem nenhum dia: null (estado sem dado, nunca zeros)', () => {
    expect(resumirTrafego([])).toBeNull()
  })

  it('soma os últimos 28 dias e compara com os 28 anteriores', () => {
    const dias = [...serie('2026-07-31', '2026-09-30', [], 5), ...serie('2026-10-01', '2026-10-28', [], 10)]
    const r = resumirTrafego(dias)!
    expect(r.atual).toEqual({ inicio: '2026-10-01', fim: '2026-10-28' })
    expect(r.totais.sessoes).toBe(280)
    expect(r.comparacao?.totais.sessoes).toBe(140)
    expect(r.comparacao?.variacoes.sessoes).toEqual({ delta: 140, percentual: 100 })
    expect(r.diasSemSessao).toBe(0)
  })

  it('dia faltando dentro da faixa conta como dia sem sessão (zero), não some', () => {
    const dias = serie('2026-07-31', '2026-10-28', ['2026-10-25'])
    const r = resumirTrafego(dias)!
    expect(r.totais.sessoes).toBe(270)
    expect(r.diasSemSessao).toBe(1)
  })

  it('não compara quando a faixa sincronizada não cobre toda a janela anterior', () => {
    const r = resumirTrafego(serie('2026-09-20', '2026-10-28'))!
    expect(r.comparacao).toBeNull()
    expect(r.totais.sessoes).toBe(280)
  })

  it('a janela termina na véspera da última sincronização ok, mesmo sem linha nesse dia', () => {
    const r = resumirTrafego(serie('2026-07-31', '2026-10-27'), new Date('2026-10-29T06:00:00Z'))!
    expect(r.ultimoDia).toBe('2026-10-28')
    expect(r.diasSemSessao).toBe(1)
    const s = serieTrafego(serie('2026-07-31', '2026-10-27'), 'sessoes', r)
    expect(s).toHaveLength(90)
    expect(s.at(-1)).toEqual({ data: '2026-10-28', valor: 0 })
  })

  it('a série de 90 dias marca como sem dado (null) o que é anterior à faixa', () => {
    const dias = serie('2026-10-01', '2026-10-28')
    const r = resumirTrafego(dias)!
    const s = serieTrafego(dias, 'sessoes', r)
    expect(s).toHaveLength(90)
    expect(s[0].valor).toBeNull()
    expect(s.filter((p) => p.valor === null)).toHaveLength(62)
  })
})
