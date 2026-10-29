import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { topics } from '@/lib/db/schema'

const MAX_QUERY = 200

function voltar(request: NextRequest, flag: 'criado' | 'existia' | 'erro') {
  return NextResponse.redirect(new URL(`/oportunidades?tema=${flag}`, request.url), 303)
}

export async function POST(request: NextRequest) {
  let query = ''
  try {
    const form = await request.formData()
    const valor = form.get('query')
    query = typeof valor === 'string' ? valor.trim() : ''
  } catch {
    return voltar(request, 'erro')
  }
  if (query.length === 0 || query.length > MAX_QUERY) return voltar(request, 'erro')

  try {
    const db = getDb()
    const criado = await db.transaction(async (tx) => {
      const [existente] = await tx
        .select({ id: topics.id })
        .from(topics)
        .where(eq(topics.keyword, query))
        .limit(1)
      if (existente) return false
      await tx.insert(topics).values({
        titulo: query,
        keyword: query,
        intencao: 'informacional',
        prioridade: 'media',
        status: 'ideia',
        origem: 'gsc',
      })
      return true
    })
    return voltar(request, criado ? 'criado' : 'existia')
  } catch (erro) {
    console.error('Falha ao criar tema a partir da query', erro)
    return voltar(request, 'erro')
  }
}
