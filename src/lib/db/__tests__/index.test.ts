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

  it('um erro em cliente ocioso do pool é registrado (só o nome) em vez de derrubar o processo', async () => {
    const { getDb } = await import('@/lib/db')
    process.env.DATABASE_URL = 'postgres://u:segredo@localhost:5432/db'
    const pool = (getDb() as unknown as { $client: import('node:events').EventEmitter }).$client
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const erro = Object.assign(new Error('conexão encerrada postgres://u:segredo@host'), { name: 'ErroDeConexao' })
    expect(() => pool.emit('error', erro)).not.toThrow()
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0].join(' ')).toContain('ErroDeConexao')
    expect(log.mock.calls[0].join(' ')).not.toContain('segredo')
    log.mockRestore()
  })
})
