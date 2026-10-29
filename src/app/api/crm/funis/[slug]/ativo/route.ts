import { NextResponse, type NextRequest } from 'next/server'
import { definirAtivo, ligarProspeccaoFria } from '@/lib/crm/funis'
import { lerChecklist, lerInteiro } from '@/lib/crm/funis-formulario'
import { ehSlugFunil } from '@/lib/crm/funis-regras'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, ctx: RouteContext<'/api/crm/funis/[slug]/ativo'>) {
  const { slug } = await ctx.params
  if (!ehSlugFunil(slug)) return NextResponse.redirect(new URL('/crm/funis', request.url), 303)
  const voltar = (aviso: string) => NextResponse.redirect(new URL(`/crm/funis/${slug}?aviso=${aviso}`, request.url), 303)
  try {
    const form = await request.formData()
    const ligar = form.get('ativo') === '1'
    if (slug === 'prospeccao-fria' && ligar) {
      const r = await ligarProspeccaoFria(lerChecklist(form), lerInteiro(form.get('teto')))
      return voltar(r.ok ? 'ligado' : r.motivo)
    }
    const r = await definirAtivo(slug, ligar)
    return voltar(r.ok ? (ligar ? 'ligado' : 'desligado') : 'checklist')
  } catch (e) {
    console.error('crm: mudar funil falhou:', e instanceof Error ? e.name : 'erro')
    return voltar('erro')
  }
}
