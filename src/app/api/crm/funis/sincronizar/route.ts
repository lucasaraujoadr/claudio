import { NextResponse, type NextRequest } from 'next/server'
import { encerrarInscricoesDeDescadastrados } from '@/lib/crm/funis'
import { sincronizarPendentes } from '@/lib/crm/sincronizar'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * "Atualizar": tira dos funis quem se descadastrou e sincroniza com o Resend os contatos
 * pendentes (segmento da newsletter e descadastros). Os funis são enviados pelo painel via Resend.
 */
export async function POST(request: NextRequest) {
  const voltar = (aviso: string) => NextResponse.redirect(new URL(`/crm/funis?aviso=${aviso}`, request.url), 303)
  try {
    await encerrarInscricoesDeDescadastrados()
    const contatos = await sincronizarPendentes({ limite: 200 })
    if (!contatos.conectado) return voltar('nao-conectado')
    if (contatos.interrompido) return voltar('sync-interrompida')
    return voltar(contatos.restantes > 0 ? 'sync-parcial' : 'sync-ok')
  } catch (e) {
    console.error('crm: atualizar contatos no Resend falhou:', e instanceof Error ? e.name : 'erro')
    return voltar('erro')
  }
}
