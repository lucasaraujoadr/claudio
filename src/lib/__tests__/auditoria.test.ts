import { describe, expect, it } from 'vitest'
import { MINUTOS_ATE_RUN_TRAVADA, runTravada } from '../auditoria'

const agora = new Date('2026-10-29T12:00:00Z')
const minutosAtras = (m: number) => new Date(agora.getTime() - m * 60_000)

describe('runTravada', () => {
  it('o limite é de 15 minutos', () => {
    expect(MINUTOS_ATE_RUN_TRAVADA).toBe(15)
  })
  it('run rodando há mais de 15 minutos está travada', () => {
    expect(runTravada({ status: 'rodando', iniciadoEm: minutosAtras(16) }, agora)).toBe(true)
  })
  it('run rodando há menos de 15 minutos ainda está em andamento', () => {
    expect(runTravada({ status: 'rodando', iniciadoEm: minutosAtras(14) }, agora)).toBe(false)
  })
  it('exatamente 15 minutos ainda não é travada (o SQL da rota usa <)', () => {
    expect(runTravada({ status: 'rodando', iniciadoEm: minutosAtras(15) }, agora)).toBe(false)
  })
  it('run concluída ou que falhou nunca está travada', () => {
    expect(runTravada({ status: 'concluido', iniciadoEm: minutosAtras(600) }, agora)).toBe(false)
    expect(runTravada({ status: 'falhou', iniciadoEm: minutosAtras(600) }, agora)).toBe(false)
  })
})
