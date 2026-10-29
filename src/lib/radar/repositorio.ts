import { and, asc, desc, eq, gte, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { gscSnapshots, sincronizacoes, tendencias, tesesSugeridas, topics } from '@/lib/db/schema'
import { FONTE_RADAR, type Reivindicacao, type RepositorioRadar } from './executar'
import { calcularTermosEmAlta, escolherDatas, type LinhaTermo, type TermosEmAlta } from './termos-em-alta'

const MAX_TENDENCIAS_NO_PROMPT = 30
/** Um `rodando` mais antigo que isto é execução morta (maxDuration é 5 min) e pode ser retomada. */
const MINUTOS_RODANDO_VALE = 6

async function impressoesPorQuery(data: string): Promise<LinhaTermo[]> {
  const rows = await getDb()
    .select({ query: gscSnapshots.query, impressoes: sql<number>`sum(${gscSnapshots.impressions})::int` })
    .from(gscSnapshots)
    .where(eq(gscSnapshots.snapshotDate, data))
    .groupBy(gscSnapshots.query)
  return rows
}

export async function carregarTermosEmAlta(): Promise<TermosEmAlta> {
  const linhas = await getDb().selectDistinct({ data: gscSnapshots.snapshotDate }).from(gscSnapshots)
  const datas = escolherDatas(linhas.map((l) => l.data))
  if (!datas) return { estado: 'sem_dados', termos: [] }
  if (!datas.anterior) return { estado: 'sem_janela_anterior', termos: [], atual: datas.atual }
  const [atual, anterior] = await Promise.all([impressoesPorQuery(datas.atual), impressoesPorQuery(datas.anterior)])
  return { estado: 'ok', termos: calcularTermosEmAlta(atual, anterior), atual: datas.atual, anterior: datas.anterior }
}

export const repositorioRadar: RepositorioRadar = {
  async ultimaExecucao() {
    const [r] = await getDb().select().from(sincronizacoes).where(eq(sincronizacoes.fonte, FONTE_RADAR)).limit(1)
    return r ? { status: r.status, executadoEm: r.executadoEm, ultimoOkEm: r.ultimoOkEm, mensagem: r.mensagem } : null
  },

  async reivindicar(agora, forcar): Promise<Reivindicacao> {
    const db = getDb()
    const limiteRodando = new Date(agora.getTime() - MINUTOS_RODANDO_VALE * 60_000)
    const dia = (c: unknown) => sql`((${c} at time zone 'America/Sao_Paulo')::date)`
    const agoraSql = sql`${agora.toISOString()}::timestamptz`
    const hojeFechado = forcar ? sql`false` : sql`(${sincronizacoes.ultimoOkEm} is not null and ${dia(sincronizacoes.ultimoOkEm)} = ${dia(agoraSql)})`
    // Uma só instrução: duas requisições simultâneas não passam as duas pela condição.
    const r = await db
      .insert(sincronizacoes)
      .values({ fonte: FONTE_RADAR, status: 'rodando', mensagem: null, executadoEm: agora, linhas: null })
      .onConflictDoUpdate({
        target: sincronizacoes.fonte,
        set: { status: 'rodando', mensagem: null, executadoEm: agora },
        setWhere: sql`not (${sincronizacoes.status} = 'rodando' and ${sincronizacoes.executadoEm} > ${limiteRodando.toISOString()}::timestamptz) and not ${hojeFechado}`,
      })
      .returning({ fonte: sincronizacoes.fonte })
    if (r.length > 0) return 'reivindicado'
    const [atual] = await db.select().from(sincronizacoes).where(eq(sincronizacoes.fonte, FONTE_RADAR)).limit(1)
    return atual && atual.status === 'rodando' && atual.executadoEm > limiteRodando ? 'em_execucao' : 'ja_rodou'
  },

  async gravarTendencias(itens, agora) {
    if (itens.length === 0) return 0
    const r = await getDb()
      .insert(tendencias)
      .values(
        itens.map((t) => ({
          titulo: t.titulo,
          resumo: t.resumo,
          fonteUrl: t.fonteUrl,
          publicadoEm: t.publicadoEm,
          palavrasChave: t.palavrasChave,
          coletadoEm: agora,
          hash: t.hash,
        })),
      )
      .onConflictDoNothing({ target: tendencias.hash })
      .returning({ id: tendencias.id })
    return r.length
  },

  async tendenciasRecentes(dias, agora) {
    const desde = new Date(agora.getTime() - dias * 86_400_000)
    const rows = await getDb()
      .select()
      .from(tendencias)
      .where(gte(tendencias.coletadoEm, desde))
      .orderBy(desc(tendencias.coletadoEm), desc(tendencias.id))
      .limit(MAX_TENDENCIAS_NO_PROMPT)
    return rows.map((t) => ({ id: t.id, titulo: t.titulo, resumo: t.resumo, publicadoEm: t.publicadoEm, palavrasChave: t.palavrasChave }))
  },

  termosEmAlta: carregarTermosEmAlta,

  async keywordsExistentes() {
    const db = getDb()
    const [t, s] = await Promise.all([
      db.select({ k: topics.keyword }).from(topics).orderBy(asc(topics.id)),
      db.select({ k: tesesSugeridas.keyword }).from(tesesSugeridas).orderBy(asc(tesesSugeridas.id)),
    ])
    return [...t.map((x) => x.k), ...s.map((x) => x.k)]
  },

  async gravarTeses(itens) {
    if (itens.length === 0) return 0
    const r = await getDb()
      .insert(tesesSugeridas)
      .values(
        itens.map((t) => ({
          tendenciaId: t.tendenciaId,
          titulo: t.titulo,
          keyword: t.keyword,
          keywordNormalizada: t.keywordNormalizada,
          intencao: t.intencao,
          justificativa: t.justificativa,
          potencial: t.potencial,
          sinais: t.sinais,
        })),
      )
      // Duas execuções concorrentes (cron e botão): o índice único decide, sem derrubar a outra.
      .onConflictDoNothing({ target: tesesSugeridas.keywordNormalizada })
      .returning({ id: tesesSugeridas.id })
    return r.length
  },

  async registrar(r) {
    await getDb()
      .insert(sincronizacoes)
      .values({ ...r, ultimoOkEm: r.status === 'ok' ? r.executadoEm : null })
      .onConflictDoUpdate({
        target: sincronizacoes.fonte,
        set: {
          status: r.status,
          mensagem: r.mensagem,
          executadoEm: r.executadoEm,
          linhas: r.linhas,
          // Só um sucesso avança o marcador; um erro mantém o do último sucesso.
          ...(r.status === 'ok' ? { ultimoOkEm: r.executadoEm } : {}),
        },
      })
  },
}

/** Marca a tese como virou_tema/descartada e cria o tema; tudo numa transação. */
export type ResultadoVirarTema = 'criado' | 'existia' | 'ja_tratada'

export async function virarTema(id: number): Promise<ResultadoVirarTema> {
  return getDb().transaction(async (tx) => {
    // Primeiro a transição de estado: dois cliques na mesma tese só deixam passar um.
    const [tese] = await tx
      .update(tesesSugeridas)
      .set({ status: 'virou_tema' })
      .where(and(eq(tesesSugeridas.id, id), eq(tesesSugeridas.status, 'nova')))
      .returning()
    if (!tese) return 'ja_tratada'
    const inseridos = await tx
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
      // Mesmo índice único das outras origens: o assunto já cadastrado não vira segundo tema.
      .onConflictDoNothing({ target: topics.keywordNormalizada })
      .returning({ id: topics.id })
    return inseridos.length > 0 ? 'criado' : 'existia'
  })
}

export async function descartarTese(id: number): Promise<boolean> {
  const r = await getDb()
    .update(tesesSugeridas)
    .set({ status: 'descartada' })
    .where(and(eq(tesesSugeridas.id, id), eq(tesesSugeridas.status, 'nova')))
    .returning({ id: tesesSugeridas.id })
  return r.length > 0
}
