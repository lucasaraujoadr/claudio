import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  after: vi.fn(),
  reivindicarGeracao: vi.fn(),
  executarGeracao: vi.fn(),
  obterArtigo: vi.fn(),
  salvarEdicao: vi.fn(),
  enviarArtigo: vi.fn(),
  enviarImagem: vi.fn(),
  configWp: vi.fn(),
  reescreverTrecho: vi.fn(),
  iaConfigurada: vi.fn(),
}))

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: m.after }))
vi.mock('@/lib/ai/cliente', () => ({ iaConfigurada: m.iaConfigurada }))
vi.mock('@/lib/artigos/repositorio', () => ({
  reivindicarGeracao: m.reivindicarGeracao,
  obterArtigo: m.obterArtigo,
  salvarEdicao: m.salvarEdicao,
}))
vi.mock('@/lib/artigos/gerar', () => ({ executarGeracao: m.executarGeracao, reescreverTrecho: m.reescreverTrecho }))
vi.mock('@/lib/artigos/enviar', () => ({ enviarArtigo: m.enviarArtigo }))
vi.mock('@/lib/artigos/visao', async (orig) => ({
  ...(await orig<typeof import('@/lib/artigos/visao')>()),
  keywordDoTema: vi.fn(async () => 'perícia contábil'),
}))
vi.mock('@/lib/wordpress', () => ({
  configWp: m.configWp,
  criarClienteWp: () => ({ enviarImagem: m.enviarImagem, listarCategorias: vi.fn() }),
  ErroWp: class ErroWp extends Error {},
}))
vi.mock('@/lib/db', () => ({ getDb: () => ({}) }))

import { POST as gerar } from '../gerar/route'
import { PUT } from '../[id]/route'
import { POST as capa } from '../[id]/capa/route'
import { POST as enviar } from '../[id]/enviar/route'
import { POST as reescrever } from '../[id]/reescrever/route'

const ctx = { params: Promise.resolve({ id: '7' }) }
const artigoBase = { id: 7, topicId: 3, situacao: 'rascunho', revisado: false, categoriaId: null, capaMediaId: null }

function form(campos: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(campos)) f.set(k, v)
  return new Request('http://localhost/api/artigos/gerar', { method: 'POST', body: f }) as never
}
function json(corpo: unknown, metodo = 'POST') {
  return new Request('http://localhost/x', {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  }) as never
}
function upload(bytes: Uint8Array, nome = 'capa.png') {
  const f = new FormData()
  f.set('arquivo', new File([bytes as BlobPart], nome, { type: 'image/png' }))
  return new Request('http://localhost/x', { method: 'POST', body: f }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  m.iaConfigurada.mockReturnValue(true)
  m.configWp.mockReturnValue({ url: 'https://wp.test', usuario: 'u', senha: 's' })
  m.obterArtigo.mockResolvedValue(artigoBase)
})

describe('POST /api/artigos/gerar', () => {
  it('gerar redireciona para /artigos/<id> e agenda after', async () => {
    m.reivindicarGeracao.mockResolvedValue({ tipo: 'reivindicado', artigoId: 7, topicId: 3 })
    const r = await gerar(form({ topicId: '3' }))
    expect(r.status).toBe(303)
    expect(new URL(r.headers.get('location')!).pathname).toBe('/artigos/7')
    expect(m.after).toHaveBeenCalledTimes(1)
    await m.after.mock.calls[0][0]()
    expect(m.executarGeracao).toHaveBeenCalledWith(7, 3)
  })

  it("gerar com 'existe' não chama executarGeracao", async () => {
    m.reivindicarGeracao.mockResolvedValue({ tipo: 'existe', artigoId: 7 })
    const r = await gerar(form({ topicId: '3' }))
    expect(new URL(r.headers.get('location')!).pathname).toBe('/artigos/7')
    expect(m.after).not.toHaveBeenCalled()
    expect(m.executarGeracao).not.toHaveBeenCalled()
  })

  it('sem IA e entrada inválida voltam para /artigos com flag', async () => {
    m.iaConfigurada.mockReturnValue(false)
    expect(new URL((await gerar(form({ topicId: '3' }))).headers.get('location')!).search).toBe('?gerar=sem-chave')
    expect(new URL((await gerar(form({}))).headers.get('location')!).search).toBe('?gerar=erro')
  })
})

describe('PUT /api/artigos/[id]', () => {
  it('PUT sanitiza conteudoHtml com <script>', async () => {
    m.salvarEdicao.mockImplementation(async (_id, c) => ({ ...artigoBase, ...c }))
    const r = await PUT(json({ conteudoHtml: '<p>Oi</p><script>alert(1)</script>', slug: 'Título Longo' }, 'PUT'), ctx)
    expect(r.status).toBe(200)
    const campos = m.salvarEdicao.mock.calls[0][1]
    expect(campos.conteudoHtml).not.toContain('script')
    expect(campos.conteudoHtml).toContain('Oi')
    expect(campos.slug).toBe('titulo-longo')
  })

  it('PUT em gerando → 409', async () => {
    m.salvarEdicao.mockResolvedValue(null)
    m.obterArtigo.mockResolvedValue({ ...artigoBase, situacao: 'gerando' })
    expect((await PUT(json({ titulo: 'x' }, 'PUT'), ctx)).status).toBe(409)
  })
})

describe('POST /api/artigos/[id]/capa', () => {
  it('capa PNG falso (extensão .png, bytes de texto) → 400', async () => {
    const r = await capa(upload(new TextEncoder().encode('isto não é uma imagem')), ctx)
    expect(r.status).toBe(400)
    expect(m.enviarImagem).not.toHaveBeenCalled()
  })

  it('capa 4 MB + 1 byte → 413', async () => {
    const b = new Uint8Array(4 * 1024 * 1024 + 1)
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect((await capa(upload(b), ctx)).status).toBe(413)
    expect(m.enviarImagem).not.toHaveBeenCalled()
  })

  it('capa válida envia e salva', async () => {
    m.enviarImagem.mockResolvedValue({ id: 9, url: 'https://wp.test/c.png' })
    m.salvarEdicao.mockResolvedValue(artigoBase)
    const r = await capa(upload(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])), ctx)
    expect(r.status).toBe(200)
    expect(m.salvarEdicao.mock.calls[0][1]).toEqual({ capaMediaId: 9, capaUrl: 'https://wp.test/c.png' })
  })
})

describe('enviar e reescrever', () => {
  it('enviar sem WP configurado → 503', async () => {
    m.configWp.mockReturnValue(null)
    const r = await enviar(json({ modo: 'rascunho' }), ctx)
    expect(r.status).toBe(503)
    expect(await r.json()).toEqual({ tipo: 'erro', mensagem: 'WordPress não configurado' })
  })

  it('enviar mapeia erro para 502 e ok para 200', async () => {
    m.enviarArtigo.mockResolvedValueOnce({ tipo: 'erro', mensagem: 'x' })
    expect((await enviar(json({ modo: 'publicar' }), ctx)).status).toBe(502)
    m.enviarArtigo.mockResolvedValueOnce({ tipo: 'ok', link: 'l', metaGravada: true })
    expect((await enviar(json({ modo: 'publicar' }), ctx)).status).toBe(200)
  })

  it('reescrever instrução longa → 400', async () => {
    const r = await reescrever(json({ trecho: 'abc', instrucao: 'x'.repeat(501) }), ctx)
    expect(r.status).toBe(400)
    expect(m.reescreverTrecho).not.toHaveBeenCalled()
  })

  it('reescrever devolve texto', async () => {
    m.reescreverTrecho.mockResolvedValue('novo')
    const r = await reescrever(json({ trecho: 'abc', instrucao: 'melhore' }), ctx)
    expect(await r.json()).toEqual({ texto: 'novo' })
  })
})
