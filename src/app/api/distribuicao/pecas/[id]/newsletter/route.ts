import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { idDaRota } from '@/lib/artigos/visao'
import {
  contarDestinatariosNewsletter,
  criarRascunhoNewsletter,
  enviarNewsletter,
  rascunhoDaPeca,
  ultimoEnvioDaPeca,
} from '@/lib/distribuicao/newsletter'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const corpoSchema = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('rascunho') }).strict(),
  z.object({ acao: z.literal('enviar') }).strict(),
])

const naoEncontrada = () => NextResponse.json({ erro: 'peça não encontrada' }, { status: 404 })

/** Último envio do artigo da peça e a contagem de destinatários (para "Confirmar envio para N contatos"). */
export async function GET(_request: NextRequest, ctx: Ctx) {
  const id = idDaRota((await ctx.params).id)
  if (!id) return naoEncontrada()
  try {
    const [envio, destinatarios] = await Promise.all([ultimoEnvioDaPeca(id), contarDestinatariosNewsletter()])
    const { agendadoPara: _semAgendamento, ...visivel } = envio ?? ({} as Record<string, unknown>)
    return NextResponse.json({ envio: envio ? visivel : null, destinatarios })
  } catch (e) {
    console.error('Falha ao ler a newsletter', e instanceof Error ? e.name : 'erro')
    return NextResponse.json({ erro: 'falha ao ler a newsletter' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const id = idDaRota((await ctx.params).id)
  if (!id) return naoEncontrada()
  let bruto: unknown
  try {
    bruto = await request.json()
  } catch {
    return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 })
  }
  const parsed = corpoSchema.safeParse(bruto)
  if (!parsed.success) return NextResponse.json({ erro: 'dados inválidos' }, { status: 400 })

  try {
    if (parsed.data.acao === 'rascunho') {
      const r = await criarRascunhoNewsletter(id)
      return r.ok ? NextResponse.json({ envio: r.envio }) : NextResponse.json({ erro: r.mensagem }, { status: 422 })
    }
    const envio = await rascunhoDaPeca(id)
    if (!envio) return NextResponse.json({ erro: 'crie o rascunho da newsletter antes de enviar' }, { status: 409 })
    const r = await enviarNewsletter(envio.id)
    return r.ok
      ? NextResponse.json({ situacao: r.situacao, destinatarios: r.destinatarios })
      : NextResponse.json({ erro: r.mensagem }, { status: 422 })
  } catch (e) {
    console.error('Falha na newsletter', e instanceof Error ? e.name : 'erro')
    return NextResponse.json({ erro: 'falha ao processar a newsletter' }, { status: 500 })
  }
}
