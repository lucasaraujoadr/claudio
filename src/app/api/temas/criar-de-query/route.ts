import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { topics } from '@/lib/db/schema'
import { normalizarKeyword } from '@/lib/keyword'

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
  const keywordNormalizada = normalizarKeyword(query)
  if (keywordNormalizada.length === 0 || query.length > MAX_QUERY) return voltar(request, 'erro')

  try {
    // O índice único em keyword_normalizada decide: um duplo clique, uma corrida ou o
    // mesmo assunto com outra grafia não cria um segundo tema.
    const inseridos = await getDb()
      .insert(topics)
      .values({
        titulo: query,
        keyword: query,
        keywordNormalizada,
        intencao: 'informacional',
        prioridade: 'media',
        status: 'ideia',
        origem: 'gsc',
      })
      .onConflictDoNothing({ target: topics.keywordNormalizada })
      .returning({ id: topics.id })
    return voltar(request, inseridos.length > 0 ? 'criado' : 'existia')
  } catch (erro) {
    console.error('Falha ao criar tema a partir da query', erro)
    return voltar(request, 'erro')
  }
}
