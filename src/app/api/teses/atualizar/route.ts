import { NextResponse, type NextRequest } from 'next/server'
import { iaConfigurada } from '@/lib/ai/cliente'
import { executarRadar } from '@/lib/radar/executar'
import { repositorioRadar } from '@/lib/radar/repositorio'

export const runtime = 'nodejs'
// Uma busca + uma geração de teses, cada uma com teto de 100 s no cliente; a busca pode ter uma
// nova tentativa se o JSON vier fora do formato (3 x 100 s no pior caso). Máximo do plano Hobby.
export const maxDuration = 300

type Flag = 'ok' | 'ja-rodou' | 'em-execucao' | 'sem-chave' | 'erro'

function voltar(request: NextRequest, flag: Flag, extra: Record<string, number> = {}) {
  const url = new URL(`/tendencias?atualizar=${flag}`, request.url)
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, String(v))
  return NextResponse.redirect(url, 303)
}

export async function POST(request: NextRequest) {
  if (!iaConfigurada()) return voltar(request, 'sem-chave')
  let forcar = false
  try {
    forcar = (await request.formData()).get('forcar') === '1'
  } catch {
    // formulário ilegível: segue sem forçar (o caminho barato)
  }
  try {
    const r = await executarRadar({ agora: new Date(), forcar, repo: repositorioRadar })
    if (r.pulado) return voltar(request, r.motivoPulo === 'em_execucao' ? 'em-execucao' : 'ja-rodou')
    if (r.erros.length > 0) return voltar(request, 'erro')
    return voltar(request, 'ok', { tendencias: r.coleta?.gravadas ?? 0, teses: r.teses?.gravadas ?? 0 })
  } catch (erro) {
    console.error('Falha ao atualizar o radar', erro instanceof Error ? erro.name : 'erro')
    return voltar(request, 'erro')
  }
}
