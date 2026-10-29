import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buscarGa4,
  executarGa4,
  gravarGa4Diario,
  gravarGa4Paginas,
  gravarGa4Totais,
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
      if (p.requestBody.dimensions.length === 0) {
        return { rows: [linha(['date_range_1'], [70, 90, 50, 0]), linha(['date_range_0'], [60, 80, 40, 3])] }
      }
      return p.requestBody.dimensions[0]?.name === 'date'
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
    // Totais deduplicados: sem dimensões, duas janelas de 28 dias.
    expect(pedidos[2].requestBody.dimensions).toEqual([])
    expect(pedidos[2].requestBody.dateRanges).toEqual([
      { startDate: '2026-10-01', endDate: '2026-10-28' },
      { startDate: '2026-09-03', endDate: '2026-09-30' },
    ])
    expect(pedidos[2].requestBody.metrics.map((m) => m.name)).toEqual(['activeUsers', 'sessions', 'engagedSessions', 'keyEvents'])
    // Casa cada linha pela janela (date_range_N), não pela ordem de chegada.
    expect(r.totais).toEqual({
      inicioAtual: '2026-10-01',
      fimAtual: '2026-10-28',
      inicioAnterior: '2026-09-03',
      fimAnterior: '2026-09-30',
      usuariosAtual: 60,
      usuariosAnterior: 70,
      sessoesAtual: 80,
      sessoesAnterior: 90,
      sessoesEngajadasAtual: 40,
      sessoesEngajadasAnterior: 50,
      eventosChaveAtual: 3,
      eventosChaveAnterior: 0,
    })
  })

  it('janela sem linha nos totais vira zeros (nenhuma atividade), sem lançar', async () => {
    const cliente: ClienteGa4 = async (p) =>
      p.requestBody.dimensions.length === 0 ? { rows: [linha(['date_range_0'], [5, 6, 2, 0])] } : { rows: [] }
    const r = await buscarGa4({ propertyId: '1', hoje: HOJE }, cliente)
    expect(r.totais.usuariosAtual).toBe(5)
    expect(r.totais.usuariosAnterior).toBe(0)
    expect(r.totais.sessoesAnterior).toBe(0)
  })

  it('pagina por offset/limit e limita a 1000 linhas de páginas', async () => {
    const offsets: string[] = []
    const cliente: ClienteGa4 = async (p) => {
      if (p.requestBody.dimensions.length === 0 || p.requestBody.dimensions[0]?.name === 'date') return { rows: [] }
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
      if (p.requestBody.dimensions.length === 0 || p.requestBody.dimensions[0]?.name === 'date') return { rows: [] }
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
  it('totais usa upsert por snapshot_date', async () => {
    const { exec, chamadas } = falsoDb()
    const t = {
      inicioAtual: '2026-10-01', fimAtual: '2026-10-28', inicioAnterior: '2026-09-03', fimAnterior: '2026-09-30',
      usuariosAtual: 9, usuariosAnterior: 7, sessoesAtual: 1, sessoesAnterior: 1,
      sessoesEngajadasAtual: 1, sessoesEngajadasAnterior: 1, eventosChaveAtual: 0, eventosChaveAnterior: 0,
    }
    await gravarGa4Totais(t, '2026-10-29', exec)
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0].values).toMatchObject({ snapshotDate: '2026-10-29', usuariosAtual: 9 })
    expect(chamadas[0].conflito).toHaveProperty('target')
  })
  it('executarGa4 busca fora da transação e grava dentro dela', async () => {
    const ordem: string[] = []
    const totais = {
      inicioAtual: '2026-10-01', fimAtual: '2026-10-28', inicioAnterior: '2026-09-03', fimAnterior: '2026-09-30',
      usuariosAtual: 1, usuariosAnterior: 1, sessoesAtual: 1, sessoesAnterior: 1,
      sessoesEngajadasAtual: 1, sessoesEngajadasAnterior: 1, eventosChaveAtual: 0, eventosChaveAnterior: 0,
    }
    const res: ResultadoGa4 = { snapshotDate: '2026-10-29', diario: [], paginas: [], totais }
    const r = await executarGa4({
      hoje: HOJE,
      propertyId: '1',
      buscar: async () => {
        ordem.push('busca')
        return res
      },
      transacao: async (fn) => {
        ordem.push('tx')
        return fn({
          diario: async () => void ordem.push('d'),
          paginas: async () => void ordem.push('p'),
          totais: async (t, d) => void ordem.push(`t:${d}:${t.usuariosAtual}`),
          limpar: async (c) => {
            ordem.push(`l:${c}`)
            return 0
          },
        })
      },
    })
    expect(ordem).toEqual(['busca', 'tx', 'd', 'p', 't:2026-10-29:1', 'l:2026-07-31'])
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
  it.each([
    ['status', { status: 403 }],
    ['response.status', { response: { status: 403 } }],
    ['code string', { code: '403' }],
  ])('reconhece 403 por %s', (_n, extra) => {
    const e = Object.assign(new Error('The caller does not have permission'), extra)
    expect(classificarErro(e).status).toBe('sem_permissao')
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
    expect(regs.map((x) => [x.fonte, x.status]).sort()).toEqual([['ga4', 'nao_configurado'], ['gsc', 'ok']])
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
    const porFonte = Object.fromEntries(regs.map((x) => [x.fonte, x]))
    expect(porFonte.gsc).toMatchObject({ fonte: 'gsc', status: 'sem_permissao', linhas: null, executadoEm: HOJE })
    expect(porFonte.gsc.mensagem).toContain('conta de serviço')
    expect(porFonte.ga4).toMatchObject({ fonte: 'ga4', status: 'ok', linhas: 3 })
  })
  it('roda as fontes em paralelo: GSC pendurado não bloqueia o GA4', async () => {
    const { regs, registrar } = registrador()
    let soltar: () => void = () => {}
    const preso = new Promise<{ linhas: number }>((res) => (soltar = () => res({ linhas: 1 })))
    const p = executarCronDiario({ hoje: HOJE, gsc: () => preso, ga4: ok, registrar })
    await new Promise((r) => setTimeout(r, 10))
    expect(regs.map((x) => x.fonte)).toEqual(['ga4'])
    soltar()
    const r = await p
    expect(r.gsc.status).toBe('ok')
    expect(Object.keys(r)).toEqual(['gsc', 'ga4'])
  })
  it('registra no log do servidor o nome e a mensagem, mas não os devolve', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { regs, registrar } = registrador()
    const r = await executarCronDiario({
      hoje: HOJE,
      gsc: null,
      ga4: async () => {
        throw new TypeError('detalhe-interno')
      },
      registrar,
    })
    expect(String(log.mock.calls[0].join(' '))).toContain('ga4')
    expect(String(log.mock.calls[0].join(' '))).toContain('TypeError')
    expect(JSON.stringify(r)).not.toContain('detalhe-interno')
    expect(JSON.stringify(regs)).not.toContain('detalhe-interno')
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
