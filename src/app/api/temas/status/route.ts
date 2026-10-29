import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { topics } from '@/lib/db/schema'
import { urlPublicadaValida } from '@/lib/url-publicada'

export const runtime = 'nodejs'

type Flag = 'escolhido' | 'publicado' | 'url-invalida' | 'erro'

function voltar(request: NextRequest, flag: Flag) {
  return NextResponse.redirect(new URL(`/temas?status=${flag}`, request.url), 303)
}

export async function POST(request: NextRequest) {
  let id = NaN
  let para = ''
  let url = ''
  try {
    const form = await request.formData()
    id = Number(form.get('id'))
    para = String(form.get('para') ?? '')
    url = String(form.get('url') ?? '').trim()
  } catch {
    return voltar(request, 'erro')
  }
  if (!Number.isInteger(id) || id <= 0) return voltar(request, 'erro')

  try {
    const db = getDb()
    if (para === 'escolhido') {
      const r = await db
        .update(topics)
        .set({ status: 'escolhido' })
        .where(and(eq(topics.id, id), eq(topics.status, 'ideia')))
        .returning({ id: topics.id })
      return voltar(request, r.length > 0 ? 'escolhido' : 'erro')
    }
    if (para === 'publicado') {
      if (!urlPublicadaValida(url)) return voltar(request, 'url-invalida')
      const r = await db
        .update(topics)
        .set({ status: 'publicado', urlPublicada: url })
        .where(and(eq(topics.id, id), eq(topics.status, 'briefado')))
        .returning({ id: topics.id })
      return voltar(request, r.length > 0 ? 'publicado' : 'erro')
    }
    return voltar(request, 'erro')
  } catch (erro) {
    console.error('Falha ao mudar status do tema', erro)
    return voltar(request, 'erro')
  }
}
