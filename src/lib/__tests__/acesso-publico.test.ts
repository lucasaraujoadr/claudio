import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acessoPublicoOk, limparCacheAcessoPublico } from '../acesso-publico'

beforeEach(() => {
  limparCacheAcessoPublico()
  vi.unstubAllEnvs()
})

const resp = (corpo: string, init: ResponseInit = { status: 200 }) => new Response(corpo, init)

describe('acessoPublicoOk', () => {
  it('true só com 200 e JSON ok', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => resp('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }))
    expect(await acessoPublicoOk(f as unknown as typeof fetch)).toBe(true)
    expect(String(f.mock.calls[0][0])).toBe('https://claudio-psi-lime.vercel.app/api/publico/saude')
  })
  it('false para 401 e para HTML de login', async () => {
    expect(await acessoPublicoOk((async () => resp('Authentication Required', { status: 401 })) as typeof fetch)).toBe(false)
    limparCacheAcessoPublico()
    expect(await acessoPublicoOk((async () => resp('<html>Login</html>', { status: 200 })) as typeof fetch)).toBe(false)
    limparCacheAcessoPublico()
    expect(await acessoPublicoOk((async () => resp('', { status: 307, headers: { location: 'https://vercel.com/login' } })) as typeof fetch)).toBe(false)
    limparCacheAcessoPublico()
    expect(await acessoPublicoOk((async () => resp('{"ok":false}', { status: 200 })) as typeof fetch)).toBe(false)
  })
  it('false quando a rede falha', async () => {
    expect(await acessoPublicoOk((async () => { throw new Error('rede') }) as typeof fetch)).toBe(false)
  })
  it('usa cache por 10 minutos', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-29T12:00:00Z'))
      const f = vi.fn(async () => resp('{"ok":true}'))
      await acessoPublicoOk(f as unknown as typeof fetch)
      await acessoPublicoOk(f as unknown as typeof fetch)
      expect(f).toHaveBeenCalledTimes(1)
      vi.setSystemTime(new Date('2026-10-29T12:10:01Z'))
      await acessoPublicoOk(f as unknown as typeof fetch)
      expect(f).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
  it('cacheia false por só 60 s', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-29T12:00:00Z'))
      const f = vi.fn(async (_url: string, _init?: RequestInit) => resp('login', { status: 401 }))
      expect(await acessoPublicoOk(f as unknown as typeof fetch)).toBe(false)
      vi.setSystemTime(new Date('2026-10-29T12:00:30Z'))
      await acessoPublicoOk(f as unknown as typeof fetch)
      expect(f).toHaveBeenCalledTimes(1)
      vi.setSystemTime(new Date('2026-10-29T12:01:01Z'))
      await acessoPublicoOk(f as unknown as typeof fetch)
      expect(f).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
