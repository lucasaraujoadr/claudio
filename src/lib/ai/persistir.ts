import { and, eq } from 'drizzle-orm'
import type { ClustersGerados } from '@/lib/ai/schemas'
import type { BriefingGerado } from '@/lib/ai/schemas'
import { modeloEmUso } from '@/lib/ai/cliente'
import { getDb } from '@/lib/db'
import { briefings, clusters, topics, type Topic } from '@/lib/db/schema'
import { normalizarKeyword } from '@/lib/keyword'

/** Grava clusters e temas da pesquisa; devolve quantos temas entraram. Usado pela rota e pela validação ao vivo. */
export async function gravarTemasPesquisados(gerados: ClustersGerados): Promise<number> {
  return getDb().transaction(async (tx) => {
    let inseridos = 0
    for (const cluster of gerados.clusters) {
      const [criado] = await tx
        .insert(clusters)
        .values({
          nome: cluster.nome,
          keywordPilar: cluster.keywordPilar,
          intencao: cluster.intencao,
          prioridade: cluster.prioridade,
        })
        .returning({ id: clusters.id })
      // Um tema que colide no índice único (gravado por outra requisição durante a
      // pesquisa) é ignorado: não pode desfazer a pesquisa inteira.
      const doCluster = await tx
        .insert(topics)
        .values(
          cluster.temas.map((t) => ({
            clusterId: criado.id,
            titulo: t.titulo,
            keyword: t.keyword,
            keywordNormalizada: normalizarKeyword(t.keyword),
            intencao: t.intencao,
            prioridade: t.prioridade,
            origem: 'ia' as const,
          })),
        )
        .onConflictDoNothing({ target: topics.keywordNormalizada })
        .returning({ id: topics.id })
      if (doCluster.length === 0) await tx.delete(clusters).where(eq(clusters.id, criado.id))
      inseridos += doCluster.length
    }
    return inseridos
  })
}

export class JaBriefadoError extends Error {}

/** Grava o briefing e move o tema de escolhido para briefado, na mesma transação. */
export async function gravarBriefing(topico: Topic, briefing: BriefingGerado): Promise<{ id: number }> {
  return getDb().transaction(async (tx) => {
    const [novo] = await tx
      .insert(briefings)
      .values({
        topicId: topico.id,
        title: briefing.title,
        metaDescription: briefing.metaDescription,
        outline: briefing.outline,
        faq: briefing.faq,
        linksInternos: briefing.linksInternos,
        keywordsSecundarias: briefing.keywordsSecundarias,
        modelo: modeloEmUso(),
      })
      .returning({ id: briefings.id })
    const movidos = await tx
      .update(topics)
      .set({ status: 'briefado' })
      .where(and(eq(topics.id, topico.id), eq(topics.status, 'escolhido')))
      .returning({ id: topics.id })
    // Outro clique já briefou o tema: desfaz o insert.
    if (movidos.length === 0) throw new JaBriefadoError()
    return novo
  })
}
