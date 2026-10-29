import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import * as schema from '@/lib/db/schema'
import type { BancoCrm } from '../banco'

/** Banco em memória com CRM, funis e temas/briefings (para o rascunho de campanha). */
export async function criarBancoTesteFunis(): Promise<{ db: BancoCrm; pg: PGlite; fechar: () => Promise<void> }> {
  const pg = new PGlite()
  const tabelas = {
    intencao: schema.intencao,
    prioridade: schema.prioridade,
    clusterStatus: schema.clusterStatus,
    topicStatus: schema.topicStatus,
    topicOrigem: schema.topicOrigem,
    clusters: schema.clusters,
    topics: schema.topics,
    briefings: schema.briefings,
    contatoOrigem: schema.contatoOrigem,
    baseLegal: schema.baseLegal,
    contatoStatus: schema.contatoStatus,
    syncStatus: schema.syncStatus,
    eventoContatoTipo: schema.eventoContatoTipo,
    contatos: schema.contatos,
    importacoesContatos: schema.importacoesContatos,
    eventosContato: schema.eventosContato,
    brevoEventosRecebidos: schema.brevoEventosRecebidos,
    sincronizacoes: schema.sincronizacoes,
    funilInscricaoStatus: schema.funilInscricaoStatus,
    funis: schema.funis,
    funilInscricoes: schema.funilInscricoes,
  }
  const comandos = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(tabelas))
  for (const c of comandos) await pg.exec(c)
  const db = drizzle(pg, { schema }) as unknown as BancoCrm
  return { db, pg, fechar: () => pg.close() }
}
