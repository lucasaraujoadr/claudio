import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { gerarBriefing } from '@/lib/ai/briefing'
import { ChaveOpenAIAusenteError, MODELO_PADRAO, openaiConfigurada } from '@/lib/ai/cliente'
import { carregarUrlsDoSite } from '@/lib/ai/contexto'
import { getDb } from '@/lib/db'
import { briefings, topics } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const maxDuration = 120 // até duas chamadas ao modelo (100 s cada, no pior caso a nova tentativa)

type Flag = 'sem-chave' | 'erro' | 'ja-briefado' | 'nao-escolhido'

// Falhas sempre voltam para /temas (caminho fixo, sem destino vindo do formulário).
function voltar(request: NextRequest, flag: Flag) {
  return NextResponse.redirect(new URL(`/temas?briefing=${flag}`, request.url), 303)
}

class JaBriefadoError extends Error {}

export async function POST(request: NextRequest) {
  let id = NaN
  try {
    id = Number((await request.formData()).get('id'))
  } catch {
    return voltar(request, 'erro')
  }
  if (!Number.isInteger(id) || id <= 0) return voltar(request, 'erro')
  if (!openaiConfigurada()) return voltar(request, 'sem-chave')

  try {
    const db = getDb()
    const [topico] = await db.select().from(topics).where(eq(topics.id, id)).limit(1)
    if (!topico) return voltar(request, 'erro')
    if (topico.status === 'briefado') return voltar(request, 'ja-briefado')
    if (topico.status !== 'escolhido') return voltar(request, 'nao-escolhido')

    const urlsDoSite = await carregarUrlsDoSite()
    const briefing = await gerarBriefing({ topico, urlsDoSite })

    const criado = await db.transaction(async (tx) => {
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
          modelo: process.env.OPENAI_MODEL || MODELO_PADRAO,
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
    return NextResponse.redirect(new URL(`/briefings?id=${criado.id}&gerado=ok`, request.url), 303)
  } catch (erro) {
    if (erro instanceof JaBriefadoError) return voltar(request, 'ja-briefado')
    if (erro instanceof ChaveOpenAIAusenteError) return voltar(request, 'sem-chave')
    console.error('Falha ao gerar briefing', erro)
    return voltar(request, 'erro')
  }
}
