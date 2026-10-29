import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import * as schema from '@/lib/db/schema'
import type { BancoCrm } from '../banco'

/** Como `banco-teste.ts`, mais as tabelas da integração com o Brevo (E8). */
export async function criarBancoTesteBrevo(): Promise<{ db: BancoCrm; fechar: () => Promise<void> }> {
  const pg = new PGlite()
  const tabelas = {
    contatoOrigem: schema.contatoOrigem,
    baseLegal: schema.baseLegal,
    contatoStatus: schema.contatoStatus,
    syncStatus: schema.syncStatus,
    eventoContatoTipo: schema.eventoContatoTipo,
    contatos: schema.contatos,
    eventosContato: schema.eventosContato,
    brevoEventosRecebidos: schema.brevoEventosRecebidos,
    sincronizacoes: schema.sincronizacoes,
  }
  const comandos = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(tabelas))
  for (const c of comandos) await pg.exec(c)
  const db = drizzle(pg, { schema }) as unknown as BancoCrm
  return { db, fechar: () => pg.close() }
}
