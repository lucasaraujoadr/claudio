import { NextResponse, type NextRequest } from 'next/server'
import { montarPdf, nomeBase, renderizarTodas } from '@/lib/distribuicao/arte/pacote'
import { carrosselDaRota, respostaArquivo } from '@/lib/distribuicao/arte/rota'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const r = await carrosselDaRota((await ctx.params).id)
    if (r instanceof NextResponse) return r
    const pngs = await renderizarTodas(r.carrossel, r.variacao)
    if (!Array.isArray(pngs)) return NextResponse.json(pngs, { status: 422 })
    return respostaArquivo(await montarPdf(pngs), 'application/pdf', `${nomeBase(r.peca.artigoSlug)}-carrossel.pdf`, false)
  } catch (e) {
    console.error('Falha ao gerar PDF', e instanceof Error ? e.name : 'erro')
    return NextResponse.json({ erro: 'falha ao gerar o PDF' }, { status: 500 })
  }
}
