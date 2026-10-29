import { NextResponse, type NextRequest } from 'next/server'
import { sincronizarPendentes } from '@/lib/crm/sincronizar'

export const runtime = 'nodejs'
export const maxDuration = 120

/** "Sincronizar agora" da tela de integração (atrás do login). */
export async function POST(request: NextRequest) {
  const voltar = (aviso: string) => NextResponse.redirect(new URL(`/crm/integracao?aviso=${aviso}`, request.url), 303)
  try {
    const r = await sincronizarPendentes()
    if (!r.conectado) return voltar('nao-conectado')
    if (r.interrompido) return voltar('sync-interrompida')
    return voltar(r.erros > 0 || r.restantes > 0 ? 'sync-parcial' : 'sync-ok')
  } catch (e) {
    console.error('crm: sincronização com o Brevo falhou:', e instanceof Error ? e.name : 'erro')
    return voltar('erro')
  }
}
