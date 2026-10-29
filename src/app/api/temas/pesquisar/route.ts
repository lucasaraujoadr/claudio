import { NextResponse, type NextRequest } from 'next/server'
import { ChaveOpenAIAusenteError, openaiConfigurada } from '@/lib/ai/cliente'
import { carregarContexto } from '@/lib/ai/contexto'
import { dedupTemas, pesquisarTemas } from '@/lib/ai/temas'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { clusters, topics } from '@/lib/db/schema'
import { normalizarKeyword } from '@/lib/keyword'

export const runtime = 'nodejs'
export const maxDuration = 120

type Flag = 'ok' | 'vazio' | 'sem-chave' | 'erro'

function voltar(request: NextRequest, flag: Flag, novos?: number) {
  const url = new URL(`/temas?pesquisa=${flag}`, request.url)
  if (novos !== undefined) url.searchParams.set('novos', String(novos))
  return NextResponse.redirect(url, 303)
}

export async function POST(request: NextRequest) {
  if (!openaiConfigurada()) return voltar(request, 'sem-chave')
  try {
    const ctx = await carregarContexto()
    const gerados = dedupTemas(await pesquisarTemas(ctx), ctx.temasExistentes)
    if (gerados.clusters.length === 0) return voltar(request, 'vazio')

    const novos = await getDb().transaction(async (tx) => {
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
    return novos > 0 ? voltar(request, 'ok', novos) : voltar(request, 'vazio')
  } catch (erro) {
    if (erro instanceof ChaveOpenAIAusenteError) return voltar(request, 'sem-chave')
    console.error('Falha na pesquisa de temas', erro)
    return voltar(request, 'erro')
  }
}
