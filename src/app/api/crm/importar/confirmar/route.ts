import { NextResponse, type NextRequest } from 'next/server'
import { lerBaseLegal, lerMapeamento, lerTags } from '@/lib/crm/formulario'
import { confirmarLote } from '@/lib/crm/importacao'

export const runtime = 'nodejs'
// Até 5 000 linhas numa transação, em blocos de 500.
export const maxDuration = 120

/**
 * Confirma o lote: só o id, o mapeamento, a base legal e as tags vêm do navegador; as
 * linhas são relidas do servidor.
 */
export async function POST(request: NextRequest) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.redirect(new URL('/crm/importar?erro=erro', request.url), 303)
  }
  const lote = String(form.get('lote') ?? '')
  const voltar = (aviso: string) =>
    NextResponse.redirect(new URL(`/crm/importar?lote=${encodeURIComponent(lote)}&aviso=${aviso}`, request.url), 303)
  const baseLegal = lerBaseLegal(form)
  if (!baseLegal) return voltar('base-legal')
  const mapa = lerMapeamento(form)
  if (!mapa) return voltar('mapa_invalido')
  try {
    const r = await confirmarLote(lote, mapa, { baseLegal, tags: lerTags(form) })
    if (!r.ok) return voltar(r.motivo)
    return voltar('concluida')
  } catch (e) {
    console.error('crm: importação falhou:', e instanceof Error ? e.name : 'erro')
    return voltar('erro')
  }
}
