import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { idDaRota } from '@/lib/artigos/visao'
import { marcarPublicada, obterPeca } from '@/lib/distribuicao/repositorio'

export const runtime = 'nodejs'

const corpoSchema = z
  .object({
    url: z
      .string()
      .trim()
      .max(1000)
      .url()
      .refine((u) => /^https?:\/\//i.test(u), { message: 'url http(s)' })
      .nullable(),
  })
  .strict()

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = idDaRota((await ctx.params).id)
  if (!id) return NextResponse.json({ erro: 'peça não encontrada' }, { status: 404 })
  let corpo: unknown = { url: null }
  const texto = await request.text().catch(() => '')
  if (texto.trim()) {
    try {
      corpo = JSON.parse(texto)
    } catch {
      return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 })
    }
  }
  const parsed = corpoSchema.safeParse(corpo)
  if (!parsed.success) return NextResponse.json({ erro: 'url inválida' }, { status: 400 })
  try {
    const nova = await marcarPublicada(id, parsed.data.url, new Date())
    if (!nova) {
      return (await obterPeca(id))
        ? NextResponse.json({ erro: 'a peça ainda está sendo gerada' }, { status: 409 })
        : NextResponse.json({ erro: 'peça não encontrada' }, { status: 404 })
    }
    return NextResponse.json(nova)
  } catch (e) {
    console.error('Falha ao marcar peça como publicada', e instanceof Error ? e.name : 'erro')
    return NextResponse.json({ erro: 'falha ao marcar como publicada' }, { status: 500 })
  }
}
