import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buscarSearchAnalytics,
  executarCronGsc,
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
  it('corte e segunda-feira: datas anteriores ao corte seguem a regra', () => {
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
})

describe('executarCronGsc', () => {
  const hoje = new Date('2026-10-28T10:00:00Z')
  const linhas = (n: number): LinhaGsc[] =>
    Array.from({ length: n }, (_, i) => ({ query: `q${i}`, page: 'p', clicks: 2, impressions: 20, ctr: 0.1, position: 4 }))

  it('grava a janela atual em lotes, aplica retenção e totaliza a anterior', async () => {
    const buscar = vi
      .fn<(o: { property: string; inicio: string; fim: string }) => Promise<LinhaGsc[]>>()
      .mockResolvedValueOnce(linhas(1200))
      .mockResolvedValueOnce(linhas(3))
    const gravar = vi.fn(async (_lote: LinhaGsc[], _data: string) => {})
    const reter = vi.fn(async (_corte: string) => 7)
    const r = await executarCronGsc({ hoje, property: 'sc-domain:x', buscar, gravar, reter })
    expect(buscar.mock.calls[0][0]).toMatchObject({ inicio: '2026-09-28', fim: '2026-10-25' })
    expect(buscar.mock.calls[1][0]).toMatchObject({ inicio: '2026-08-31', fim: '2026-09-27' })
    expect(gravar.mock.calls.map((c) => c[0].length)).toEqual([500, 500, 200])
    expect(gravar.mock.calls.every((c) => c[1] === '2026-10-28')).toBe(true)
    expect(reter).toHaveBeenCalledWith('2026-07-30')
    expect(r).toEqual({
      snapshotDate: '2026-10-28',
      linhasGravadas: 1200,
      linhasRemovidasRetencao: 7,
      anterior: { clicks: 6, impressions: 60 },
    })
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
