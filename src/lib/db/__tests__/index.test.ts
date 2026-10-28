import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('getDb', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.DATABASE_URL
  })

  it('importar o módulo sem DATABASE_URL não lança', async () => {
    await expect(import('@/lib/db')).resolves.toBeDefined()
  })

  it('getDb() lança só quando chamado sem DATABASE_URL', async () => {
    const { getDb } = await import('@/lib/db')
    expect(() => getDb()).toThrow()
  })
})
