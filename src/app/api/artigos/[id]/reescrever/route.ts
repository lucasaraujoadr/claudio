import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { iaConfigurada } from '@/lib/ai/cliente'
import { reescreverTrecho } from '@/lib/artigos/gerar'
import { obterArtigo } from '@/lib/artigos/repositorio'
import { idDaRota, keywordDoTema } from '@/lib/artigos/visao'

export const runtime = 'nodejs'
export const maxDuration = 120

const corpoSchema = z.object({
  trecho: z.string().trim().min(1).max(4000),
  instrucao: z.string().trim().min(1).max(500),
})

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = idDaRota((await ctx.params).id)
  if (!id) return NextResponse.json({ erro: 'artigo não encontrado' }, { status: 404 })
  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 })
  }
  const parsed = corpoSchema.safeParse(corpo)
  if (!parsed.success) return NextResponse.json({ erro: 'trecho ou instrução com tamanho inválido' }, { status: 400 })
  if (!iaConfigurada()) return NextResponse.json({ erro: 'IA não configurada' }, { status: 503 })

  try {
    const artigo = await obterArtigo(id)
    if (!artigo) return NextResponse.json({ erro: 'artigo não encontrado' }, { status: 404 })
    const texto = await reescreverTrecho({ ...parsed.data, keyword: await keywordDoTema(artigo.topicId) })
    return NextResponse.json({ texto })
  } catch (e) {
    console.error('Falha ao reescrever trecho', e instanceof Error ? e.name : 'erro')
    return NextResponse.json({ erro: 'não foi possível reescrever o trecho' }, { status: 502 })
  }
}
