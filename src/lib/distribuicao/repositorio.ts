import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { bancoPadrao, type BancoCrm } from '@/lib/crm/banco'
import { artigos, pecasDistribuicao, topics, type PecaDistribuicao } from '@/lib/db/schema'
import { SCHEMAS_ESTRITOS, type ConteudoPeca, type TipoPeca } from './schemas'

/** Uma peça `gerando` parada além disso é considerada presa e pode ser reivindicada de novo. */
const MINUTOS_GERANDO_PRESO = 10

export type ResultadoReivindicacaoPeca =
  | { tipo: 'reivindicada'; pecaId: number }
  | { tipo: 'em_andamento' | 'publicada'; pecaId: number }

/**
 * Reivindicação atômica por (artigo, tipo): o índice único deixa passar uma geração só.
 * Peça em erro, em rascunho (regerar) ou presa em `gerando` pode ser reivindicada de novo;
 * a publicada não.
 */
export async function reivindicarPeca(
  artigoId: number,
  tipo: TipoPeca,
  agora: Date,
  db: BancoCrm = bancoPadrao(),
): Promise<ResultadoReivindicacaoPeca> {
  return db.transaction(async (tx) => {
    const [inserida] = await tx
      .insert(pecasDistribuicao)
      .values({ artigoId, tipo, situacao: 'gerando', criadoEm: agora, atualizadoEm: agora })
      .onConflictDoNothing({ target: [pecasDistribuicao.artigoId, pecasDistribuicao.tipo] })
      .returning({ id: pecasDistribuicao.id })
    if (inserida) return { tipo: 'reivindicada', pecaId: inserida.id }

    const limite = new Date(agora.getTime() - MINUTOS_GERANDO_PRESO * 60_000)
    const [retomada] = await tx
      .update(pecasDistribuicao)
      .set({ situacao: 'gerando', erro: null, atualizadoEm: agora })
      .where(
        and(
          eq(pecasDistribuicao.artigoId, artigoId),
          eq(pecasDistribuicao.tipo, tipo),
          or(
            inArray(pecasDistribuicao.situacao, ['erro', 'rascunho']),
            and(eq(pecasDistribuicao.situacao, 'gerando'), lt(pecasDistribuicao.atualizadoEm, limite)),
          ),
        ),
      )
      .returning({ id: pecasDistribuicao.id })
    if (retomada) return { tipo: 'reivindicada', pecaId: retomada.id }

    const [existente] = await tx
      .select({ id: pecasDistribuicao.id, situacao: pecasDistribuicao.situacao })
      .from(pecasDistribuicao)
      .where(and(eq(pecasDistribuicao.artigoId, artigoId), eq(pecasDistribuicao.tipo, tipo)))
    return { tipo: existente?.situacao === 'publicado' ? 'publicada' : 'em_andamento', pecaId: existente?.id ?? 0 }
  })
}

/** Grava o resultado da geração. A variação do carrossel já escolhida é mantida. */
export async function concluirPeca(
  id: number,
  dados: { conteudo: ConteudoPeca; modelo: string; variacao?: 'escura' | 'clara' | null },
  agora: Date,
  db: BancoCrm = bancoPadrao(),
): Promise<void> {
  await db
    .update(pecasDistribuicao)
    .set({
      conteudo: dados.conteudo,
      modelo: dados.modelo,
      variacao: dados.variacao ? sql`coalesce(${pecasDistribuicao.variacao}, ${dados.variacao})` : undefined,
      situacao: 'rascunho',
      erro: null,
      atualizadoEm: agora,
    })
    .where(and(eq(pecasDistribuicao.id, id), eq(pecasDistribuicao.situacao, 'gerando')))
}

export async function falharPeca(
  id: number,
  mensagem: string,
  agora: Date,
  db: BancoCrm = bancoPadrao(),
): Promise<void> {
  await db
    .update(pecasDistribuicao)
    .set({ situacao: 'erro', erro: mensagem, atualizadoEm: agora })
    .where(and(eq(pecasDistribuicao.id, id), eq(pecasDistribuicao.situacao, 'gerando')))
}

/** Edição manual: valida pelo schema estrito do tipo da peça (lança se inválido). Null se não existe ou está gerando. */
export async function salvarPeca(
  id: number,
  conteudo: unknown,
  agora: Date = new Date(),
  db: BancoCrm = bancoPadrao(),
): Promise<PecaDistribuicao | null> {
  const [atual] = await db.select().from(pecasDistribuicao).where(eq(pecasDistribuicao.id, id))
  if (!atual || atual.situacao === 'gerando') return null
  const valido = SCHEMAS_ESTRITOS[atual.tipo].parse(conteudo)
  const [nova] = await db
    .update(pecasDistribuicao)
    .set({
      conteudo: valido,
      // Peça com erro que ganha conteúdo válido vira rascunho; publicada continua publicada.
      situacao: atual.situacao === 'erro' ? 'rascunho' : atual.situacao,
      erro: null,
      atualizadoEm: agora,
    })
    .where(and(eq(pecasDistribuicao.id, id), sql`${pecasDistribuicao.situacao} <> 'gerando'`))
    .returning()
  return nova ?? null
}

export async function marcarPublicada(
  id: number,
  url: string | null,
  agora: Date = new Date(),
  db: BancoCrm = bancoPadrao(),
): Promise<PecaDistribuicao | null> {
  const [nova] = await db
    .update(pecasDistribuicao)
    .set({ situacao: 'publicado', publicadoEm: agora, urlPublicada: url, atualizadoEm: agora })
    .where(and(eq(pecasDistribuicao.id, id), sql`${pecasDistribuicao.situacao} <> 'gerando'`))
    .returning()
  return nova ?? null
}

export async function pecasDoArtigo(artigoId: number, db: BancoCrm = bancoPadrao()): Promise<PecaDistribuicao[]> {
  return db
    .select()
    .from(pecasDistribuicao)
    .where(eq(pecasDistribuicao.artigoId, artigoId))
    .orderBy(pecasDistribuicao.id)
}

export type PecaComArtigo = PecaDistribuicao & { artigoTitulo: string | null; keyword: string }

export async function listarDistribuicao(db: BancoCrm = bancoPadrao()): Promise<PecaComArtigo[]> {
  const linhas = await db
    .select({ peca: pecasDistribuicao, artigoTitulo: artigos.titulo, keyword: topics.keyword })
    .from(pecasDistribuicao)
    .innerJoin(artigos, eq(artigos.id, pecasDistribuicao.artigoId))
    .innerJoin(topics, eq(topics.id, artigos.topicId))
    .orderBy(desc(pecasDistribuicao.atualizadoEm))
  return linhas.map((l) => ({ ...l.peca, artigoTitulo: l.artigoTitulo, keyword: l.keyword }))
}

export type PecaComSlug = PecaDistribuicao & { artigoSlug: string | null }

export async function obterPeca(id: number, db: BancoCrm = bancoPadrao()): Promise<PecaComSlug | null> {
  const [linha] = await db
    .select({ peca: pecasDistribuicao, artigoSlug: artigos.slug })
    .from(pecasDistribuicao)
    .innerJoin(artigos, eq(artigos.id, pecasDistribuicao.artigoId))
    .where(eq(pecasDistribuicao.id, id))
  return linha ? { ...linha.peca, artigoSlug: linha.artigoSlug } : null
}

/** Troca a variação (escura/clara) do carrossel. Null se a peça não existe ou está gerando. */
export async function definirVariacao(
  id: number,
  variacao: 'escura' | 'clara',
  agora: Date = new Date(),
  db: BancoCrm = bancoPadrao(),
): Promise<PecaDistribuicao | null> {
  const [nova] = await db
    .update(pecasDistribuicao)
    .set({ variacao, atualizadoEm: agora })
    .where(and(eq(pecasDistribuicao.id, id), eq(pecasDistribuicao.tipo, 'carrossel'), sql`${pecasDistribuicao.situacao} <> 'gerando'`))
    .returning()
  return nova ?? null
}
