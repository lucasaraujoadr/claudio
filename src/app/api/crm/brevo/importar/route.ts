import { NextResponse, type NextRequest } from 'next/server'
import { ehBaseLegal } from '@/lib/crm/campos'
import { importarDoBrevo } from '@/lib/crm/sincronizar'

export const runtime = 'nodejs'
export const maxDuration = 120

/** "Importar contatos do Brevo" da tela de integração (atrás do login). */
export async function POST(request: NextRequest) {
  const voltar = (aviso: string) => NextResponse.redirect(new URL(`/crm/integracao?aviso=${aviso}`, request.url), 303)
  try {
    const form = await request.formData()
    const baseLegal = form.get('baseLegal')
    if (!ehBaseLegal(baseLegal)) return voltar('base-legal')
    const r = await importarDoBrevo({ baseLegal })
    if (!r.conectado) return voltar('nao-conectado')
    if (r.erro) return voltar('importacao-erro')
    return voltar(r.truncado ? 'importacao-parcial' : 'importacao-ok')
  } catch (e) {
    console.error('crm: importação do Brevo falhou:', e instanceof Error ? e.name : 'erro')
    return voltar('erro')
  }
}
