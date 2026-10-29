import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { iaConfigurada } from '@/lib/ai/cliente'
import { executarRadar } from '@/lib/radar/executar'
import { repositorioRadar } from '@/lib/radar/repositorio'

export const runtime = 'nodejs'
// Uma busca + uma geração de teses, cada uma com teto de 100 s no cliente; a busca pode ter uma
// nova tentativa se o JSON vier fora do formato (3 x 100 s no pior caso). Máximo do plano Hobby.
export const maxDuration = 300

function sha256(v: string): Buffer {
  return createHash('sha256').update(v).digest()
}

/** O proxy deixa /api/cron/* passar sem cookie: esta é a única barreira. Falha fechada. */
function autorizado(request: Request): boolean {
  const segredo = process.env.CRON_SECRET
  if (!segredo) return false
  const recebido = request.headers.get('authorization') ?? ''
  return timingSafeEqual(sha256(recebido), sha256(`Bearer ${segredo}`))
}

export async function GET(request: Request) {
  if (!autorizado(request)) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  if (!iaConfigurada()) {
    return NextResponse.json({ status: 'nao_configurado', mensagem: 'chave de IA não configurada neste ambiente' })
  }
  // Sem `forcar`: uma nova tentativa da Vercel no mesmo dia, após um sucesso, não gasta de novo.
  const r = await executarRadar({ agora: new Date(), repo: repositorioRadar })
  return NextResponse.json({
    status: r.pulado ? (r.motivoPulo === 'em_execucao' ? 'em_execucao' : 'ja_executado_hoje') : r.erros.length > 0 ? 'erro' : 'ok',
    // Só números e classes de erro: nunca texto do modelo ou do provedor.
    coleta: r.coleta && { retornadas: r.coleta.retornadas, gravadas: r.coleta.gravadas, rejeitadas: r.coleta.rejeitadas },
    teses: r.teses,
    termosEmAlta: r.termos,
    erros: r.erros,
  })
}
