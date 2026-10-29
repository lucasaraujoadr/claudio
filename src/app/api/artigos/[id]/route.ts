import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { normalizarSlug } from '@/lib/artigos/formato'
import { sanitizarHtml } from '@/lib/artigos/html'
import { obterArtigo, salvarEdicao } from '@/lib/artigos/repositorio'
import { idDaRota, keywordDoTema, montarVisao } from '@/lib/artigos/visao'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const edicaoSchema = z
  .object({
    titulo: z.string().max(300),
    slug: z.string().max(200),
    metaDescription: z.string().max(500),
    conteudoHtml: z.string().max(400_000),
    categoriaId: z.number().int().positive().nullable(),
    revisado: z.boolean(),
    agendadoPara: z.string().datetime({ offset: true }).nullable(),
    capaMediaId: z.number().int().positive().nullable(),
    capaUrl: z.string().url().max(1000).nullable(),
  })
  .partial()
  .strict()

export async function GET(_request: NextRequest, ctx: Ctx) {
  const id = idDaRota((await ctx.params).id)
  if (!id) return NextResponse.json({ erro: 'artigo não encontrado' }, { status: 404 })
  try {
    const artigo = await obterArtigo(id)
    if (!artigo) return NextResponse.json({ erro: 'artigo não encontrado' }, { status: 404 })
    return NextResponse.json(montarVisao(artigo, await keywordDoTema(artigo.topicId)))
  } catch (e) {
    console.error('Falha ao ler artigo', e instanceof Error ? e.name : 'erro')
    return NextResponse.json({ erro: 'falha ao ler o artigo' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const id = idDaRota((await ctx.params).id)
  if (!id) return NextResponse.json({ erro: 'artigo não encontrado' }, { status: 404 })
  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 })
  }
  const parsed = edicaoSchema.safeParse(corpo)
  if (!parsed.success) return NextResponse.json({ erro: 'dados inválidos' }, { status: 400 })

  const { conteudoHtml, slug, agendadoPara, ...resto } = parsed.data
  const campos: Parameters<typeof salvarEdicao>[1] = { ...resto }
  if (conteudoHtml !== undefined) campos.conteudoHtml = sanitizarHtml(conteudoHtml)
  if (slug !== undefined) campos.slug = normalizarSlug(slug)
  if (agendadoPara !== undefined) campos.agendadoPara = agendadoPara === null ? null : new Date(agendadoPara)

  try {
    const atualizado = await salvarEdicao(id, campos, new Date())
    if (!atualizado) {
      const existe = await obterArtigo(id)
      return existe
        ? NextResponse.json({ erro: 'o artigo ainda está sendo gerado' }, { status: 409 })
        : NextResponse.json({ erro: 'artigo não encontrado' }, { status: 404 })
    }
    return NextResponse.json(montarVisao(atualizado, await keywordDoTema(atualizado.topicId)))
  } catch (e) {
    console.error('Falha ao salvar artigo', e instanceof Error ? e.name : 'erro')
    return NextResponse.json({ erro: 'falha ao salvar o artigo' }, { status: 500 })
  }
}
