import { Pool } from '@neondatabase/serverless'
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless'
import * as schema from './schema'

type Db = NeonDatabase<typeof schema>

function createDb(): Db {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL não está definida')
  }
  const pool = new Pool({ connectionString: url })
  // Um cliente ocioso que perde a conexão (ex.: o Neon suspende o compute) emite
  // 'error' no pool; sem ouvinte, isso derruba o processo. Só o nome: a mensagem pode
  // ecoar a string de conexão.
  pool.on('error', (e: unknown) => {
    console.error('pool do banco: erro em cliente ocioso:', e instanceof Error ? e.name : 'erro')
  })
  return drizzle(pool, { schema })
}

let _db: Db | undefined

export function getDb(): Db {
  if (!_db) _db = createDb()
  return _db
}
