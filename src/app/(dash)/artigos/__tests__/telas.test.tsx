// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { NAVEGACAO } from '@/components/ui/navegacao'
import { ListaArtigos } from '../lista-artigos'
import { MarcaVerificar } from '../[id]/marca-verificar'
import { Contador } from '../[id]/contador'
import { EditorArtigo } from '../[id]/editor-artigo'
import type { ArtigoTela } from '../[id]/tipos'
import type { ItemConferencia } from '@/lib/artigos/conferencia'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const OK: ItemConferencia[] = [{ id: 'titulo_vazio', nivel: 'ok', texto: 'Título preenchido.' }]
const BLOQUEIA: ItemConferencia[] = [{ id: 'verificar', nivel: 'bloqueia', texto: '1 trecho ainda precisa ser verificado.' }]

function artigo(extra: Partial<ArtigoTela> = {}): ArtigoTela {
  return {
    id: 7,
    topicId: 3,
    situacao: 'pronto',
    titulo: 'Revisão do PASEP',
    slug: 'revisao-pasep',
    metaDescription: 'x'.repeat(130),
    conteudoHtml: '<p>Texto do artigo.</p>',
    fontes: [{ titulo: 'STJ', url: 'https://stj.jus.br/x' }],
    categoriaId: null,
    capaMediaId: null,
    capaUrl: null,
    revisado: true,
    agendadoPara: null,
    wpStatus: null,
    wpLink: null,
    alteradoAposEnvio: false,
    erro: null,
    keyword: 'revisão pasep',
    conferencia: OK,
    ...extra,
  }
}

function montar(a: ArtigoTela = artigo()) {
  return render(
    <EditorArtigo inicial={a} wpConfigurado iaConfigurada brevoConfigurado={false} categorias={[{ id: 12, nome: 'Perícia' }]} />,
  )
}

function resposta(corpo: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }))
}

describe('navegação', () => {
  it('tem Artigos em /artigos, no grupo SEO, depois de Briefings', () => {
    const seo = NAVEGACAO.find((g) => g.titulo === 'SEO')!
    const i = seo.itens.findIndex((x) => x.rotulo === 'Artigos')
    expect(seo.itens[i]?.href).toBe('/artigos')
    expect(seo.itens[i - 1]?.rotulo).toBe('Briefings')
  })
})

describe('lista de artigos', () => {
  it('mostra estado vazio', () => {
    render(<ListaArtigos artigos={[]} />)
    expect(screen.getByText('Nenhum artigo ainda')).toBeTruthy()
  })

  it('mostra situação e link do site', () => {
    render(
      <ListaArtigos
        artigos={[{ id: 1, titulo: 'Um', keyword: 'kw', situacao: 'publicado', atualizadoEm: new Date('2026-10-29T12:00:00Z'), wpLink: 'https://site/um/', alteradoAposEnvio: false }]}
      />,
    )
    expect(screen.getByText('Publicado')).toBeTruthy()
    expect(screen.getByRole('link', { name: /ver no site/i }).getAttribute('href')).toBe('https://site/um/')
  })
})

describe('marca verificar', () => {
  it('parse/render de <mark data-verificar="x">', () => {
    const editor = new Editor({
      extensions: [StarterKit, MarcaVerificar],
      content: '<p>antes <mark data-verificar="x">trecho</mark> depois</p>',
    })
    expect(editor.getHTML()).toContain('<mark data-verificar="x">trecho</mark>')
    editor.destroy()
  })
})

describe('contador', () => {
  it('meta fica em aviso com 119 e ok com 130', () => {
    const { rerender } = render(<Contador valor={119} min={120} max={155} />)
    expect(screen.getByText('119/155').getAttribute('data-estado')).toBe('aviso')
    rerender(<Contador valor={130} min={120} max={155} />)
    expect(screen.getByText('130/155').getAttribute('data-estado')).toBe('ok')
  })
})

describe('editor', () => {
  it('Publicar desabilitado com item que bloqueia e habilitado sem', () => {
    const { unmount } = montar(artigo({ conferencia: BLOQUEIA }))
    expect((screen.getByRole('button', { name: 'Publicar agora' }) as HTMLButtonElement).disabled).toBe(true)
    unmount()
    montar()
    expect((screen.getByRole('button', { name: 'Publicar agora' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('sem WordPress configurado, envio desabilitado com aviso', () => {
    render(<EditorArtigo inicial={artigo()} wpConfigurado={false} iaConfigurada brevoConfigurado={false} categorias={[]} />)
    expect(screen.getByText(/WordPress não configurado/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Publicar agora' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Enviar como rascunho' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Publicar pede confirmação antes de chamar fetch', async () => {
    const f = vi.fn(() => resposta({ tipo: 'ok', link: 'https://site/x/', metaGravada: true }))
    vi.stubGlobal('fetch', f)
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Publicar agora' }))
    expect(f).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar publicação' }))
    await waitFor(() => expect(f).toHaveBeenCalled())
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/artigos/7/enviar')
    expect(JSON.parse(String(init.body))).toEqual({ modo: 'publicar' })
  })

  it('conflito mostra Sobrescrever e reenvia com sobrescrever:true', async () => {
    const f = vi.fn((url: string) =>
      url.endsWith('/enviar') ? resposta({ tipo: 'conflito' }) : resposta(artigo()),
    )
    vi.stubGlobal('fetch', f)
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar como rascunho' }))
    const sobrescrever = await screen.findByRole('button', { name: 'Sobrescrever mesmo assim' })
    expect(screen.getByText(/editado no WordPress depois do último envio/)).toBeTruthy()
    fireEvent.click(sobrescrever)
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2))
    const [, init] = f.mock.calls[1] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ modo: 'rascunho', sobrescrever: true })
  })

  it('publicado: só "Atualizar no site", com confirmação', () => {
    montar(artigo({ situacao: 'publicado', wpStatus: 'publish', wpLink: 'https://site/x/' }))
    expect(screen.queryByRole('button', { name: 'Enviar como rascunho' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Agendar' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar no site' }))
    expect(screen.getByRole('button', { name: 'Confirmar atualização' })).toBeTruthy()
  })

  it('salva com debounce de 1,5 s e mostra o estado', async () => {
    vi.useFakeTimers()
    const f = vi.fn(() => resposta(artigo({ titulo: 'Novo título' })))
    vi.stubGlobal('fetch', f)
    montar()
    fireEvent.change(screen.getByLabelText('Título SEO'), { target: { value: 'Novo título' } })
    expect(screen.getByText('alterações não salvas')).toBeTruthy()
    await act(async () => {
      vi.advanceTimersByTime(1400)
    })
    expect(f).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/artigos/7')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({ titulo: 'Novo título' })
    vi.useRealTimers()
    await waitFor(() => expect(screen.getByText('salvo')).toBeTruthy())
  })

  it('antes de enviar, força salvar o que estava pendente', async () => {
    const f = vi.fn((url: string) =>
      url.endsWith('/enviar') ? resposta({ tipo: 'ok', link: 'https://site/x/', metaGravada: true }) : resposta(artigo()),
    )
    vi.stubGlobal('fetch', f)
    montar()
    fireEvent.change(screen.getByLabelText('Título SEO'), { target: { value: 'Outro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar como rascunho' }))
    await waitFor(() => expect(f.mock.calls.some((c) => String(c[0]).endsWith('/enviar'))).toBe(true))
    const urls = f.mock.calls.map((c) => String(c[0]))
    expect(urls[0]).toBe('/api/artigos/7')
    expect(urls.indexOf('/api/artigos/7/enviar')).toBeGreaterThan(0)
  })
})

describe('datas do agendamento (Brasília)', () => {
  it('converte datetime-local de Brasília para ISO e de volta', async () => {
    const { localParaIso, isoParaLocal } = await import('../[id]/datas')
    expect(localParaIso('2026-11-03T09:30')).toBe('2026-11-03T12:30:00.000Z')
    expect(isoParaLocal('2026-11-03T12:30:00.000Z')).toBe('2026-11-03T09:30')
    expect(localParaIso('lixo')).toBeNull()
  })
})

describe('editor: conteúdo', () => {
  it('carrega o HTML no TipTap e realça o trecho a verificar', async () => {
    const { container } = montar(artigo({ conteudoHtml: '<p>Um <mark data-verificar="lei">fato</mark>.</p>' }))
    await waitFor(() => expect(container.querySelector('mark[data-verificar="lei"]')?.textContent).toBe('fato'))
  })
})
