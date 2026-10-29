import { NextResponse, type NextRequest } from 'next/server'
import { criarClienteBrevo } from '@/lib/brevo'
import { encerrarInscricoesDeDescadastrados, sincronizarInscricoes } from '@/lib/crm/funis'
import { sincronizarPendentes } from '@/lib/crm/sincronizar'

export const runtime = 'nodejs'
export const maxDuration = 120

/** "Atualizar listas do Brevo": envia os contatos pendentes e depois as inscrições pendentes. */
export async function POST(request: NextRequest) {
  const voltar = (aviso: string) => NextResponse.redirect(new URL(`/crm/funis?aviso=${aviso}`, request.url), 303)
  try {
    const cliente = criarClienteBrevo()
    await encerrarInscricoesDeDescadastrados()
    if (!cliente.conectado) return voltar('nao-conectado')
    const contatos = await sincronizarPendentes({ cliente, limite: 200 })
    if (contatos.conectado && contatos.interrompido) return voltar('sync-interrompida')
    const r = await sincronizarInscricoes({ cliente })
    if (!r.conectado) return voltar('nao-conectado')
    if (r.interrompido) return voltar('sync-interrompida')
    return voltar(r.erros > 0 || r.semLista > 0 || r.aguardandoContato > 0 ? 'sync-parcial' : 'sync-ok')
  } catch (e) {
    console.error('crm: atualizar listas do Brevo falhou:', e instanceof Error ? e.name : 'erro')
    return voltar('erro')
  }
}
