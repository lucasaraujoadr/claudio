import { NextResponse, type NextRequest } from 'next/server'
import { contatosComTag, contatosPorEmail, inscrever } from '@/lib/crm/funis'
import { lerEmails, paramsResultadoInscricao } from '@/lib/crm/funis-formulario'
import { ehSlugFunil } from '@/lib/crm/funis-regras'

export const runtime = 'nodejs'

/** Inscrição pela tela: emails colados ou todos os contatos de uma tag. As regras do funil valem. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/crm/funis/[slug]/inscrever'>) {
  const { slug } = await ctx.params
  if (!ehSlugFunil(slug)) return NextResponse.redirect(new URL('/crm/funis', request.url), 303)
  const voltar = (q: string) => NextResponse.redirect(new URL(`/crm/funis/${slug}?${q}`, request.url), 303)
  try {
    const form = await request.formData()
    const texto = typeof form.get('emails') === 'string' ? String(form.get('emails')) : ''
    const tag = typeof form.get('tag') === 'string' ? String(form.get('tag')).trim() : ''
    const { emails, invalidos } = lerEmails(texto.slice(0, 200_000))
    if (emails.length === 0 && !tag) return voltar('aviso=nada-para-inscrever')
    const porEmail = await contatosPorEmail(emails)
    const porTag = tag ? await contatosComTag(tag) : []
    const r = await inscrever(slug, [...porEmail.ids, ...porTag], { caminho: 'manual' })
    return voltar(paramsResultadoInscricao(r, porEmail.naoEncontrados + invalidos).toString())
  } catch (e) {
    console.error('crm: inscrição manual falhou:', e instanceof Error ? e.name : 'erro')
    return voltar('aviso=erro')
  }
}
