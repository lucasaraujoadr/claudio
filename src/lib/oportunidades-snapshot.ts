import { desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { gscSnapshots, topics } from '@/lib/db/schema'
import { classificarOportunidades, type OportunidadesClassificadas } from '@/lib/oportunidades'

export type OportunidadesDoSnapshot = OportunidadesClassificadas & { data: string }

/**
 * Oportunidades do snapshot mais recente, classificadas contra os temas existentes.
 * Null quando o Search Console nunca foi sincronizado. Usado por / e /oportunidades,
 * para que os dois números nunca divirjam.
 */
export async function carregarOportunidadesDoSnapshot(): Promise<OportunidadesDoSnapshot | null> {
  const db = getDb()
  const [ultimo] = await db
    .select({ data: gscSnapshots.snapshotDate })
    .from(gscSnapshots)
    .orderBy(desc(gscSnapshots.snapshotDate))
    .limit(1)
  if (!ultimo) return null
  const [linhas, temas] = await Promise.all([
    db.select().from(gscSnapshots).where(eq(gscSnapshots.snapshotDate, ultimo.data)),
    db.select({ keyword: topics.keyword }).from(topics),
  ])
  return { data: ultimo.data, ...classificarOportunidades(linhas, temas.map((t) => t.keyword)) }
}
