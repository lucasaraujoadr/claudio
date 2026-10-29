import { and, desc, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { artigos, tesesSugeridas, topics, type Artigo } from '@/lib/db/schema'
import { bancoPadrao, type BancoCrm } from '@/lib/crm/banco'

/** Um `gerando` parado além disso é considerado preso e pode ser reivindicado de novo. */
const MINUTOS_GERANDO_PRESO = 10

export type ResultadoReivindicacao =
  | { tipo: 'reivindicado'; artigoId: number; topicId: number }
  | { tipo: 'existe'; artigoId: number }
  | { tipo: 'nao_encontrado' }

type Transacao = Parameters<Parameters<BancoCrm['transaction']>[0]>[0]

/** Reivindicação atômica do tema: o índice único em `topic_id` deixa passar uma geração só. */
async function reivindicarTema(
  tx: Transacao,
  topicId: number,
  teseId: number | null,
  agora: Date,
): Promise<ResultadoReivindicacao> {
  const [inserido] = await tx
    .insert(artigos)
    .values({ topicId, teseId, situacao: 'gerando', criadoEm: agora, atualizadoEm: agora })
    .onConflictDoNothing({ target: artigos.topicId })
    .returning({ id: artigos.id })
  if (inserido) return { tipo: 'reivindicado', artigoId: inserido.id, topicId }

  const limite = new Date(agora.getTime() - MINUTOS_GERANDO_PRESO * 60_000)
  const [retomado] = await tx
    .update(artigos)
    .set({ situacao: 'gerando', erro: null, atualizadoEm: agora })
    .where(
      and(
        eq(artigos.topicId, topicId),
        or(
          eq(artigos.situacao, 'erro_geracao'),
          and(eq(artigos.situacao, 'gerando'), lt(artigos.atualizadoEm, limite)),
        ),
      ),
    )
    .returning({ id: artigos.id })
  if (retomado) return { tipo: 'reivindicado', artigoId: retomado.id, topicId }

  const [existente] = await tx.select({ id: artigos.id }).from(artigos).where(eq(artigos.topicId, topicId))
  return existente ? { tipo: 'existe', artigoId: existente.id } : { tipo: 'nao_encontrado' }
}

export async function reivindicarGeracao(
  origem: { topicId: number } | { teseId: number },
  agora: Date,
  db: BancoCrm = bancoPadrao(),
): Promise<ResultadoReivindicacao> {
  return db.transaction(async (tx) => {
    if ('topicId' in origem) {
      const [tema] = await tx.select({ id: topics.id }).from(topics).where(eq(topics.id, origem.topicId))
      if (!tema) return { tipo: 'nao_encontrado' }
      return reivindicarTema(tx, tema.id, null, agora)
    }

    const [tese] = await tx.select().from(tesesSugeridas).where(eq(tesesSugeridas.id, origem.teseId))
    if (!tese || tese.status === 'descartada') return { tipo: 'nao_encontrado' }

    // Mesma regra de `virarTema`: o índice único de keyword_normalizada decide se o tema já existe.
    await tx
      .insert(topics)
      .values({
        titulo: tese.titulo,
        keyword: tese.keyword,
        keywordNormalizada: tese.keywordNormalizada,
        intencao: tese.intencao,
        prioridade: 'media',
        status: 'ideia',
        origem: 'tendencia',
      })
      .onConflictDoNothing({ target: topics.keywordNormalizada })
    const [tema] = await tx
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.keywordNormalizada, tese.keywordNormalizada))
    if (!tema) return { tipo: 'nao_encontrado' }

    await tx
      .update(tesesSugeridas)
      .set({ status: 'virou_artigo' })
      .where(and(eq(tesesSugeridas.id, tese.id), inArray(tesesSugeridas.status, ['nova', 'virou_tema'])))
    return reivindicarTema(tx, tema.id, tese.id, agora)
  })
}

export async function concluirGeracao(
  id: number,
  dados: {
    titulo: string
    slug: string
    metaDescription: string
    conteudoHtml: string
    fontes: { titulo?: string; url: string }[]
    modelo: string
  },
  agora: Date,
  db: BancoCrm = bancoPadrao(),
): Promise<void> {
  await db
    .update(artigos)
    .set({ ...dados, situacao: 'rascunho', geradoEm: agora, erro: null, atualizadoEm: agora })
    .where(eq(artigos.id, id))
}

export async function falharGeracao(
  id: number,
  mensagem: string,
  agora: Date,
  db: BancoCrm = bancoPadrao(),
): Promise<void> {
  await db
    .update(artigos)
    .set({ situacao: 'erro_geracao', erro: mensagem, atualizadoEm: agora })
    .where(eq(artigos.id, id))
}

type CamposEditaveis = Partial<
  Pick<
    Artigo,
    | 'titulo'
    | 'slug'
    | 'metaDescription'
    | 'conteudoHtml'
    | 'categoriaId'
    | 'revisado'
    | 'agendadoPara'
    | 'capaMediaId'
    | 'capaUrl'
  >
>

function igual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  return a === b
}

export async function salvarEdicao(
  id: number,
  campos: CamposEditaveis,
  agora: Date,
  db: BancoCrm = bancoPadrao(),
): Promise<Artigo | null> {
  return db.transaction(async (tx) => {
    const [atual] = await tx.select().from(artigos).where(eq(artigos.id, id))
    if (!atual || atual.situacao === 'gerando') return null

    const { revisado, ...conteudo } = campos
    const mudouConteudo = (Object.keys(conteudo) as (keyof typeof conteudo)[]).some(
      (k) => conteudo[k] !== undefined && !igual(conteudo[k], atual[k]),
    )

    const set: Partial<typeof artigos.$inferInsert> = { ...conteudo, atualizadoEm: agora }
    if (revisado !== undefined) {
      set.revisado = revisado
      // `revisado` só move rascunho↔pronto; agendado/publicado mantêm a situação.
      if (atual.situacao === 'rascunho' || atual.situacao === 'pronto') {
        set.situacao = revisado ? 'pronto' : 'rascunho'
      }
    }
    if (atual.wpPostId !== null && mudouConteudo) set.alteradoAposEnvio = true

    const [novo] = await tx.update(artigos).set(set).where(eq(artigos.id, id)).returning()
    return novo ?? null
  })
}

export async function obterArtigo(id: number, db: BancoCrm = bancoPadrao()): Promise<Artigo | null> {
  const [a] = await db.select().from(artigos).where(eq(artigos.id, id))
  return a ?? null
}

export async function obterArtigoDoTema(topicId: number, db: BancoCrm = bancoPadrao()): Promise<Artigo | null> {
  const [a] = await db.select().from(artigos).where(eq(artigos.topicId, topicId))
  return a ?? null
}

export type ArtigoComKeyword = Artigo & { keyword: string }

export async function listarArtigos(
  filtro: { situacao?: Artigo['situacao'] } = {},
  db: BancoCrm = bancoPadrao(),
): Promise<ArtigoComKeyword[]> {
  const linhas = await db
    .select({ artigo: artigos, keyword: topics.keyword })
    .from(artigos)
    .innerJoin(topics, eq(topics.id, artigos.topicId))
    .where(filtro.situacao ? eq(artigos.situacao, filtro.situacao) : undefined)
    .orderBy(desc(artigos.atualizadoEm))
  return linhas.map((l) => ({ ...l.artigo, keyword: l.keyword }))
}

export async function registrarEnvio(
  id: number,
  r: { wpPostId: number; wpStatus: 'draft' | 'future' | 'publish'; wpLink: string; wpModificadoGmt: string },
  agora: Date,
  db: BancoCrm = bancoPadrao(),
): Promise<Artigo | null> {
  return db.transaction(async (tx) => {
    const [atual] = await tx.select().from(artigos).where(eq(artigos.id, id))
    if (!atual) return null
    const situacao =
      r.wpStatus === 'publish'
        ? 'publicado'
        : r.wpStatus === 'future'
          ? 'agendado'
          : atual.revisado
            ? 'pronto'
            : 'rascunho'
    const [novo] = await tx
      .update(artigos)
      .set({
        situacao,
        wpPostId: r.wpPostId,
        wpStatus: r.wpStatus,
        wpLink: r.wpLink,
        wpModificadoGmt: r.wpModificadoGmt,
        alteradoAposEnvio: false,
        erro: null,
        enviadoEm: agora,
        atualizadoEm: agora,
      })
      .where(eq(artigos.id, id))
      .returning()
    if (r.wpStatus === 'publish') {
      await tx.update(topics).set({ status: 'publicado', urlPublicada: r.wpLink }).where(eq(topics.id, atual.topicId))
    }
    return novo ?? null
  })
}

export async function registrarErroEnvio(
  id: number,
  mensagem: string,
  db: BancoCrm = bancoPadrao(),
): Promise<void> {
  await db.update(artigos).set({ erro: mensagem, atualizadoEm: new Date() }).where(eq(artigos.id, id))
}

export async function desvincularDoWp(id: number, db: BancoCrm = bancoPadrao()): Promise<Artigo | null> {
  return db.transaction(async (tx) => {
    const [atual] = await tx.select().from(artigos).where(eq(artigos.id, id))
    if (!atual) return null
    const [novo] = await tx
      .update(artigos)
      .set({
        wpPostId: null,
        wpStatus: null,
        wpLink: null,
        wpModificadoGmt: null,
        enviadoEm: null,
        alteradoAposEnvio: false,
        erro: null,
        situacao: atual.revisado ? 'pronto' : 'rascunho',
        atualizadoEm: new Date(),
      })
      .where(eq(artigos.id, id))
      .returning()
    return novo ?? null
  })
}

export async function listarAgendados(db: BancoCrm = bancoPadrao()): Promise<Artigo[]> {
  return db
    .select()
    .from(artigos)
    .where(and(eq(artigos.situacao, 'agendado'), isNotNull(artigos.wpPostId)))
}

/** Trava do envio: um envio por artigo por vez; uma trava com mais de 2 minutos é considerada solta. */
const MINUTOS_ENVIO_PRESO = 2

/** Devolve a marca da trava (para soltar só a própria) ou null se outro envio está em andamento. */
export async function reivindicarEnvio(id: number, agora: Date, db: BancoCrm = bancoPadrao()): Promise<Date | null> {
  const limite = new Date(agora.getTime() - MINUTOS_ENVIO_PRESO * 60_000)
  const r = await db
    .update(artigos)
    .set({ enviandoDesde: agora })
    .where(and(eq(artigos.id, id), or(isNull(artigos.enviandoDesde), lt(artigos.enviandoDesde, limite))))
    .returning({ id: artigos.id })
  return r.length > 0 ? agora : null
}

/** Solta só a trava com a mesma marca: um envio atrasado não apaga a de outro mais novo. */
export async function liberarEnvio(id: number, marca: Date, db: BancoCrm = bancoPadrao()): Promise<void> {
  await db.update(artigos).set({ enviandoDesde: null }).where(and(eq(artigos.id, id), eq(artigos.enviandoDesde, marca)))
}
