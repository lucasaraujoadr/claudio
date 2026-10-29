import { NextResponse, type NextRequest } from 'next/server'
import { ChaveOpenAIAusenteError, openaiConfigurada } from '@/lib/ai/cliente'
import { carregarContexto } from '@/lib/ai/contexto'
import { dedupTemas, pesquisarTemas } from '@/lib/ai/temas'
import { gravarTemasPesquisados } from '@/lib/ai/persistir'

export const runtime = 'nodejs'
export const maxDuration = 120

type Flag = 'ok' | 'vazio' | 'sem-chave' | 'erro'

function voltar(request: NextRequest, flag: Flag, novos?: number) {
  const url = new URL(`/temas?pesquisa=${flag}`, request.url)
  if (novos !== undefined) url.searchParams.set('novos', String(novos))
  return NextResponse.redirect(url, 303)
}

export async function POST(request: NextRequest) {
  if (!openaiConfigurada()) return voltar(request, 'sem-chave')
  try {
    const ctx = await carregarContexto()
    const gerados = dedupTemas(await pesquisarTemas(ctx), ctx.temasExistentes)
    if (gerados.clusters.length === 0) return voltar(request, 'vazio')

    const novos = await gravarTemasPesquisados(gerados)
    return novos > 0 ? voltar(request, 'ok', novos) : voltar(request, 'vazio')
  } catch (erro) {
    if (erro instanceof ChaveOpenAIAusenteError) return voltar(request, 'sem-chave')
    console.error('Falha na pesquisa de temas', erro)
    return voltar(request, 'erro')
  }
}
