import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { idDaRota } from '@/lib/artigos/visao'
import { laminaCabe } from '@/lib/distribuicao/arte/lamina'
import { definirVariacao, obterPeca, salvarPeca } from '@/lib/distribuicao/repositorio'
import { SCHEMAS_ESTRITOS } from '@/lib/distribuicao/schemas'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const edicaoSchema = z
  .object({ conteudo: z.unknown(), variacao: z.enum(['escura', 'clara']) })
  .partial()
  .strict()

const naoEncontrada = () => NextResponse.json({ erro: 'peça não encontrada' }, { status: 404 })

export async function GET(_request: NextRequest, ctx: Ctx) {
  const id = idDaRota((await ctx.params).id)
  if (!id) return naoEncontrada()
  try {
    const peca = await obterPeca(id)
    return peca ? NextResponse.json(peca) : naoEncontrada()
  } catch (e) {
    console.error('Falha ao ler peça', e instanceof Error ? e.name : 'erro')
    return NextResponse.json({ erro: 'falha ao ler a peça' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const id = idDaRota((await ctx.params).id)
  if (!id) return naoEncontrada()
  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 })
  }
  const parsed = edicaoSchema.safeParse(corpo)
  const { conteudo, variacao } = parsed.success ? parsed.data : {}
  if (!parsed.success || (conteudo === undefined && variacao === undefined)) {
    return NextResponse.json({ erro: 'dados inválidos' }, { status: 400 })
  }

  try {
    const atual = await obterPeca(id)
    if (!atual) return naoEncontrada()
    if (atual.situacao === 'gerando') return NextResponse.json({ erro: 'a peça ainda está sendo gerada' }, { status: 409 })
    if (variacao !== undefined && atual.tipo !== 'carrossel') {
      return NextResponse.json({ erro: 'só o carrossel tem variação' }, { status: 400 })
    }

    if (conteudo !== undefined) {
      const valido = SCHEMAS_ESTRITOS[atual.tipo].safeParse(conteudo)
      if (!valido.success) {
        return NextResponse.json({ erro: 'conteúdo inválido', detalhes: valido.error.issues.map((i) => i.message) }, { status: 400 })
      }
      if (atual.tipo === 'carrossel') {
        const carrossel = valido.data as z.infer<typeof SCHEMAS_ESTRITOS.carrossel>
        const laminas = carrossel.laminas.flatMap((l, i) => (laminaCabe(l) ? [] : [i + 1]))
        if (laminas.length > 0) return NextResponse.json({ erro: 'texto longo demais', laminas }, { status: 422 })
      }
    }

    const agora = new Date()
    let nova = atual
    if (conteudo !== undefined) {
      const salva = await salvarPeca(id, conteudo, agora)
      if (!salva) return NextResponse.json({ erro: 'a peça ainda está sendo gerada' }, { status: 409 })
      nova = { ...atual, ...salva }
    }
    if (variacao !== undefined) {
      const salva = await definirVariacao(id, variacao, agora)
      if (!salva) return NextResponse.json({ erro: 'a peça ainda está sendo gerada' }, { status: 409 })
      nova = { ...nova, ...salva }
    }
    return NextResponse.json(nova)
  } catch (e) {
    console.error('Falha ao salvar peça', e instanceof Error ? e.name : 'erro')
    return NextResponse.json({ erro: 'falha ao salvar a peça' }, { status: 500 })
  }
}
