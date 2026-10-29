import { and, lt, sql } from 'drizzle-orm'
import { google } from 'googleapis'
import { getDb } from '@/lib/db'
import { gscSnapshots, gscTotais } from '@/lib/db/schema'
import { iso, janelas, meiaNoiteUtc } from './janelas-gsc'

export { janelas }

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
/** Teto por chamada à API do Search Console (como em `ga4.ts`): sem ele, uma conexão presa segura a rotina diária. */
const TIMEOUT_MS = 60_000

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
    const r = await sc.searchanalytics.query(pedido, { timeout: TIMEOUT_MS })
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
  atual: { clicks: number; impressions: number }
  anterior: { clicks: number; impressions: number }
}

export type TotaisGsc = typeof gscTotais.$inferInsert

/** O que o cron escreve. Tudo dentro de uma transação: ou o snapshot entra inteiro, ou nada. */
export type EscritaCron = {
  gravar: (lote: LinhaGsc[], snapshotDate: string) => Promise<void>
  reter: (corte: string) => Promise<number>
  gravarTotais: (totais: TotaisGsc) => Promise<void>
}
export type TransacaoCron = <T>(fn: (escrita: EscritaCron) => Promise<T>) => Promise<T>

function somar(linhas: LinhaGsc[]): { clicks: number; impressions: number } {
  return {
    clicks: linhas.reduce((s, l) => s + l.clicks, 0),
    impressions: linhas.reduce((s, l) => s + l.impressions, 0),
  }
}

export async function executarCronGsc(d: {
  hoje: Date
  property: string
  buscar: (o: { property: string; inicio: string; fim: string }) => Promise<LinhaGsc[]>
  transacao: TransacaoCron
}): Promise<ResultadoCron> {
  const { atual, anterior } = janelas(d.hoje)
  const snapshotDate = iso(meiaNoiteUtc(d.hoje))
  // As chamadas ao Google ficam fora da transação: ela não fica aberta esperando a rede.
  const linhasAtual = await d.buscar({ property: d.property, ...atual })
  const linhasAnterior = await d.buscar({ property: d.property, ...anterior })
  const totalAtual = somar(linhasAtual)
  const totalAnterior = somar(linhasAnterior)

  const removidas = await d.transacao(async (e) => {
    for (let i = 0; i < linhasAtual.length; i += TAMANHO_LOTE) {
      await e.gravar(linhasAtual.slice(i, i + TAMANHO_LOTE), snapshotDate)
    }
    const n = await e.reter(sqlRetencao(d.hoje).corte)
    await e.gravarTotais({
      snapshotDate,
      clicksAtual: totalAtual.clicks,
      impressionsAtual: totalAtual.impressions,
      clicksAnterior: totalAnterior.clicks,
      impressionsAnterior: totalAnterior.impressions,
    })
    return n
  })
  return {
    snapshotDate,
    linhasGravadas: linhasAtual.length,
    linhasRemovidasRetencao: removidas,
    atual: totalAtual,
    anterior: totalAnterior,
  }
}

type Db = ReturnType<typeof getDb>
/** O banco ou uma transação aberta nele. */
type Executor = Pick<Db, 'insert' | 'delete'>

/** Transação real: snapshots, retenção e totais com commit único. */
export const transacaoGsc: TransacaoCron = (fn) =>
  getDb().transaction((tx) =>
    fn({
      gravar: (lote, data) => gravarSnapshots(lote, data, tx),
      reter: (corte) => removerSnapshotsAntigos(corte, tx),
      gravarTotais: (totais) => gravarTotais(totais, tx),
    }),
  )

export async function gravarTotais(totais: TotaisGsc, exec: Executor = getDb()): Promise<void> {
  await exec
    .insert(gscTotais)
    .values(totais)
    .onConflictDoUpdate({
      target: gscTotais.snapshotDate,
      set: {
        clicksAtual: totais.clicksAtual,
        impressionsAtual: totais.impressionsAtual,
        clicksAnterior: totais.clicksAnterior,
        impressionsAnterior: totais.impressionsAnterior,
      },
    })
}

export async function gravarSnapshots(
  lote: LinhaGsc[],
  snapshotDate: string,
  exec: Executor = getDb(),
): Promise<void> {
  // Par repetido no mesmo INSERT faz o Postgres falhar; vale a última ocorrência.
  const unicas = [...new Map(lote.map((l) => [JSON.stringify([l.query, l.page]), l])).values()]
  if (unicas.length === 0) return
  await exec
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

export async function removerSnapshotsAntigos(corte: string, exec: Executor = getDb()): Promise<number> {
  const apagadas = await exec
    .delete(gscSnapshots)
    .where(and(lt(gscSnapshots.snapshotDate, corte), sql`extract(dow from ${gscSnapshots.snapshotDate}) <> 1`))
    .returning({ id: gscSnapshots.id })
  return apagadas.length
}
