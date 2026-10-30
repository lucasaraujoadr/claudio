import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COOKIE_SESSAO, criarTokenSessao } from '@/lib/auth'
import { proxy } from '@/proxy'

const ORIGINAL = { ...process.env }

beforeEach(() => {
  process.env.AUTH_SECRET = 'segredo-de-teste-descartavel'
})
afterEach(() => {
  process.env = { ...ORIGINAL }
})

function req(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie: `${COOKIE_SESSAO}=${cookie}` } : {},
  })
}

function passa(path: string, cookie?: string) {
  const r = proxy(req(path, cookie))
  return r.headers.get('x-middleware-next') === '1'
}

function redirecionaParaLogin(path: string, cookie?: string) {
  const r = proxy(req(path, cookie))
  return r.status === 307 && new URL(r.headers.get('location') ?? '').pathname === '/login'
}

describe('proxy: lista de rotas liberadas', () => {
  it.each([
    '/login', '/api/login', '/api/cron/gsc', '/api/cron', '/_next/static/x.js', '/favicon.ico',
    '/api/webhooks/resend', '/api/webhooks/site', '/api/webhooks',
    '/descadastro', '/api/publico/x', '/api/publico/descadastro', '/api/publico/saude',
    // Logos dos emails (funis e newsletter): o cliente de email busca a imagem sem cookie.
    '/logo-og.png',
    '/logo-og-claro.png',
  ])(
    'libera %s sem cookie',
    (path) => {
      expect(passa(path)).toBe(true)
    },
  )

  it.each(['/login/', '/loginx', '/api/loginfoo', '/api/cronfoo', '/api/webhooksfoo', '/api/webhooks-site', '/api/logout', '/api/crm/resend/sincronizar', '/favicon.icoX', '/_nextx/a', '/_next', '/api/crm', '/api/crm/contatos', '/descadastrox', '/descadastro/x', '/api/publico', '/api/publicox', '/logo-og.pngx', '/logo-og.png/x', '/logo-og-claro.pngx', '/logo-og-claro.png/x', '/x/logo-og-claro.png', '/logo-og-escuro.png', '/x/logo-og.png', '/logo.png'])(
    'não libera %s sem cookie',
    (path) => {
      expect(redirecionaParaLogin(path)).toBe(true)
    },
  )
})

describe('proxy: cookie de sessão', () => {
  it('/ sem cookie redireciona para /login', () => {
    expect(redirecionaParaLogin('/')).toBe(true)
  })
  it('/ com cookie válido passa', () => {
    expect(passa('/', criarTokenSessao())).toBe(true)
  })
  it('/ com cookie adulterado redireciona para /login', () => {
    const t = criarTokenSessao()
    const adulterado = t.slice(0, -1) + (t.endsWith('0') ? '1' : '0')
    expect(redirecionaParaLogin('/', adulterado)).toBe(true)
  })
})
