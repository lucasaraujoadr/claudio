import { PDFDocument } from 'pdf-lib'
import { unzipSync, strFromU8 } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  obterPeca: vi.fn(),
  salvarPeca: vi.fn(),
  definirVariacao: vi.fn(),
  marcarPublicada: vi.fn(),
  pecasDoArtigo: vi.fn(),
  gerarPecas: vi.fn(),
  carregarArtigoParaPecas: vi.fn(),
  iaConfigurada: vi.fn(),
}))

vi.mock('@/lib/ai/cliente', () => ({ iaConfigurada: m.iaConfigurada }))
vi.mock('@/lib/distribuicao/repositorio', () => ({
  obterPeca: m.obterPeca,
  salvarPeca: m.salvarPeca,
  definirVariacao: m.definirVariacao,
  marcarPublicada: m.marcarPublicada,
  pecasDoArtigo: m.pecasDoArtigo,
}))
vi.mock('@/lib/distribuicao/gerar', () => ({
  gerarPecas: m.gerarPecas,
  carregarArtigoParaPecas: m.carregarArtigoParaPecas,
}))

import { POST as gerar } from '../[artigoId]/gerar/route'
import { GET as lerPeca, PUT as editarPeca } from '../pecas/[id]/route'
import { GET as lamina } from '../pecas/[id]/lamina/[n]/route'
import { GET as pdf } from '../pecas/[id]/pdf/route'
import { GET as zip } from '../pecas/[id]/zip/route'
import { POST as publicada } from '../pecas/[id]/publicada/route'

const carrossel = {
  laminas: [
    { tipo: 'capa', titulo: 'Perícia contábil', subtitulo: 'Guia' },
    { tipo: 'conteudo', titulo: 'Ponto 1', texto: 'Texto curto', itens: null },
    { tipo: 'conteudo', titulo: 'Ponto 2', texto: null, itens: ['um', 'dois'] },
    { tipo: 'conteudo', titulo: 'Ponto 3', texto: 'Mais um texto', itens: null },
    { tipo: 'conteudo', titulo: 'Ponto 4', texto: 'E outro', itens: null },
    { tipo: 'chamada', texto: 'Fale conosco' },
  ],
  legenda: 'Legenda com acentuação: ação.',
}
const peca = (extra: Record<string, unknown> = {}) => ({
  id: 5,
  artigoId: 7,
  tipo: 'carrossel',
  situacao: 'rascunho',
  conteudo: carrossel,
  variacao: 'escura',
  artigoSlug: 'Perícia Contábil!',
  ...extra,
})
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })
const json = (corpo: unknown, metodo = 'POST') =>
  new Request('http://localhost/x', {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  }) as never
const get = () => new Request('http://localhost/x') as never

beforeEach(() => {
  vi.clearAllMocks()
  m.iaConfigurada.mockReturnValue(true)
  m.obterPeca.mockResolvedValue(peca())
})

describe('arte do carrossel', () => {
  it('PNG 1080×1350 com cabeçalhos', async () => {
    const r = await lamina(get(), ctx({ id: '5', n: '2' }))
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/png')
    expect(r.headers.get('cache-control')).toBe('private, max-age=0, must-revalidate')
    expect(r.headers.get('content-disposition')).toBe('inline; filename="pericia-contabil-lamina-02.png"')
    const b = Buffer.from(await r.arrayBuffer())
    expect({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) }).toEqual({ w: 1080, h: 1350 })
  }, 30000)

  it('lâmina fora do intervalo → 404', async () => {
    expect((await lamina(get(), ctx({ id: '5', n: '7' }))).status).toBe(404)
    expect((await lamina(get(), ctx({ id: '5', n: '0' }))).status).toBe(404)
  })

  it('peça de outro tipo na rota de lâmina → 404', async () => {
    m.obterPeca.mockResolvedValue(peca({ tipo: 'newsletter', conteudo: {} }))
    expect((await lamina(get(), ctx({ id: '5', n: '1' }))).status).toBe(404)
    expect((await pdf(get(), ctx({ id: '5' }))).status).toBe(404)
  })

  it('PDF com N páginas de 1080×1350 pt', async () => {
    const r = await pdf(get(), ctx({ id: '5' }))
    expect(r.headers.get('content-type')).toBe('application/pdf')
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="pericia-contabil-carrossel.pdf"')
    const doc = await PDFDocument.load(await r.arrayBuffer())
    expect(doc.getPageCount()).toBe(6)
    expect(doc.getPage(0).getSize()).toEqual({ width: 1080, height: 1350 })
  }, 60000)

  it('ZIP com N+1 arquivos e legenda em UTF-8', async () => {
    const r = await zip(get(), ctx({ id: '5' }))
    const arquivos = unzipSync(new Uint8Array(await r.arrayBuffer()))
    expect(Object.keys(arquivos).sort()).toEqual(['legenda.txt', 'lamina-01.png', 'lamina-02.png', 'lamina-03.png', 'lamina-04.png', 'lamina-05.png', 'lamina-06.png'].sort())
    expect(strFromU8(arquivos['legenda.txt'])).toBe(carrossel.legenda)
  }, 60000)
})

describe('PUT /api/distribuicao/pecas/[id]', () => {
  it('palavra mais larga que a caixa → 422 e nada salvo', async () => {
    const c = { ...carrossel, laminas: [...carrossel.laminas] }
    c.laminas[1] = { tipo: 'conteudo', titulo: 'Título', texto: 'x'.repeat(200), itens: null }
    const r = await editarPeca(json({ conteudo: c }, 'PUT'), ctx({ id: '5' }))
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ erro: 'texto longo demais', laminas: [2] })
    expect(m.salvarPeca).not.toHaveBeenCalled()
  })

  it('salva o conteúdo válido e a variação', async () => {
    m.salvarPeca.mockResolvedValue({ ...peca(), situacao: 'rascunho' })
    m.definirVariacao.mockResolvedValue({ ...peca(), variacao: 'clara' })
    const r = await editarPeca(json({ conteudo: carrossel, variacao: 'clara' }, 'PUT'), ctx({ id: '5' }))
    expect(r.status).toBe(200)
    expect(m.salvarPeca).toHaveBeenCalledTimes(1)
    expect(m.definirVariacao).toHaveBeenCalledWith(5, 'clara', expect.any(Date))
    expect((await r.json()).variacao).toBe('clara')
  })

  it('conteúdo fora do schema estrito → 400; corpo vazio → 400; gerando → 409; inexistente → 404', async () => {
    expect((await editarPeca(json({ conteudo: { laminas: [] } }, 'PUT'), ctx({ id: '5' }))).status).toBe(400)
    expect((await editarPeca(json({}, 'PUT'), ctx({ id: '5' }))).status).toBe(400)
    m.obterPeca.mockResolvedValue(peca({ situacao: 'gerando' }))
    expect((await editarPeca(json({ variacao: 'clara' }, 'PUT'), ctx({ id: '5' }))).status).toBe(409)
    m.obterPeca.mockResolvedValue(null)
    expect((await editarPeca(json({ variacao: 'clara' }, 'PUT'), ctx({ id: '5' }))).status).toBe(404)
  })

  it('GET devolve a peça', async () => {
    expect((await lerPeca(get(), ctx({ id: '5' }))).status).toBe(200)
    expect((await lerPeca(get(), ctx({ id: 'abc' }))).status).toBe(404)
  })
})

describe('POST publicada', () => {
  it('grava a url e aceita null', async () => {
    m.marcarPublicada.mockResolvedValue(peca({ situacao: 'publicado' }))
    expect((await publicada(json({ url: 'https://linkedin.com/x' }), ctx({ id: '5' }))).status).toBe(200)
    expect(m.marcarPublicada).toHaveBeenLastCalledWith(5, 'https://linkedin.com/x', expect.any(Date))
    await publicada(json({ url: null }), ctx({ id: '5' }))
    expect(m.marcarPublicada).toHaveBeenLastCalledWith(5, null, expect.any(Date))
  })
  it('url que não é http(s) → 400', async () => {
    expect((await publicada(json({ url: 'javascript:alert(1)' }), ctx({ id: '5' }))).status).toBe(400)
  })
})

describe('POST /api/distribuicao/[artigoId]/gerar', () => {
  const ok = { tipo: 'ok', artigo: {}, keyword: 'k' }
  beforeEach(() => {
    m.carregarArtigoParaPecas.mockResolvedValue(ok)
    m.pecasDoArtigo.mockResolvedValue([])
    m.gerarPecas.mockResolvedValue({ tipo: 'processado', pecas: { carrossel: { resultado: 'ok', ajustes: ['cortado'] } } })
  })

  it('recusa artigo com "verificar" (400)', async () => {
    m.carregarArtigoParaPecas.mockResolvedValue({ tipo: 'recusado', motivo: 'verificar', mensagem: 'há 2 trecho(s)' })
    const r = await gerar(json({}), ctx({ artigoId: '7' }))
    expect(r.status).toBe(400)
    expect(m.gerarPecas).not.toHaveBeenCalled()
  })

  it('sem tipos: só o que não existe ou está em erro, e devolve os ajustes', async () => {
    m.pecasDoArtigo.mockResolvedValue([
      { tipo: 'linkedin_artigo', situacao: 'rascunho' },
      { tipo: 'linkedin_post', situacao: 'erro' },
      { tipo: 'newsletter', situacao: 'publicado' },
    ])
    const r = await gerar(json({}), ctx({ artigoId: '7' }))
    expect(m.gerarPecas).toHaveBeenCalledWith(7, { tipos: ['linkedin_post', 'carrossel'] })
    expect((await r.json()).pecas.carrossel.ajustes).toEqual(['cortado'])
  })

  it('com tipos: gera exatamente os listados (JSON e formulário)', async () => {
    m.pecasDoArtigo.mockResolvedValue([{ tipo: 'carrossel', situacao: 'rascunho' }])
    await gerar(json({ tipos: ['carrossel'] }), ctx({ artigoId: '7' }))
    expect(m.gerarPecas).toHaveBeenLastCalledWith(7, { tipos: ['carrossel'] })
    const f = new FormData()
    f.append('tipos', 'newsletter')
    f.append('tipos', 'carrossel')
    await gerar(new Request('http://localhost/x', { method: 'POST', body: f }) as never, ctx({ artigoId: '7' }))
    expect(m.gerarPecas).toHaveBeenLastCalledWith(7, { tipos: ['newsletter', 'carrossel'] })
  })

  it('tipo desconhecido → 400; artigo inexistente → 404', async () => {
    expect((await gerar(json({ tipos: ['x'] }), ctx({ artigoId: '7' }))).status).toBe(400)
    m.carregarArtigoParaPecas.mockResolvedValue({ tipo: 'recusado', motivo: 'nao_encontrado', mensagem: 'x' })
    expect((await gerar(json({}), ctx({ artigoId: '7' }))).status).toBe(404)
  })
})
