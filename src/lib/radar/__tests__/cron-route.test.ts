import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/cron/tendencias/route'

const ORIGINAL = { ...process.env }
afterEach(() => {
  process.env = { ...ORIGINAL }
  vi.restoreAllMocks()
})
const req = (auth?: string) => new Request('http://x/api/cron/tendencias', { headers: auth ? { authorization: auth } : {} })

describe('GET /api/cron/tendencias', () => {
  it('401 sem cabeçalho e com segredo errado', async () => {
    process.env.CRON_SECRET = 's3cret'
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer outro'))).status).toBe(401)
  })
  it('401 (falha fechada) sem CRON_SECRET, mesmo com "Bearer undefined"', async () => {
    delete process.env.CRON_SECRET
    expect((await GET(req('Bearer undefined'))).status).toBe(401)
  })
})
