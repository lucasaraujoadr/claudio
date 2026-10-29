import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { auditIssues, auditPages, auditRuns, gscSnapshots, topics } from '@/lib/db/schema'
import { SERVICOS, type ContextoTemas } from './temas'

const MAX_TERMOS_GSC = 50
const MAX_LACUNAS = 30

export async function carregarContexto(): Promise<ContextoTemas> {
  const db = getDb()

  const [ultimo] = await db
    .select({ data: gscSnapshots.snapshotDate })
    .from(gscSnapshots)
    .orderBy(desc(gscSnapshots.snapshotDate))
    .limit(1)
  const impressoes = sql<number>`sum(${gscSnapshots.impressions})`
  const termos = ultimo
    ? await db
        .select({ query: gscSnapshots.query })
        .from(gscSnapshots)
        .where(eq(gscSnapshots.snapshotDate, ultimo.data))
        .groupBy(gscSnapshots.query)
        .orderBy(desc(impressoes))
        .limit(MAX_TERMOS_GSC)
    : []

  const existentes = await db.select({ keyword: topics.keyword }).from(topics)

  const [rodada] = await db
    .select({ id: auditRuns.id })
    .from(auditRuns)
    .where(eq(auditRuns.status, 'concluido'))
    .orderBy(desc(auditRuns.id))
    .limit(1)
  const lacunas = rodada
    ? await db
        .selectDistinct({ url: auditPages.url })
        .from(auditIssues)
        .innerJoin(auditPages, eq(auditIssues.pageId, auditPages.id))
        .where(and(eq(auditIssues.runId, rodada.id), inArray(auditIssues.regra, ['conteudo-raso', 'schema-ausente'])))
        .orderBy(auditPages.url)
        .limit(MAX_LACUNAS)
    : []

  return {
    servicos: SERVICOS,
    termosGsc: termos.map((t) => t.query),
    temasExistentes: existentes.map((t) => t.keyword),
    lacunasAuditoria: lacunas.map((l) => l.url),
  }
}
