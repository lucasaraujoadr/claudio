import { NextResponse, type NextRequest } from 'next/server'
import { editarContato } from '@/lib/crm/contatos'
import { lerEdicao, lerId } from '@/lib/crm/formulario'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, ctx: RouteContext<'/api/crm/contatos/[id]/editar'>) {
  const id = lerId((await ctx.params).id)
  if (!id) return NextResponse.redirect(new URL('/crm/contatos', request.url), 303)
  const voltar = (aviso: string, campo?: string) =>
    NextResponse.redirect(new URL(`/crm/contatos/${id}?aviso=${aviso}${campo ? `&campo=${campo}` : ''}`, request.url), 303)
  try {
    const lido = lerEdicao(await request.formData())
    if (!lido.ok) return voltar(lido.erro, lido.campo)
    const r = await editarContato(id, lido.edicao)
    if (!r.ok) return voltar(r.motivo === 'uf_invalida' ? 'uf' : r.motivo === 'longo' ? 'longo' : 'erro')
    return voltar(r.alterados.length > 0 ? 'salvo' : 'sem-mudanca')
  } catch (e) {
    console.error('crm: edição falhou:', e instanceof Error ? e.name : 'erro')
    return voltar('erro')
  }
}
