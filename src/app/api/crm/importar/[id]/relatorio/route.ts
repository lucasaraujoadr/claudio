import type { NextRequest } from 'next/server'
import { carregarLote, relatorioCsv, relatorioDoLote } from '@/lib/crm/importacao'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Relatório da importação (linha, e-mail, resultado, motivo) em CSV para o Excel. */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/crm/importar/[id]/relatorio'>) {
  const { id } = await ctx.params
  try {
    const lote = await carregarLote(id)
    const relatorio = lote ? relatorioDoLote(lote) : null
    if (!relatorio) return new Response('Relatório não encontrado ou expirado.', { status: 404 })
    return new Response(relatorioCsv(relatorio), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="relatorio-importacao-${id.slice(0, 8)}.csv"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (e) {
    console.error('crm: relatório falhou:', e instanceof Error ? e.name : 'erro')
    return new Response('Não foi possível ler o relatório.', { status: 500 })
  }
}
