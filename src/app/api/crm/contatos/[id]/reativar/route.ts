import { NextResponse, type NextRequest } from 'next/server'
import { reativarContato } from '@/lib/crm/contatos'
import { lerId } from '@/lib/crm/formulario'

export const runtime = 'nodejs'

/** Saída explícita de `descadastrado`: exige ciência do aviso de LGPD e um motivo. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/crm/contatos/[id]/reativar'>) {
  const id = lerId((await ctx.params).id)
  if (!id) return NextResponse.redirect(new URL('/crm/contatos', request.url), 303)
  const voltar = (aviso: string) => NextResponse.redirect(new URL(`/crm/contatos/${id}?aviso=${aviso}`, request.url), 303)
  try {
    const form = await request.formData()
    if (form.get('ciente') !== '1') return voltar('sem-ciente')
    const motivo = form.get('motivo')
    const r = await reativarContato(id, typeof motivo === 'string' ? motivo : '')
    if (!r.ok) return voltar(r.motivo === 'sem_motivo' ? 'sem-motivo' : r.motivo === 'dados_apagados' ? 'dados-apagados-bloqueio' : 'erro')
    return voltar('reativado')
  } catch (e) {
    console.error('crm: reativação falhou:', e instanceof Error ? e.name : 'erro')
    return voltar('erro')
  }
}
