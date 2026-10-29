import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import * as schema from '@/lib/db/schema'
import type { BancoCrm } from '../banco'

/**
 * Postgres real em memória (PGlite) com as tabelas do CRM geradas a partir do próprio
 * `schema.ts` pelo drizzle-kit: o teste não mantém um DDL paralelo que possa divergir.
 */
export async function criarBancoTeste(): Promise<{ db: BancoCrm; fechar: () => Promise<void> }> {
  const pg = new PGlite()
  const crm = {
    contatoOrigem: schema.contatoOrigem,
    baseLegal: schema.baseLegal,
    contatoStatus: schema.contatoStatus,
    syncStatus: schema.syncStatus,
    eventoContatoTipo: schema.eventoContatoTipo,
    contatos: schema.contatos,
    eventosContato: schema.eventosContato,
    importacoesContatos: schema.importacoesContatos,
  }
  const comandos = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(crm))
  for (const c of comandos) await pg.exec(c)
  const db = drizzle(pg, { schema }) as unknown as BancoCrm
  return { db, fechar: () => pg.close() }
}
