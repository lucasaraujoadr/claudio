import { NextResponse, type NextRequest } from 'next/server'
import { idDaRota } from '@/lib/artigos/visao'
import { iaConfigurada } from '@/lib/ai/cliente'
import { carregarArtigoParaPecas, gerarPecas } from '@/lib/distribuicao/gerar'
import { pecasDoArtigo } from '@/lib/distribuicao/repositorio'
import { TIPOS_PECA, type TipoPeca } from '@/lib/distribuicao/schemas'

export const runtime = 'nodejs'
export const maxDuration = 300

const STATUS = { nao_encontrado: 404, verificar: 400, situacao: 409 } as const

/** `tipos` no JSON (array ou texto separado por vírgula) ou no formulário (repetido ou separado por vírgula). */
async function lerTipos(request: NextRequest): Promise<TipoPeca[] | undefined | 'invalido'> {
  let brutos: unknown[] = []
  const ct = request.headers.get('content-type') ?? ''
  try {
    if (ct.includes('application/json')) {
      const corpo = (await request.json()) as { tipos?: unknown } | null
      const t = corpo?.tipos
      if (t === undefined || t === null) return undefined
      brutos = Array.isArray(t) ? t : [t]
    } else if (ct.includes('form')) {
      const form = await request.formData()
      brutos = form.getAll('tipos')
      if (brutos.length === 0) return undefined
    } else {
      return undefined
    }
  } catch {
    return 'invalido'
  }
  const tipos = brutos.flatMap((b) => (typeof b === 'string' ? b.split(',').map((s) => s.trim()).filter(Boolean) : [b]))
  if (tipos.length === 0 || !tipos.every((t): t is TipoPeca => TIPOS_PECA.includes(t as TipoPeca))) return 'invalido'
  return [...new Set(tipos)]
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ artigoId: string }> }) {
  const artigoId = idDaRota((await ctx.params).artigoId)
  if (!artigoId) return NextResponse.json({ erro: 'artigo não encontrado' }, { status: 404 })
  const pedidos = await lerTipos(request)
  if (pedidos === 'invalido') return NextResponse.json({ erro: 'tipos inválidos' }, { status: 400 })
  if (!iaConfigurada()) return NextResponse.json({ erro: 'IA não configurada' }, { status: 503 })

  try {
    const carregado = await carregarArtigoParaPecas(artigoId)
    if (carregado.tipo === 'recusado') {
      return NextResponse.json({ erro: carregado.mensagem }, { status: STATUS[carregado.motivo] })
    }
    // Sem `tipos`: só o que falta ou está em erro. Rascunho editado nunca é regerado de forma implícita.
    let tipos = pedidos
    if (!tipos) {
      const existentes = new Map((await pecasDoArtigo(artigoId)).map((p) => [p.tipo, p.situacao]))
      tipos = TIPOS_PECA.filter((t) => !existentes.has(t) || existentes.get(t) === 'erro')
    }
    if (tipos.length === 0) return NextResponse.json({ pecas: {} })

    // Aguarda a geração para devolver os ajustes (cortes de texto) na resposta.
    const r = await gerarPecas(artigoId, { tipos })
    if (r.tipo === 'recusado') return NextResponse.json({ erro: r.mensagem }, { status: STATUS[r.motivo] })
    return NextResponse.json({ pecas: r.pecas })
  } catch (e) {
    console.error('Falha ao gerar peças', e instanceof Error ? e.name : 'erro')
    return NextResponse.json({ erro: 'falha ao gerar as peças' }, { status: 500 })
  }
}
