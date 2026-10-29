import { NextResponse, type NextRequest } from 'next/server'
import { conectarListaBrevo } from '@/lib/crm/funis'
import { lerInteiro } from '@/lib/crm/funis-formulario'
import { ehSlugFunil } from '@/lib/crm/funis-regras'

export const runtime = 'nodejs'

/** "Conectar ao Brevo": cria a lista do funil (modo `criar`) ou usa uma existente (`existente`). */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/crm/funis/[slug]/brevo'>) {
  const { slug } = await ctx.params
  if (!ehSlugFunil(slug)) return NextResponse.redirect(new URL('/crm/funis', request.url), 303)
  const voltar = (aviso: string) => NextResponse.redirect(new URL(`/crm/funis/${slug}?aviso=${aviso}`, request.url), 303)
  try {
    const form = await request.formData()
    const existente = form.get('modo') === 'existente'
    const listaId = existente ? (lerInteiro(form.get('lista_id')) ?? -1) : null
    const r = await conectarListaBrevo(slug, { listaIdExistente: listaId })
    if (r.ok) return voltar(r.criada ? 'lista-criada' : r.verificada ? 'lista-ok' : 'lista-nao-verificada')
    if (r.motivo === 'lista_em_uso') return voltar(`lista-em-uso&outro=${encodeURIComponent(r.funil)}`)
    if (r.motivo === 'brevo') console.error('crm: conectar lista do Brevo falhou:', r.mensagem ?? 'brevo')
    return voltar(r.motivo === 'nao_conectado' ? 'nao-conectado' : r.motivo === 'lista_nao_encontrada' ? 'lista-nao-encontrada' : r.motivo === 'lista_invalida' ? 'lista-invalida' : 'brevo')
  } catch (e) {
    console.error('crm: conectar lista do Brevo falhou:', e instanceof Error ? e.name : 'erro')
    return voltar('erro')
  }
}
