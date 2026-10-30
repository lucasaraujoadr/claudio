import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  criarRascunhoNewsletter: vi.fn(),
  enviarNewsletter: vi.fn(),
  rascunhoDaPeca: vi.fn(),
  ultimoEnvioDaPeca: vi.fn(),
  contarDestinatariosNewsletter: vi.fn(),
}))
vi.mock('@/lib/distribuicao/newsletter', () => m)

import { GET, maxDuration, POST, runtime } from '../pecas/[id]/newsletter/route'

const ctx = (id = '3') => ({ params: Promise.resolve({ id }) })
const req = (corpo: unknown) =>
  new Request('http://x/api', { method: 'POST', body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }) as never

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('configuração da rota', () => {
  it('nodejs com 120 s (a sincronização antes do envio tem prazo de 60 s)', () => {
    expect(runtime).toBe('nodejs')
    expect(maxDuration).toBe(120)
  })
})

describe('POST /api/distribuicao/pecas/[id]/newsletter', () => {
  it('rascunho cria o rascunho', async () => {
    m.criarRascunhoNewsletter.mockResolvedValue({ ok: true, envio: { id: 1 } })
    const r = await POST(req({ acao: 'rascunho' }), ctx())
    expect(r.status).toBe(200)
    expect(m.criarRascunhoNewsletter).toHaveBeenCalledWith(3)
  })
  it('enviar usa o rascunho do artigo, sem agendamento', async () => {
    m.rascunhoDaPeca.mockResolvedValue({ id: 9 })
    m.enviarNewsletter.mockResolvedValue({ ok: true, situacao: 'enviado', destinatarios: 4 })
    const r = await POST(req({ acao: 'enviar' }), ctx())
    expect(await r.json()).toEqual({ situacao: 'enviado', destinatarios: 4 })
    expect(m.enviarNewsletter).toHaveBeenCalledWith(9)
  })
  it('agendarPara é recusado', async () => {
    expect((await POST(req({ acao: 'enviar', agendarPara: '2030-01-01T10:00:00Z' }), ctx())).status).toBe(400)
  })
  it('enviar sem rascunho → 409; recusa do envio → 422 com a mensagem', async () => {
    m.rascunhoDaPeca.mockResolvedValue(null)
    expect((await POST(req({ acao: 'enviar' }), ctx())).status).toBe(409)
    m.rascunhoDaPeca.mockResolvedValue({ id: 9 })
    m.enviarNewsletter.mockResolvedValue({ ok: false, mensagem: 'bloqueado' })
    const r = await POST(req({ acao: 'enviar' }), ctx())
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ erro: 'bloqueado' })
  })
  it('corpo inválido, ação desconhecida e id ruim', async () => {
    expect((await POST(req('{'), ctx())).status).toBe(400)
    expect((await POST(req({ acao: 'apagar' }), ctx())).status).toBe(400)
    expect((await POST(req({ acao: 'rascunho' }), ctx('abc'))).status).toBe(404)
  })
  it('GET devolve envio e contagem', async () => {
    m.ultimoEnvioDaPeca.mockResolvedValue({ id: 1, situacao: 'rascunho', agendadoPara: null })
    m.contarDestinatariosNewsletter.mockResolvedValue(7)
    const r = await GET(req('') as never, ctx())
    expect(await r.json()).toEqual({ envio: { id: 1, situacao: 'rascunho' }, destinatarios: 7 })
    m.ultimoEnvioDaPeca.mockResolvedValue(null)
    expect(await (await GET(req('') as never, ctx())).json()).toEqual({ envio: null, destinatarios: 7 })
  })
})
