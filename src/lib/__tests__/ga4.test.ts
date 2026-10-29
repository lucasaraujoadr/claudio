import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buscarGa4,
  executarGa4,
  gravarGa4Diario,
  gravarGa4Paginas,
  type ClienteGa4,
  type PedidoGa4,
  type ResultadoGa4,
} from '@/lib/ga4'
import {
  classificarErro,
  executarCronDiario,
  type RegistroSincronizacao,
} from '@/lib/cron-diario'

afterEach(() => vi.restoreAllMocks())

const HOJE = new Date('2026-10-29T06:00:00Z')
const linha = (dims: string[], mets: number[]) => ({
  dimensionValues: dims.map((value) => ({ value })),
  metricValues: mets.map((m) => ({ value: String(m) })),
})

describe('buscarGa4', () => {
  it('mapeia linhas diárias e de páginas, com datas ISO e janelas corretas', async () => {
    const pedidos: PedidoGa4[] = []
    const cliente: ClienteGa4 = async (p) => {
      pedidos.push(p)
      return p.requestBody.dimensions[0].name === 'date'
        ? { rows: [linha(['20261028'], [10, 8, 6, 2])] }
        : { rows: [linha(['/a?x=1', 'google / organic'], [5, 4, 0, 1])] }
    }
    const r = await buscarGa4({ propertyId: '123', hoje: HOJE }, cliente)
    expect(r.diario).toEqual([{ data: '2026-10-28', sessoes: 10, usuarios: 8, sessoesEngajadas: 6, eventosChave: 2 }])
    expect(r.paginas).toEqual([{ pagina: '/a?x=1', origemMidia: 'google / organic', sessoes: 5, usuarios: 4, eventosChave: 1 }])
    expect(r.snapshotDate).toBe('2026-10-29')
    expect(pedidos[0].property).toBe('properties/123')
    expect(pedidos[0].requestBody.dateRanges[0]).toEqual({ startDate: '2026-07-31', endDate: '2026-10-28' })
    expect(pedidos[1].requestBody.dateRanges[0]).toEqual({ startDate: '2026-10-01', endDate: '2026-10-28' })
    expect(pedidos[1].requestBody.dimensions.map((d) => d.name)).toEqual([
      'landingPagePlusQueryString',
      'sessionSourceMedium',
    ])
    expect(pedidos[0].requestBody.metrics.map((m) => m.name)).toEqual([
      'sessions', 'activeUsers', 'engagedSessions', 'keyEvents',
    ])
  })

  it('pagina por offset/limit e limita a 1000 linhas de páginas', async () => {
    const offsets: string[] = []
    const cliente: ClienteGa4 = async (p) => {
      if (p.requestBody.dimensions[0].name === 'date') return { rows: [] }
      offsets.push(`${p.requestBody.offset}/${p.requestBody.limit}`)
      const n = Number(p.requestBody.limit)
      return { rows: Array.from({ length: n }, (_, i) => linha([`/p${p.requestBody.offset}-${i}`, 'x'], [1, 1, 1, 0])) }
    }
    const r = await buscarGa4({ propertyId: '1', hoje: HOJE }, cliente)
    expect(r.paginas).toHaveLength(1000)
    expect(offsets).toEqual(['0/500', '500/500'])
  })

  it('para quando a última página vem incompleta', async () => {
    let chamadas = 0
    const cliente: ClienteGa4 = async (p) => {
      if (p.requestBody.dimensions[0].name === 'date') return { rows: [] }
      chamadas++
      return { rows: [linha(['/a', 'x'], [1, 1, 1, 0])] }
    }
    await buscarGa4({ propertyId: '1', hoje: HOJE }, cliente)
    expect(chamadas).toBe(1)
  })
})

describe('gravação idempotente', () => {
  function falsoDb() {
    const chamadas: { values: unknown[]; conflito: unknown }[] = []
    const exec = {
      insert: () => ({
        values: (v: unknown[]) => ({
          onConflictDoUpdate: async (c: unknown) => {
            chamadas.push({ values: v, conflito: c })
          },
        }),
      }),
    }
    return { exec: exec as never, chamadas }
  }
  it('diário usa upsert por data e deduplica a mesma data', async () => {
    const { exec, chamadas } = falsoDb()
    const d = { sessoes: 1, usuarios: 1, sessoesEngajadas: 1, eventosChave: 0 }
    await gravarGa4Diario([{ data: '2026-10-01', ...d }, { data: '2026-10-01', ...d, sessoes: 9 }], exec)
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0].values).toHaveLength(1)
    expect((chamadas[0].values[0] as { sessoes: number }).sessoes).toBe(9)
    expect(chamadas[0].conflito).toHaveProperty('target')
  })
  it('páginas usa upsert e deduplica (página, origem)', async () => {
    const { exec, chamadas } = falsoDb()
    const l = { pagina: '/a', origemMidia: 'x', sessoes: 1, usuarios: 1, eventosChave: 0 }
    await gravarGa4Paginas([l, l, { ...l, origemMidia: 'y' }], '2026-10-29', exec)
    expect(chamadas[0].values).toHaveLength(2)
    expect(chamadas[0].values[0]).toMatchObject({ snapshotDate: '2026-10-29' })
  })
  it('executarGa4 busca fora da transação e grava dentro dela', async () => {
    const ordem: string[] = []
    const res: ResultadoGa4 = { snapshotDate: '2026-10-29', diario: [], paginas: [] }
    const r = await executarGa4({
      hoje: HOJE,
      propertyId: '1',
      buscar: async () => {
        ordem.push('busca')
        return res
      },
      transacao: async (fn) => {
        ordem.push('tx')
        return fn({ diario: async () => void ordem.push('d'), paginas: async () => void ordem.push('p') })
      },
    })
    expect(ordem).toEqual(['busca', 'tx', 'd', 'p'])
    expect(r).toEqual({ snapshotDate: '2026-10-29', dias: 0, paginas: 0 })
  })
})

describe('classificarErro', () => {
  it('403 de permissão vira sem_permissao com frase fixa e sem eco do erro', () => {
    const e = Object.assign(new Error('User does not have sufficient permissions for properties/1 secret-xyz'), {
      code: 403,
      name: 'GaxiosError',
    })
    const r = classificarErro(e)
    expect(r).toEqual({
      status: 'sem_permissao',
      erro: 'GaxiosError',
      mensagem: 'a conta de serviço ainda não tem acesso a esta propriedade',
    })
    expect(JSON.stringify(r)).not.toContain('secret-xyz')
  })
  it('outros erros viram erro genérico só com o nome da classe', () => {
    const r = classificarErro(Object.assign(new TypeError('private key BEGIN'), { code: 500 }))
    expect(r.status).toBe('erro')
    expect(r.erro).toBe('TypeError')
    expect(JSON.stringify(r)).not.toContain('BEGIN')
  })
  it('403 que não é de permissão continua erro', () => {
    expect(classificarErro(Object.assign(new Error('quota exceeded'), { code: 403 })).status).toBe('erro')
  })
})

describe('executarCronDiario', () => {
  const ok = async () => ({ linhas: 3 })
  function registrador() {
    const regs: RegistroSincronizacao[] = []
    return { regs, registrar: async (r: RegistroSincronizacao) => void regs.push(r) }
  }
  it('GA4 não configurado não impede o GSC', async () => {
    const { regs, registrar } = registrador()
    const r = await executarCronDiario({ hoje: HOJE, gsc: ok, ga4: null, registrar })
    expect(r.gsc).toMatchObject({ status: 'ok', linhas: 3 })
    expect(r.ga4.status).toBe('nao_configurado')
    expect(regs.map((x) => [x.fonte, x.status])).toEqual([['gsc', 'ok'], ['ga4', 'nao_configurado']])
  })
  it('GSC não configurado não impede o GA4', async () => {
    const { registrar } = registrador()
    const r = await executarCronDiario({ hoje: HOJE, gsc: null, ga4: ok, registrar })
    expect(r.gsc.status).toBe('nao_configurado')
    expect(r.ga4.status).toBe('ok')
  })
  it('falha do GSC (403) não impede o GA4 e é registrada', async () => {
    const { regs, registrar } = registrador()
    const falha = async (): Promise<never> => {
      throw Object.assign(new Error('The caller does not have permission'), { code: 403 })
    }
    const r = await executarCronDiario({ hoje: HOJE, gsc: falha, ga4: ok, registrar })
    expect(r.gsc.status).toBe('sem_permissao')
    expect(r.ga4.status).toBe('ok')
    expect(regs[0]).toMatchObject({ fonte: 'gsc', status: 'sem_permissao', linhas: null, executadoEm: HOJE })
    expect(regs[0].mensagem).toContain('conta de serviço')
    expect(regs[1]).toMatchObject({ fonte: 'ga4', status: 'ok', linhas: 3 })
  })
  it('falha do GA4 não impede o GSC; falha ao registrar não propaga', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const falha = async (): Promise<never> => {
      throw new Error('boom')
    }
    const r = await executarCronDiario({
      hoje: HOJE,
      gsc: ok,
      ga4: falha,
      registrar: async () => {
        throw new Error('db fora')
      },
    })
    expect(r.gsc.status).toBe('ok')
    expect(r.ga4).toMatchObject({ status: 'erro', erro: 'Error' })
  })
})
