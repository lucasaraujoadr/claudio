import { NextResponse, type NextRequest } from 'next/server'
import { mudarStatus } from '@/lib/crm/contatos'
import { lerId, lerStatus } from '@/lib/crm/formulario'
import { sairDeTodosOsFunis } from '@/lib/crm/funis'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, ctx: RouteContext<'/api/crm/contatos/[id]/status'>) {
  const id = lerId((await ctx.params).id)
  if (!id) return NextResponse.redirect(new URL('/crm/contatos', request.url), 303)
  const voltar = (aviso: string) => NextResponse.redirect(new URL(`/crm/contatos/${id}?aviso=${aviso}`, request.url), 303)
  try {
    const para = lerStatus(await request.formData())
    if (!para) return voltar('erro')
    const r = await mudarStatus(id, para, { origem: 'manual' })
    if (!r.ok) return voltar(r.motivo === 'descadastrado' ? 'bloqueado' : 'erro')
    // Descadastrado sai de todos os funis (a rotina diária também confere, por segurança).
    if (r.para === 'descadastrado') await sairDeTodosOsFunis(id, { motivo: 'descadastrado (manual)' })
    return voltar(r.de === r.para ? 'sem-mudanca' : 'status')
  } catch (e) {
    console.error('crm: mudança de status falhou:', e instanceof Error ? e.name : 'erro')
    return voltar('erro')
  }
}
