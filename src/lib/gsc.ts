import { and, lt, sql } from 'drizzle-orm'
import { google } from 'googleapis'
import { getDb } from '@/lib/db'
import { gscSnapshots } from '@/lib/db/schema'

export type LinhaGsc = {
  query: string
  page: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

const ROW_LIMIT = 25000
const TAMANHO_LOTE = 500
const MAX_LINHAS = 100000
const DIA_MS = 24 * 60 * 60 * 1000

/** Campos da resposta de searchanalytics.query que usamos. */
type LinhaApi = {
  keys?: string[] | null
  clicks?: number | null
  impressions?: number | null
  ctr?: number | null
  position?: number | null
}
export type PedidoGsc = {
  siteUrl: string
  requestBody: {
    startDate: string
    endDate: string
    dimensions: string[]
    rowLimit: number
    startRow: number
  }
}
export type ClienteGsc = (pedido: PedidoGsc) => Promise<{ rows?: LinhaApi[] | null }>

/** O painel da Vercel guarda a chave com `\n` literal e, às vezes, entre aspas. */
export function normalizarChavePrivada(bruta: string): string {
  let chave = bruta.trim()
  if (chave.length >= 2) {
    const a = chave[0]
    if ((a === '"' || a === "'") && chave[chave.length - 1] === a) chave = chave.slice(1, -1)
  }
  return chave.replace(/\\n/g, '\n')
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Aritmética em UTC: independe do fuso da máquina. */
function meiaNoiteUtc(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export function janelas(hoje: Date): {
  atual: { inicio: string; fim: string }
  anterior: { inicio: string; fim: string }
} {
  const base = meiaNoiteUtc(hoje)
  const fimAtual = base - 3 * DIA_MS
  const inicioAtual = fimAtual - 27 * DIA_MS
  const fimAnterior = inicioAtual - DIA_MS
  const inicioAnterior = fimAnterior - 27 * DIA_MS
  return {
    atual: { inicio: iso(inicioAtual), fim: iso(fimAtual) },
    anterior: { inicio: iso(inicioAnterior), fim: iso(fimAnterior) },
  }
}

export function sqlRetencao(hoje: Date): { corte: string } {
  return { corte: iso(meiaNoiteUtc(hoje) - 90 * DIA_MS) }
}

/** Espelha o SQL da retenção: antes do corte e fora de segunda-feira. */
export function apagaPorRetencao(data: string, corte: string): boolean {
  if (!(data < corte)) return false
  return new Date(`${data}T00:00:00Z`).getUTCDay() !== 1
}

function clienteReal(): ClienteGsc {
  const email = process.env.GOOGLE_SA_EMAIL
  const chave = process.env.GOOGLE_SA_PRIVATE_KEY
  if (!email || !chave) throw new Error('Credenciais do Google não configuradas')
  const auth = new google.auth.JWT({
    email,
    key: normalizarChavePrivada(chave),
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  })
  const sc = google.searchconsole({ version: 'v1', auth })
  return async (pedido) => {
    const r = await sc.searchanalytics.query(pedido)
    return { rows: r.data.rows }
  }
}

export async function buscarSearchAnalytics(
  o: { property: string; inicio: string; fim: string },
  cliente?: ClienteGsc,
): Promise<LinhaGsc[]> {
  const consultar = cliente ?? clienteReal()
  const linhas: LinhaGsc[] = []
  for (let startRow = 0; ; startRow += ROW_LIMIT) {
    const r = await consultar({
      siteUrl: o.property,
      requestBody: {
        startDate: o.inicio,
        endDate: o.fim,
        dimensions: ['query', 'page'],
        rowLimit: ROW_LIMIT,
        startRow,
      },
    })
    const rows = r.rows ?? []
    for (const l of rows) {
      linhas.push({
        query: l.keys?.[0] ?? '',
        page: l.keys?.[1] ?? '',
        clicks: l.clicks ?? 0,
        impressions: l.impressions ?? 0,
        ctr: l.ctr ?? 0,
        position: l.position ?? 0,
      })
    }
    if (rows.length < ROW_LIMIT || linhas.length >= MAX_LINHAS) return linhas
  }
}

export type ResultadoCron = {
  snapshotDate: string
  linhasGravadas: number
  linhasRemovidasRetencao: number
  anterior: { clicks: number; impressions: number }
}

export async function executarCronGsc(d: {
  hoje: Date
  property: string
  buscar: (o: { property: string; inicio: string; fim: string }) => Promise<LinhaGsc[]>
  gravar: (lote: LinhaGsc[], snapshotDate: string) => Promise<void>
  reter: (corte: string) => Promise<number>
}): Promise<ResultadoCron> {
  const { atual, anterior } = janelas(d.hoje)
  const snapshotDate = iso(meiaNoiteUtc(d.hoje))
  const linhasAtual = await d.buscar({ property: d.property, ...atual })
  const linhasAnterior = await d.buscar({ property: d.property, ...anterior })
  for (let i = 0; i < linhasAtual.length; i += TAMANHO_LOTE) {
    await d.gravar(linhasAtual.slice(i, i + TAMANHO_LOTE), snapshotDate)
  }
  const removidas = await d.reter(sqlRetencao(d.hoje).corte)
  return {
    snapshotDate,
    linhasGravadas: linhasAtual.length,
    linhasRemovidasRetencao: removidas,
    anterior: {
      clicks: linhasAnterior.reduce((s, l) => s + l.clicks, 0),
      impressions: linhasAnterior.reduce((s, l) => s + l.impressions, 0),
    },
  }
}

export async function gravarSnapshots(lote: LinhaGsc[], snapshotDate: string): Promise<void> {
  // Par repetido no mesmo INSERT faz o Postgres falhar; vale a última ocorrência.
  const unicas = [...new Map(lote.map((l) => [JSON.stringify([l.query, l.page]), l])).values()]
  if (unicas.length === 0) return
  await getDb()
    .insert(gscSnapshots)
    .values(unicas.map((l) => ({ ...l, snapshotDate })))
    .onConflictDoUpdate({
      target: [gscSnapshots.snapshotDate, gscSnapshots.query, gscSnapshots.page],
      set: {
        clicks: sql`excluded.clicks`,
        impressions: sql`excluded.impressions`,
        ctr: sql`excluded.ctr`,
        position: sql`excluded.position`,
      },
    })
}

export async function removerSnapshotsAntigos(corte: string): Promise<number> {
  const apagadas = await getDb()
    .delete(gscSnapshots)
    .where(and(lt(gscSnapshots.snapshotDate, corte), sql`extract(dow from ${gscSnapshots.snapshotDate}) <> 1`))
    .returning({ id: gscSnapshots.id })
  return apagadas.length
}
