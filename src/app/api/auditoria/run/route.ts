import { NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { auditIssues, auditPages, auditRuns } from '@/lib/db/schema'
import { rastrear } from '@/lib/crawler/crawl'
import { avaliar, type Problema } from '@/lib/crawler/rules'
import { MINUTOS_ATE_RUN_TRAVADA, REGRA_INTERROMPIDO } from '@/lib/auditoria'

export const maxDuration = 300

const SITE = 'https://ogpericiacontabil.com.br'


export async function POST() {
  const db = getDb()

  // Uma run presa em `rodando` (função morta no meio do rastreio) não pode bloquear
  // a auditoria para sempre.
  await db
    .update(auditRuns)
    .set({ status: 'falhou', finalizadoEm: sql`now()` })
    .where(
      sql`${auditRuns.status} = 'rodando' and ${auditRuns.iniciadoEm} < now() - make_interval(mins => ${MINUTOS_ATE_RUN_TRAVADA})`,
    )

  // Insere só se não houver outra run em andamento (uma única instrução).
  const criadas = await db.execute<{ id: number }>(
    sql`insert into audit_runs (status) select 'rodando' where not exists (select 1 from audit_runs where status = 'rodando') returning id`,
  )
  const runId = criadas.rows[0]?.id
  if (runId === undefined) {
    return NextResponse.json({ erro: 'Já existe um rastreamento em andamento.' }, { status: 409 })
  }

  try {
    const { paginas, ctx, truncado } = await rastrear({ siteUrl: SITE })
    const problemas: Problema[] = avaliar(paginas, ctx)
    if (truncado) {
      problemas.push({
        url: null,
        severidade: 'aviso',
        regra: REGRA_INTERROMPIDO,
        mensagem: `Rastreamento interrompido por tempo após ${paginas.length} páginas; a auditoria está incompleta`,
      })
    }

    const entrantes = new Map<string, number>()
    for (const p of paginas) {
      for (const link of p.linksInternos) {
        if (link !== p.url) entrantes.set(link, (entrantes.get(link) ?? 0) + 1)
      }
    }

    await db.transaction(async (tx) => {
      const idPorUrl = new Map<string, number>()
      if (paginas.length > 0) {
        const inseridas = await tx
          .insert(auditPages)
          .values(
            paginas.map((p) => ({
              runId,
              url: p.url,
              statusCode: p.statusCode,
              title: p.title,
              metaDescription: p.metaDescription,
              h1Count: p.h1Textos.length,
              h1Texto: p.h1Textos[0] ?? null,
              palavras: p.palavras,
              canonical: p.canonical,
              noindex: p.noindex,
              linksEntrando: entrantes.get(p.url) ?? 0,
              linksSaindo: p.linksInternos.length,
              schemaTypes: p.schemaTypes,
              imagensSemAlt: p.imagensSemAlt,
            })),
          )
          .returning({ id: auditPages.id, url: auditPages.url })
        for (const linha of inseridas) idPorUrl.set(linha.url, linha.id)
      }

      if (problemas.length > 0) {
        await tx.insert(auditIssues).values(
          problemas.map((p) => ({
            runId,
            pageId: p.url === null ? null : (idPorUrl.get(p.url) ?? null),
            severidade: p.severidade,
            regra: p.regra,
            mensagem: p.mensagem,
          })),
        )
      }

      await tx
        .update(auditRuns)
        .set({ status: 'concluido', finalizadoEm: sql`now()`, paginasRastreadas: paginas.length })
        .where(eq(auditRuns.id, runId))
    })

    return NextResponse.json({ runId, paginas: paginas.length, problemas: problemas.length })
  } catch (erro) {
    console.error('Falha no rastreamento', erro)
    // Fora da transação revertida, para o status sobreviver; a run anterior segue intacta.
    try {
      await db
        .update(auditRuns)
        .set({ status: 'falhou', finalizadoEm: sql`now()` })
        .where(eq(auditRuns.id, runId))
    } catch (erroStatus) {
      // A run fica em `rodando` até a regra de 15 minutos tratá-la como morta.
      console.error('Não foi possível registrar a falha da run', erroStatus)
    }
    return NextResponse.json({ erro: 'O rastreamento falhou. Tente novamente.' }, { status: 500 })
  }
}
