import { lt, sql } from 'drizzle-orm'
import { google } from 'googleapis'
import { getDb } from '@/lib/db'
import { ga4Diario, ga4Paginas } from '@/lib/db/schema'
import { iso, meiaNoiteUtc } from './janelas-gsc'
import { normalizarChavePrivada } from './gsc'

const DIA_MS = 24 * 60 * 60 * 1000
const RETENCAO_DIAS = 90
const TIMEOUT_MS = 60_000
const DIAS_SERIE = 90
const DIAS_PAGINAS = 28
const MAX_PAGINAS = 1000
const TAMANHO_PAGINA = 500
const TAMANHO_LOTE = 500

// Nomes da Data API v1beta (os tipos do googleapis os deixam como string livre):
// dimensões `date`, `landingPagePlusQueryString`, `sessionSourceMedium`;
// métricas `sessions`, `activeUsers`, `engagedSessions`, `keyEvents`.
const METRICAS = ['sessions', 'activeUsers', 'engagedSessions', 'keyEvents']

export type LinhaDiariaGa4 = {
  data: string
  sessoes: number
  usuarios: number
  sessoesEngajadas: number
  eventosChave: number
}
export type LinhaPaginaGa4 = {
  pagina: string
  origemMidia: string
  sessoes: number
  usuarios: number
  eventosChave: number
}
export type ResultadoGa4 = {
  snapshotDate: string
  diario: LinhaDiariaGa4[]
  paginas: LinhaPaginaGa4[]
}

type LinhaApi = {
  dimensionValues?: { value?: string | null }[] | null
  metricValues?: { value?: string | null }[] | null
}
export type PedidoGa4 = {
  property: string
  requestBody: {
    dateRanges: { startDate: string; endDate: string }[]
    dimensions: { name: string }[]
    metrics: { name: string }[]
    orderBys?: { metric?: { metricName: string }; dimension?: { dimensionName: string }; desc?: boolean }[]
    limit: string
    offset: string
  }
}
export type ClienteGa4 = (pedido: PedidoGa4) => Promise<{ rows?: LinhaApi[] | null; rowCount?: number | null }>

function clienteReal(): ClienteGa4 {
  const email = process.env.GOOGLE_SA_EMAIL
  const chave = process.env.GOOGLE_SA_PRIVATE_KEY
  if (!email || !chave) throw new Error('Credenciais do Google não configuradas')
  const auth = new google.auth.JWT({
    email,
    key: normalizarChavePrivada(chave),
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  })
  const ga = google.analyticsdata({ version: 'v1beta', auth })
  return async (p) => {
    const r = await ga.properties.runReport(
      { property: p.property, requestBody: p.requestBody },
      { timeout: TIMEOUT_MS },
    )
    return { rows: r.data.rows, rowCount: r.data.rowCount }
  }
}

function num(v: string | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/** `20260115` -> `2026-01-15`; qualquer outra coisa passa intacta. */
function dataIso(v: string): string {
  return /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v
}

async function paginar(
  consultar: ClienteGa4,
  base: Omit<PedidoGa4['requestBody'], 'limit' | 'offset'>,
  property: string,
  maximo: number,
): Promise<LinhaApi[]> {
  const todas: LinhaApi[] = []
  while (todas.length < maximo) {
    const limite = Math.min(TAMANHO_PAGINA, maximo - todas.length)
    const r = await consultar({
      property,
      requestBody: { ...base, limit: String(limite), offset: String(todas.length) },
    })
    const rows = r.rows ?? []
    todas.push(...rows)
    if (rows.length < limite) break
    if (typeof r.rowCount === 'number' && todas.length >= r.rowCount) break
  }
  return todas
}

export async function buscarGa4(
  o: { propertyId: string; hoje: Date },
  cliente?: ClienteGa4,
): Promise<ResultadoGa4> {
  const consultar = cliente ?? clienteReal()
  const property = `properties/${o.propertyId}`
  const hoje = meiaNoiteUtc(o.hoje)
  const fim = iso(hoje - DIA_MS)
  const metrics = METRICAS.map((name) => ({ name }))

  const linhasDia = await paginar(
    consultar,
    {
      dateRanges: [{ startDate: iso(hoje - DIAS_SERIE * DIA_MS), endDate: fim }],
      dimensions: [{ name: 'date' }],
      metrics,
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    },
    property,
    DIAS_SERIE + 10,
  )
  const diario = linhasDia.map((l) => ({
    data: dataIso(l.dimensionValues?.[0]?.value ?? ''),
    sessoes: num(l.metricValues?.[0]?.value),
    usuarios: num(l.metricValues?.[1]?.value),
    sessoesEngajadas: num(l.metricValues?.[2]?.value),
    eventosChave: num(l.metricValues?.[3]?.value),
  }))

  const linhasPag = await paginar(
    consultar,
    {
      dateRanges: [{ startDate: iso(hoje - DIAS_PAGINAS * DIA_MS), endDate: fim }],
      dimensions: [{ name: 'landingPagePlusQueryString' }, { name: 'sessionSourceMedium' }],
      metrics,
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    },
    property,
    MAX_PAGINAS,
  )
  const paginas = linhasPag.map((l) => ({
    pagina: l.dimensionValues?.[0]?.value ?? '',
    origemMidia: l.dimensionValues?.[1]?.value ?? '',
    sessoes: num(l.metricValues?.[0]?.value),
    usuarios: num(l.metricValues?.[1]?.value),
    eventosChave: num(l.metricValues?.[3]?.value),
  }))
  return { snapshotDate: iso(hoje), diario, paginas }
}

type Db = ReturnType<typeof getDb>
type Executor = Pick<Db, 'insert' | 'delete'>

export async function gravarGa4Diario(linhas: LinhaDiariaGa4[], exec: Executor = getDb()): Promise<void> {
  const unicas = [...new Map(linhas.map((l) => [l.data, l])).values()]
  for (let i = 0; i < unicas.length; i += TAMANHO_LOTE) {
    await exec
      .insert(ga4Diario)
      .values(unicas.slice(i, i + TAMANHO_LOTE))
      .onConflictDoUpdate({
        target: ga4Diario.data,
        set: {
          sessoes: sql`excluded.sessoes`,
          usuarios: sql`excluded.usuarios`,
          sessoesEngajadas: sql`excluded.sessoes_engajadas`,
          eventosChave: sql`excluded.eventos_chave`,
        },
      })
  }
}

export async function gravarGa4Paginas(
  linhas: LinhaPaginaGa4[],
  snapshotDate: string,
  exec: Executor = getDb(),
): Promise<void> {
  const unicas = [...new Map(linhas.map((l) => [JSON.stringify([l.pagina, l.origemMidia]), l])).values()]
  for (let i = 0; i < unicas.length; i += TAMANHO_LOTE) {
    await exec
      .insert(ga4Paginas)
      .values(unicas.slice(i, i + TAMANHO_LOTE).map((l) => ({ ...l, snapshotDate })))
      .onConflictDoUpdate({
        target: [ga4Paginas.snapshotDate, ga4Paginas.pagina, ga4Paginas.origemMidia],
        set: {
          sessoes: sql`excluded.sessoes`,
          usuarios: sql`excluded.usuarios`,
          eventosChave: sql`excluded.eventos_chave`,
        },
      })
  }
}

export async function removerGa4PaginasAntigas(corte: string, exec: Executor = getDb()): Promise<number> {
  const apagadas = await exec
    .delete(ga4Paginas)
    .where(lt(ga4Paginas.snapshotDate, corte))
    .returning({ pagina: ga4Paginas.pagina })
  return apagadas.length
}

export type EscritaGa4 = {
  limpar: (corte: string) => Promise<number>
  diario: (l: LinhaDiariaGa4[]) => Promise<void>
  paginas: (l: LinhaPaginaGa4[], snapshotDate: string) => Promise<void>
}
export type TransacaoGa4 = <T>(fn: (e: EscritaGa4) => Promise<T>) => Promise<T>

export const transacaoGa4: TransacaoGa4 = (fn) =>
  getDb().transaction((tx) =>
    fn({
      diario: (l) => gravarGa4Diario(l, tx),
      paginas: (l, d) => gravarGa4Paginas(l, d, tx),
      limpar: (c) => removerGa4PaginasAntigas(c, tx),
    }),
  )

/** Busca fora da transação; grava série e páginas num único commit. */
export async function executarGa4(d: {
  hoje: Date
  propertyId: string
  buscar: (o: { propertyId: string; hoje: Date }) => Promise<ResultadoGa4>
  transacao: TransacaoGa4
}): Promise<{ snapshotDate: string; dias: number; paginas: number }> {
  const r = await d.buscar({ propertyId: d.propertyId, hoje: d.hoje })
  await d.transacao(async (e) => {
    await e.diario(r.diario)
    await e.paginas(r.paginas, r.snapshotDate)
    await e.limpar(iso(meiaNoiteUtc(d.hoje) - RETENCAO_DIAS * DIA_MS))
  })
  return { snapshotDate: r.snapshotDate, dias: r.diario.length, paginas: r.paginas.length }
}
