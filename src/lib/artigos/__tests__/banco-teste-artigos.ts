import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import * as schema from '@/lib/db/schema'
import type { BancoCrm } from '@/lib/crm/banco'

/**
 * Postgres real em memória (PGlite) com as tabelas do módulo de artigos geradas a partir
 * do próprio `schema.ts` pelo drizzle-kit (mesmo método de `criarBancoTeste` do CRM).
 */
export async function criarBancoTesteArtigos(): Promise<{ db: BancoCrm; fechar: () => Promise<void> }> {
  const pg = new PGlite()
  const tabelas = {
    intencao: schema.intencao,
    prioridade: schema.prioridade,
    clusterStatus: schema.clusterStatus,
    topicStatus: schema.topicStatus,
    topicOrigem: schema.topicOrigem,
    potencial: schema.potencial,
    teseStatus: schema.teseStatus,
    artigoSituacao: schema.artigoSituacao,
    newsletterSituacao: schema.newsletterSituacao,
    pecaTipo: schema.pecaTipo,
    pecaSituacao: schema.pecaSituacao,
    clusters: schema.clusters,
    topics: schema.topics,
    briefings: schema.briefings,
    tendencias: schema.tendencias,
    tesesSugeridas: schema.tesesSugeridas,
    artigos: schema.artigos,
    newslettersEnvios: schema.newslettersEnvios,
    pecasDistribuicao: schema.pecasDistribuicao,
  }
  const comandos = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(tabelas))
  for (const c of comandos) await pg.exec(c)
  const db = drizzle(pg, { schema }) as unknown as BancoCrm
  return { db, fechar: () => pg.close() }
}
