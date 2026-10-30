import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  criarRascunhoNewsletter: vi.fn(),
  enviarNewsletter: vi.fn(),
  rascunhoDaPeca: vi.fn(),
  ultimoEnvioDaPeca: vi.fn(),
  contarDestinatariosNewsletter: vi.fn(),
}))
vi.mock('@/lib/distribuicao/newsletter', () => m)

import { GET, POST } from '../pecas/[id]/newsletter/route'

const ctx = (id = '3') => ({ params: Promise.resolve({ id }) })
const req = (corpo: unknown) =>
  new Request('http://x/api', { method: 'POST', body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }) as never

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/distribuicao/pecas/[id]/newsletter', () => {
  it('rascunho cria o rascunho', async () => {
    m.criarRascunhoNewsletter.mockResolvedValue({ ok: true, envio: { id: 1 } })
    const r = await POST(req({ acao: 'rascunho' }), ctx())
    expect(r.status).toBe(200)
    expect(m.criarRascunhoNewsletter).toHaveBeenCalledWith(3)
  })
  it('enviar usa o rascunho do artigo e a data agendada', async () => {
    m.rascunhoDaPeca.mockResolvedValue({ id: 9 })
    m.enviarNewsletter.mockResolvedValue({ ok: true, situacao: 'agendado', destinatarios: 4 })
    const r = await POST(req({ acao: 'enviar', agendarPara: '2030-01-01T10:00:00Z' }), ctx())
    expect(await r.json()).toEqual({ situacao: 'agendado', destinatarios: 4 })
    expect(m.enviarNewsletter).toHaveBeenCalledWith(9, { agendarPara: new Date('2030-01-01T10:00:00Z') })
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
    expect((await POST(req({ acao: 'enviar', agendarPara: 'amanhã' }), ctx())).status).toBe(400)
    expect((await POST(req({ acao: 'rascunho' }), ctx('abc'))).status).toBe(404)
  })
  it('GET devolve envio e contagem', async () => {
    m.ultimoEnvioDaPeca.mockResolvedValue(null)
    m.contarDestinatariosNewsletter.mockResolvedValue(7)
    const r = await GET(req('') as never, ctx())
    expect(await r.json()).toEqual({ envio: null, destinatarios: 7 })
  })
})
