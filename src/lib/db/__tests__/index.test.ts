import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('getDb', () => {
  const original = process.env.DATABASE_URL

  beforeEach(() => {
    vi.resetModules()
    delete process.env.DATABASE_URL
  })

  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = original
  })

  it('importar o módulo sem DATABASE_URL não lança', async () => {
    await expect(import('@/lib/db')).resolves.toBeDefined()
  })

  it('getDb() lança só quando chamado sem DATABASE_URL', async () => {
    const { getDb } = await import('@/lib/db')
    expect(() => getDb()).toThrow(/DATABASE_URL/)
  })

  it('lê DATABASE_URL na chamada e memoiza a instância', async () => {
    const { getDb } = await import('@/lib/db')
    process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db'
    const first = getDb()
    expect(first).toBeDefined()
    expect(getDb()).toBe(first)
  })
})
