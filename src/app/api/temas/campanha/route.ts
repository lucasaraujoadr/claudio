import { NextResponse, type NextRequest } from 'next/server'
import { lerId } from '@/lib/crm/formulario'
import { criarRascunhoCampanhaBlog } from '@/lib/crm/funis-campanha'

export const runtime = 'nodejs'

/**
 * Cria um **rascunho** de campanha no Brevo para a lista da nutrição com o blog. Nunca envia
 * nem agenda: o envio é feito pelo usuário no Brevo, depois de revisar.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null)
  const id = lerId(typeof form?.get('id') === 'string' ? String(form.get('id')) : '')
  if (!id) return NextResponse.redirect(new URL('/temas', request.url), 303)
  const voltar = (aviso: string, extra = '') => NextResponse.redirect(new URL(`/temas/${id}/campanha?aviso=${aviso}${extra}`, request.url), 303)
  try {
    const r = await criarRascunhoCampanhaBlog(id)
    if (r.ok) return voltar('criada', `&campanha=${r.campanhaId}`)
    if (r.motivo === 'brevo') console.error('temas: rascunho de campanha recusado:', r.mensagem ?? 'brevo')
    return voltar(r.motivo.replace('_', '-'))
  } catch (e) {
    console.error('temas: rascunho de campanha falhou:', e instanceof Error ? e.name : 'erro')
    return voltar('erro')
  }
}
