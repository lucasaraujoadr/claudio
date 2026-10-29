import { Pool } from '@neondatabase/serverless'
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless'
import * as schema from './schema'

type Db = NeonDatabase<typeof schema>

function createDb(): Db {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL não está definida')
  }
  return drizzle(new Pool({ connectionString: url }), { schema })
}

let _db: Db | undefined

export function getDb(): Db {
  if (!_db) _db = createDb()
  return _db
}
