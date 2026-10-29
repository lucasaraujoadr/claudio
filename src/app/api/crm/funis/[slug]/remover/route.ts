import { NextResponse, type NextRequest } from 'next/server'
import { lerId } from '@/lib/crm/formulario'
import { obterFunil, sair } from '@/lib/crm/funis'
import { ehSlugFunil } from '@/lib/crm/funis-regras'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, ctx: RouteContext<'/api/crm/funis/[slug]/remover'>) {
  const { slug } = await ctx.params
  if (!ehSlugFunil(slug)) return NextResponse.redirect(new URL('/crm/funis', request.url), 303)
  const voltar = (aviso: string) => NextResponse.redirect(new URL(`/crm/funis/${slug}?aviso=${aviso}`, request.url), 303)
  try {
    const form = await request.formData()
    const id = lerId(typeof form.get('contato_id') === 'string' ? String(form.get('contato_id')) : '')
    if (!id) return voltar('erro')
    const funil = await obterFunil(slug)
    await sair(funil.id, [id], { motivo: 'removido na tela' })
    return voltar('removido')
  } catch (e) {
    console.error('crm: remover do funil falhou:', e instanceof Error ? e.name : 'erro')
    return voltar('erro')
  }
}
