import type { NextRequest } from 'next/server'
import { fluxoExportacao } from '@/lib/crm/exportar'
import { lerFiltro } from '@/lib/crm/filtros'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** CSV dos contatos do filtro atual (todas as páginas). Atrás da sessão, como todo /api fora de /api/cron. */
export function GET(request: NextRequest) {
  const filtro = lerFiltro(Object.fromEntries(request.nextUrl.searchParams))
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  return new Response(fluxoExportacao(filtro), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="contatos-${hoje}.csv"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
