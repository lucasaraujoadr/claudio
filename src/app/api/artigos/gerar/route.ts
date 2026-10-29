import { after, NextResponse, type NextRequest } from 'next/server'
import { iaConfigurada } from '@/lib/ai/cliente'
import { executarGeracao } from '@/lib/artigos/gerar'
import { reivindicarGeracao } from '@/lib/artigos/repositorio'

export const runtime = 'nodejs'
export const maxDuration = 300

type Flag = 'erro' | 'sem-chave'

function voltar(request: NextRequest, flag: Flag) {
  return NextResponse.redirect(new URL(`/artigos?gerar=${flag}`, request.url), 303)
}

function inteiro(v: FormDataEntryValue | null): number | null {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return null
  const n = Number(v)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export async function POST(request: NextRequest) {
  let topicId: number | null = null
  let teseId: number | null = null
  try {
    const form = await request.formData()
    topicId = inteiro(form.get('topicId'))
    teseId = inteiro(form.get('teseId'))
  } catch {
    return voltar(request, 'erro')
  }
  const origem = topicId ? { topicId } : teseId ? { teseId } : null
  if (!origem) return voltar(request, 'erro')
  if (!iaConfigurada()) return voltar(request, 'sem-chave')

  try {
    const r = await reivindicarGeracao(origem, new Date())
    if (r.tipo === 'nao_encontrado') return voltar(request, 'erro')
    if (r.tipo === 'reivindicado') {
      const { artigoId, topicId: tema } = r
      after(() => executarGeracao(artigoId, tema))
    }
    return NextResponse.redirect(new URL(`/artigos/${r.artigoId}`, request.url), 303)
  } catch (e) {
    console.error('Falha ao iniciar geração de artigo', e instanceof Error ? e.name : 'erro')
    return voltar(request, 'erro')
  }
}
