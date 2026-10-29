import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '@/lib/db/schema'
import { getDb } from '@/lib/db'

/**
 * Qualquer banco Drizzle de Postgres com o schema do painel: o Neon em produção, o
 * PGlite nos testes. As funções do CRM recebem o banco como parâmetro opcional.
 */
export type BancoCrm = PgDatabase<PgQueryResultHKT, typeof schema>

export function bancoPadrao(): BancoCrm {
  return getDb() as unknown as BancoCrm
}
