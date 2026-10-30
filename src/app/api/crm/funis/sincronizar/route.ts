import { NextResponse, type NextRequest } from 'next/server'
import { criarClienteBrevo } from '@/lib/brevo'
import { encerrarInscricoesDeDescadastrados } from '@/lib/crm/funis'
import { sincronizarPendentes } from '@/lib/crm/sincronizar'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * "Atualizar": tira dos funis quem se descadastrou e envia os contatos pendentes ao Brevo. As
 * listas do Brevo saíram (os funis são enviados pelo painel via Resend); o resto do Brevo sai no Task 7.
 */
export async function POST(request: NextRequest) {
  const voltar = (aviso: string) => NextResponse.redirect(new URL(`/crm/funis?aviso=${aviso}`, request.url), 303)
  try {
    const cliente = criarClienteBrevo()
    await encerrarInscricoesDeDescadastrados()
    if (!cliente.conectado) return voltar('nao-conectado')
    const contatos = await sincronizarPendentes({ cliente, limite: 200 })
    if (contatos.conectado && contatos.interrompido) return voltar('sync-interrompida')
    return voltar('sync-ok')
  } catch (e) {
    console.error('crm: atualizar contatos do Brevo falhou:', e instanceof Error ? e.name : 'erro')
    return voltar('erro')
  }
}
