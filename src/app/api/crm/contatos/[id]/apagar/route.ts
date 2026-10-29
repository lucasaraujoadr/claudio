import { NextResponse, type NextRequest } from 'next/server'
import { apagarDadosAPedido } from '@/lib/crm/apagar-dados'
import { lerId } from '@/lib/crm/formulario'

export const runtime = 'nodejs'

/**
 * "Apagar dados a pedido" (LGPD art. 18): exige a confirmação de que não tem volta e o
 * motivo. Anonimiza e mantém só o email, para que a pessoa não seja cadastrada de novo.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/crm/contatos/[id]/apagar'>) {
  const id = lerId((await ctx.params).id)
  if (!id) return NextResponse.redirect(new URL('/crm/contatos', request.url), 303)
  const voltar = (aviso: string) => NextResponse.redirect(new URL(`/crm/contatos/${id}?aviso=${aviso}`, request.url), 303)
  try {
    const form = await request.formData()
    if (form.get('ciente') !== '1') return voltar('apagar-sem-ciente')
    const motivo = form.get('motivo')
    const r = await apagarDadosAPedido(id, typeof motivo === 'string' ? motivo : '')
    if (!r.ok) return voltar(r.motivo === 'sem_motivo' ? 'apagar-sem-motivo' : r.motivo === 'ja_apagado' ? 'dados-apagados' : 'erro')
    return voltar('dados-apagados')
  } catch (e) {
    console.error('crm: apagar dados falhou:', e instanceof Error ? e.name : 'erro')
    return voltar('erro')
  }
}
