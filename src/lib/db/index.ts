import { neon } from '@neondatabase/serverless'
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http'
import * as schema from './schema'

type Db = NeonHttpDatabase<typeof schema>

function createDb(): Db {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL não está definida')
  }
  return drizzle(neon(url), { schema })
}

let _db: Db | undefined

export function getDb(): Db {
  if (!_db) _db = createDb()
  return _db
}
