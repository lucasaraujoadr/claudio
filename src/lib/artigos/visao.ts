import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { topics, type Artigo } from '@/lib/db/schema'
import { conferir } from './conferencia'

export async function keywordDoTema(topicId: number): Promise<string> {
  const [t] = await getDb().select({ keyword: topics.keyword }).from(topics).where(eq(topics.id, topicId)).limit(1)
  return t?.keyword ?? ''
}

/** Artigo + conferência de SEO + keyword, como as rotas devolvem. */
export function montarVisao(a: Artigo, keyword: string) {
  const conferencia = conferir({
    titulo: a.titulo ?? '',
    slug: a.slug ?? '',
    metaDescription: a.metaDescription ?? '',
    conteudoHtml: a.conteudoHtml ?? '',
    keyword,
    categoriaId: a.categoriaId,
    capaMediaId: a.capaMediaId,
    revisado: a.revisado,
  })
  return { ...a, keyword, conferencia }
}

export function idDaRota(bruto: string): number | null {
  const n = Number(bruto)
  return Number.isInteger(n) && n > 0 ? n : null
}
