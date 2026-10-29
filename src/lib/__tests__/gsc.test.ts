import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as dbModulo from '@/lib/db'
import {
  buscarSearchAnalytics,
  executarCronGsc,
  gravarSnapshots,
  gravarTotais,
  type EscritaCron,
  type TotaisGsc,
  janelas,
  normalizarChavePrivada,
  apagaPorRetencao,
  sqlRetencao,
  type ClienteGsc,
  type LinhaGsc,
} from '@/lib/gsc'

const ORIGINAL = { ...process.env }
afterEach(() => {
  process.env = { ...ORIGINAL }
  vi.restoreAllMocks()
})

describe('normalizarChavePrivada', () => {
  // Review Focus 2
  it('converte \\n literal em quebra de linha real', () => {
    const r = normalizarChavePrivada('-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----')
    expect(r).toContain('\n')
    expect(r).not.toContain('\\n')
  })
  it('deixa intacta a chave que já tem quebras reais', () => {
    const k = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----'
    expect(normalizarChavePrivada(k)).toBe(k)
  })
  it('remove aspas envolventes que o painel adiciona', () => {
    expect(normalizarChavePrivada('"-----BEGIN-----\\nABC\\n-----END-----"')).toBe(
      '-----BEGIN-----\nABC\n-----END-----',
    )
    expect(normalizarChavePrivada("'abc'")).toBe('abc')
  })
})

describe('fuso da suíte', () => {
  it('roda com TZ atrás do UTC (guarda dos testes de UTC)', () => {
    expect(new Date('2026-10-28T00:30:00Z').getDate()).toBe(27)
  })
})

describe('janelas', () => {
  it('a janela atual termina 3 dias antes de hoje', () => {
    expect(janelas(new Date('2026-10-28')).atual.fim).toBe('2026-10-25')
  })
  it('a janela atual tem 28 dias', () => {
    expect(janelas(new Date('2026-10-28')).atual.inicio).toBe('2026-09-28')
  })
  it('a anterior é os 28 dias imediatamente antes, sem sobrepor', () => {
    const { atual, anterior } = janelas(new Date('2026-10-28'))
    expect(anterior.fim < atual.inicio).toBe(true)
    expect(anterior.fim).toBe('2026-09-27')
    expect(anterior.inicio).toBe('2026-08-31')
  })
  it('usa UTC: logo após a meia-noite UTC não depende do fuso da máquina', () => {
    // Em fuso local negativo (ex.: São Paulo) este instante ainda é 27/10.
    const { atual } = janelas(new Date('2026-10-28T00:30:00Z'))
    expect(atual.fim).toBe('2026-10-25')
  })
})

describe('sqlRetencao', () => {
  it('corte fica 90 dias antes de hoje', () => {
    expect(sqlRetencao(new Date('2026-10-28')).corte).toBe('2026-07-30')
  })
  it('usa UTC logo após a meia-noite', () => {
    expect(sqlRetencao(new Date('2026-10-28T00:10:00Z')).corte).toBe('2026-07-30')
  })
  it('segunda-feira anterior ao corte é preservada; outros dias são apagados', () => {
    const { corte } = sqlRetencao(new Date('2026-10-28'))
    const deveApagar = (d: string) => apagaPorRetencao(d, corte)
    expect(deveApagar('2026-07-27')).toBe(false) // segunda anterior ao corte
    expect(deveApagar('2026-07-28')).toBe(true) // terça
    expect(deveApagar('2026-07-26')).toBe(true) // domingo
  })
  it('não apaga nada dentro da janela de 90 dias', () => {
    const { corte } = sqlRetencao(new Date('2026-10-28'))
    const deveApagar = (d: string) => apagaPorRetencao(d, corte)
    expect(deveApagar('2026-07-30')).toBe(false)
    expect(deveApagar('2026-07-31')).toBe(false) // sexta, dentro
    expect(deveApagar('2026-10-28')).toBe(false)
  })
})

function linhaApi(i: number) {
  return { keys: [`q${i}`, `https://x/${i}`], clicks: 1, impressions: 10, ctr: 0.1, position: 3 }
}

describe('buscarSearchAnalytics', () => {
  it('mapeia as linhas da API e envia dimensões e datas', async () => {
    const cliente = vi.fn<ClienteGsc>().mockResolvedValue({ rows: [linhaApi(1)] })
    const r = await buscarSearchAnalytics(
      { property: 'sc-domain:x', inicio: '2026-09-28', fim: '2026-10-25' },
      cliente,
    )
    expect(r).toEqual([{ query: 'q1', page: 'https://x/1', clicks: 1, impressions: 10, ctr: 0.1, position: 3 }])
    expect(cliente).toHaveBeenCalledWith({
      siteUrl: 'sc-domain:x',
      requestBody: {
        startDate: '2026-09-28',
        endDate: '2026-10-25',
        dimensions: ['query', 'page'],
        rowLimit: 25000,
        startRow: 0,
      },
    })
  })
  it('resposta sem rows vira lista vazia', async () => {
    const cliente = vi.fn<ClienteGsc>().mockResolvedValue({})
    expect(await buscarSearchAnalytics({ property: 'p', inicio: 'a', fim: 'b' }, cliente)).toEqual([])
  })
  it('pagina com startRow quando a resposta vem cheia', async () => {
    const cheia = Array.from({ length: 25000 }, (_, i) => linhaApi(i))
    const cliente = vi
      .fn<ClienteGsc>()
      .mockResolvedValueOnce({ rows: cheia })
      .mockResolvedValueOnce({ rows: [linhaApi(99999)] })
    const r = await buscarSearchAnalytics({ property: 'p', inicio: 'a', fim: 'b' }, cliente)
    expect(r).toHaveLength(25001)
    expect(cliente).toHaveBeenCalledTimes(2)
    expect(cliente.mock.calls[1][0].requestBody.startRow).toBe(25000)
  })
  it('para em 100 000 linhas mesmo que a API continue devolvendo páginas cheias', async () => {
    const cheia = Array.from({ length: 25000 }, (_, i) => linhaApi(i))
    const cliente = vi.fn<ClienteGsc>().mockResolvedValue({ rows: cheia })
    const r = await buscarSearchAnalytics({ property: 'p', inicio: 'a', fim: 'b' }, cliente)
    expect(r).toHaveLength(100000)
    expect(cliente).toHaveBeenCalledTimes(4)
  })
})

/**
 * Transação falsa: as escritas ficam num rascunho e só passam ao "banco" se a função
 * terminar sem lançar — o mesmo contrato do db.transaction real.
 */
function transacaoFalsa(falhas: Partial<Record<keyof EscritaCron, (n: number) => boolean>> = {}) {
  type Estado = { lotes: Array<{ tamanho: number; data: string }>; cortes: string[]; totais: TotaisGsc[] }
  const banco: Estado = { lotes: [], cortes: [], totais: [] }
  let aberturas = 0
  const transacao = async <T,>(fn: (e: EscritaCron) => Promise<T>): Promise<T> => {
    aberturas++
    const rascunho: Estado = { lotes: [], cortes: [], totais: [] }
    const chamadas = { gravar: 0, reter: 0, gravarTotais: 0 }
    const r = await fn({
      gravar: async (lote, data) => {
        if (falhas.gravar?.(++chamadas.gravar)) throw new Error('conexão caiu')
        rascunho.lotes.push({ tamanho: lote.length, data })
      },
      reter: async (corte) => {
        if (falhas.reter?.(++chamadas.reter)) throw new Error('conexão caiu')
        rascunho.cortes.push(corte)
        return 7
      },
      gravarTotais: async (t) => {
        if (falhas.gravarTotais?.(++chamadas.gravarTotais)) throw new Error('conexão caiu')
        rascunho.totais.push(t)
      },
    })
    banco.lotes.push(...rascunho.lotes)
    banco.cortes.push(...rascunho.cortes)
    banco.totais.push(...rascunho.totais)
    return r
  }
  return { banco, transacao, aberturas: () => aberturas }
}

describe('executarCronGsc', () => {
  const hoje = new Date('2026-10-28T10:00:00Z')
  const linhas = (n: number, clicks = 2, impressions = 20): LinhaGsc[] =>
    Array.from({ length: n }, (_, i) => ({ query: `q${i}`, page: 'p', clicks, impressions, ctr: 0.1, position: 4 }))
  const buscarFalso = (atual: LinhaGsc[], anterior: LinhaGsc[]) =>
    vi
      .fn<(o: { property: string; inicio: string; fim: string }) => Promise<LinhaGsc[]>>()
      .mockResolvedValueOnce(atual)
      .mockResolvedValueOnce(anterior)

  it('grava a janela atual em lotes, aplica retenção e grava os totais, numa única transação', async () => {
    const buscar = buscarFalso(linhas(1200), linhas(3, 2, 20))
    const t = transacaoFalsa()
    const r = await executarCronGsc({ hoje, property: 'sc-domain:x', buscar, transacao: t.transacao })
    expect(buscar.mock.calls[0][0]).toMatchObject({ inicio: '2026-09-28', fim: '2026-10-25' })
    expect(buscar.mock.calls[1][0]).toMatchObject({ inicio: '2026-08-31', fim: '2026-09-27' })
    expect(t.aberturas()).toBe(1)
    expect(t.banco.lotes.map((l) => l.tamanho)).toEqual([500, 500, 200])
    expect(t.banco.lotes.every((l) => l.data === '2026-10-28')).toBe(true)
    expect(t.banco.cortes).toEqual(['2026-07-30'])
    expect(t.banco.totais).toEqual([
      { snapshotDate: '2026-10-28', clicksAtual: 2400, impressionsAtual: 24000, clicksAnterior: 6, impressionsAnterior: 60 },
    ])
    expect(r).toEqual({
      snapshotDate: '2026-10-28',
      linhasGravadas: 1200,
      linhasRemovidasRetencao: 7,
      atual: { clicks: 2400, impressions: 24000 },
      anterior: { clicks: 6, impressions: 60 },
    })
  })

  it('a busca ao Google acontece antes de abrir a transação', async () => {
    const t = transacaoFalsa()
    const buscar = vi.fn(async () => {
      expect(t.aberturas()).toBe(0)
      return linhas(1)
    })
    await executarCronGsc({ hoje, property: 'p', buscar, transacao: t.transacao })
    expect(buscar).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['no segundo lote de snapshots', { gravar: (n: number) => n === 2 }],
    ['na retenção', { reter: () => true }],
    ['nos totais', { gravarTotais: () => true }],
  ])('falha %s: nada é gravado e o erro propaga', async (_onde, falhas) => {
    const t = transacaoFalsa(falhas)
    await expect(
      executarCronGsc({ hoje, property: 'p', buscar: buscarFalso(linhas(1200), linhas(3)), transacao: t.transacao }),
    ).rejects.toThrow('conexão caiu')
    expect(t.banco).toEqual({ lotes: [], cortes: [], totais: [] })
  })
})

describe('gravarTotais', () => {
  it('faz upsert pela snapshot_date com os quatro totais', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate })
    const totais: TotaisGsc = { snapshotDate: '2026-10-28', clicksAtual: 1, impressionsAtual: 2, clicksAnterior: 3, impressionsAnterior: 4 }
    await gravarTotais(totais, { insert: () => ({ values }) } as never)
    expect(values).toHaveBeenCalledWith(totais)
    const { target, set } = onConflictDoUpdate.mock.calls[0][0]
    expect(target.name).toBe('snapshot_date')
    expect(Object.keys(set).sort()).toEqual(['clicksAnterior', 'clicksAtual', 'impressionsAnterior', 'impressionsAtual'])
  })
})

describe('gravarSnapshots', () => {
  it('deduplica (query, page) no lote mantendo a última ocorrência', async () => {
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) })
    vi.spyOn(dbModulo, 'getDb').mockReturnValue({ insert: () => ({ values }) } as never)
    const l = (query: string, page: string, clicks: number): LinhaGsc => ({
      query, page, clicks, impressions: 1, ctr: 0, position: 1,
    })
    await gravarSnapshots([l('a', 'p', 1), l('b', 'p', 2), l('a', 'p', 9)], '2026-10-28')
    const enviados = values.mock.calls[0][0] as Array<{ query: string; clicks: number }>
    expect(enviados).toHaveLength(2)
    expect(enviados.find((x) => x.query === 'a')?.clicks).toBe(9)
  })
})

describe('GET /api/cron/gsc', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/db', () => ({ getDb: () => ({}) }))
  })
  async function chamar(headers: Record<string, string>) {
    const { GET } = await import('@/app/api/cron/gsc/route')
    return GET(new Request('http://x/api/cron/gsc', { headers }) as never)
  }

  it('401 sem cabeçalho Authorization', async () => {
    process.env.CRON_SECRET = 's3'
    expect((await chamar({})).status).toBe(401)
  })
  it('401 com segredo errado', async () => {
    process.env.CRON_SECRET = 's3'
    expect((await chamar({ authorization: 'Bearer outro' })).status).toBe(401)
  })
  it('recusa tudo quando CRON_SECRET não está definido', async () => {
    delete process.env.CRON_SECRET
    expect((await chamar({ authorization: 'Bearer ' })).status).toBe(401)
    expect((await chamar({ authorization: 'Bearer undefined' })).status).toBe(401)
    expect((await chamar({})).status).toBe(401)
  })
  it('recusa tudo quando CRON_SECRET está vazio', async () => {
    process.env.CRON_SECRET = ''
    expect((await chamar({ authorization: 'Bearer ' })).status).toBe(401)
  })
  it('500 nomeando as variáveis do Google ausentes, sem vazar valores', async () => {
    process.env.CRON_SECRET = 's3'
    delete process.env.GOOGLE_SA_EMAIL
    process.env.GOOGLE_SA_PRIVATE_KEY = 'CHAVE-SECRETA-XYZ'
    delete process.env.GSC_PROPERTY
    const r = await chamar({ authorization: 'Bearer s3' })
    expect(r.status).toBe(500)
    const texto = await r.text()
    expect(texto).toContain('GOOGLE_SA_EMAIL')
    expect(texto).toContain('GSC_PROPERTY')
    expect(texto).not.toContain('GOOGLE_SA_PRIVATE_KEY')
    expect(texto).not.toContain('CHAVE-SECRETA-XYZ')
  })
})
