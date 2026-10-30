import { NextResponse, type NextRequest } from 'next/server'
import { nomeBase, renderizarPng } from '@/lib/distribuicao/arte/pacote'
import { carrosselDaRota, respostaArquivo } from '@/lib/distribuicao/arte/rota'

export const runtime = 'nodejs'

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string; n: string }> }) {
  const { id, n: nBruto } = await ctx.params
  try {
    const r = await carrosselDaRota(id)
    if (r instanceof NextResponse) return r
    const n = /^\d+$/.test(nBruto) ? Number(nBruto) : 0
    if (n < 1 || n > r.carrossel.laminas.length) return NextResponse.json({ erro: 'lâmina não encontrada' }, { status: 404 })
    const png = await renderizarPng(r.carrossel, n, r.variacao)
    if (!(png instanceof Uint8Array)) return NextResponse.json(png, { status: 422 })
    return respostaArquivo(png, 'image/png', `${nomeBase(r.peca.artigoSlug)}-lamina-${String(n).padStart(2, '0')}.png`, true)
  } catch (e) {
    console.error('Falha ao renderizar lâmina', e instanceof Error ? e.name : 'erro')
    return NextResponse.json({ erro: 'falha ao renderizar a lâmina' }, { status: 500 })
  }
}
