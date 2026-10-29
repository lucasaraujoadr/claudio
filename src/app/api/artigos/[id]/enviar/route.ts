import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { enviarArtigo } from '@/lib/artigos/enviar'
import { obterArtigo } from '@/lib/artigos/repositorio'
import { idDaRota, keywordDoTema } from '@/lib/artigos/visao'
import { configWp, criarClienteWp } from '@/lib/wordpress'

export const runtime = 'nodejs'
export const maxDuration = 60

const corpoSchema = z.object({
  modo: z.enum(['rascunho', 'agendar', 'publicar']),
  sobrescrever: z.boolean().optional(),
})

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = idDaRota((await ctx.params).id)
  if (!id) return NextResponse.json({ tipo: 'erro', mensagem: 'artigo não encontrado' }, { status: 404 })
  const cfg = configWp()
  if (!cfg) return NextResponse.json({ tipo: 'erro', mensagem: 'WordPress não configurado' }, { status: 503 })

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ tipo: 'erro', mensagem: 'JSON inválido' }, { status: 400 })
  }
  const parsed = corpoSchema.safeParse(corpo)
  if (!parsed.success) return NextResponse.json({ tipo: 'erro', mensagem: 'dados inválidos' }, { status: 400 })

  try {
    const artigo = await obterArtigo(id)
    if (!artigo) return NextResponse.json({ tipo: 'erro', mensagem: 'artigo não encontrado' }, { status: 404 })
    const resultado = await enviarArtigo(id, parsed.data.modo, {
      sobrescrever: parsed.data.sobrescrever,
      cliente: criarClienteWp(cfg),
      keyword: await keywordDoTema(artigo.topicId),
    })
    return NextResponse.json(resultado, { status: resultado.tipo === 'erro' ? 502 : 200 })
  } catch (e) {
    console.error('Falha ao enviar artigo', e instanceof Error ? e.name : 'erro')
    return NextResponse.json({ tipo: 'erro', mensagem: 'falha ao enviar o artigo' }, { status: 502 })
  }
}
