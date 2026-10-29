import { NextResponse, type NextRequest } from 'next/server'
import { ChaveOpenAIAusenteError, openaiConfigurada } from '@/lib/ai/cliente'
import { carregarContexto } from '@/lib/ai/contexto'
import { dedupTemas, pesquisarTemas } from '@/lib/ai/temas'
import { getDb } from '@/lib/db'
import { clusters, topics } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const maxDuration = 120

type Flag = 'ok' | 'vazio' | 'sem-chave' | 'erro'

function voltar(request: NextRequest, flag: Flag) {
  return NextResponse.redirect(new URL(`/temas?pesquisa=${flag}`, request.url), 303)
}

export async function POST(request: NextRequest) {
  if (!openaiConfigurada()) return voltar(request, 'sem-chave')
  try {
    const ctx = await carregarContexto()
    const gerados = dedupTemas(await pesquisarTemas(ctx), ctx.temasExistentes)
    if (gerados.clusters.length === 0) return voltar(request, 'vazio')

    await getDb().transaction(async (tx) => {
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
        await tx.insert(topics).values(
          cluster.temas.map((t) => ({
            clusterId: criado.id,
            titulo: t.titulo,
            keyword: t.keyword,
            intencao: t.intencao,
            prioridade: t.prioridade,
            origem: 'ia' as const,
          })),
        )
      }
    })
    return voltar(request, 'ok')
  } catch (erro) {
    if (erro instanceof ChaveOpenAIAusenteError) return voltar(request, 'sem-chave')
    console.error('Falha na pesquisa de temas', erro)
    return voltar(request, 'erro')
  }
}
