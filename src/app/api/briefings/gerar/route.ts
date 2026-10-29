import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { gerarBriefing } from '@/lib/ai/briefing'
import { ChaveOpenAIAusenteError, openaiConfigurada } from '@/lib/ai/cliente'
import { carregarUrlsDoSite } from '@/lib/ai/contexto'
import { gravarBriefing, JaBriefadoError } from '@/lib/ai/persistir'
import { getDb } from '@/lib/db'
import { topics } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const maxDuration = 300 // 2 chamadas x 100 s (timeout de gerarObjetoPadrao) = 200 s + margem

type Flag = 'sem-chave' | 'erro' | 'ja-briefado' | 'nao-escolhido'

// Falhas sempre voltam para /temas (caminho fixo, sem destino vindo do formulário).
function voltar(request: NextRequest, flag: Flag) {
  return NextResponse.redirect(new URL(`/temas?briefing=${flag}`, request.url), 303)
}

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

    const criado = await gravarBriefing(topico, briefing)
    return NextResponse.redirect(new URL(`/briefings?id=${criado.id}&gerado=ok`, request.url), 303)
  } catch (erro) {
    if (erro instanceof JaBriefadoError) return voltar(request, 'ja-briefado')
    if (erro instanceof ChaveOpenAIAusenteError) return voltar(request, 'sem-chave')
    console.error('Falha ao gerar briefing', erro)
    return voltar(request, 'erro')
  }
}
