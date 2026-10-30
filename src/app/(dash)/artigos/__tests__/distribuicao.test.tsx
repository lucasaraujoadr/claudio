// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NAVEGACAO } from '@/components/ui/navegacao'
import { LIMITES } from '@/lib/distribuicao/schemas'
import { AbasArtigo } from '../[id]/abas-artigo'
import { AbaDistribuicao, type AbaDistribuicaoProps } from '../[id]/distribuicao/aba-distribuicao'
import type { NewsletterTela, PecaTela } from '../[id]/distribuicao/tipos'
import { TabelaDistribuicao } from '../../distribuicao/tabela-distribuicao'

const roteador = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => roteador }))

beforeEach(() => roteador.refresh.mockReset())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function resposta(corpo: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }))
}

const ATUALIZADO = '2026-10-29T12:00:00.000Z'

const POST = { texto: 'Um texto de post sobre o PASEP.', hashtags: ['PASEP', 'Pericia', 'Direito'] }
const ARTIGO_LI = {
  titulo: 'Revisão do PASEP',
  subtitulo: null,
  blocos: [
    { tipo: 'paragrafo', texto: 'Primeiro parágrafo.' },
    { tipo: 'h2', texto: 'Quem tem direito' },
    { tipo: 'lista', itens: ['Servidor', 'Herdeiro'] },
  ],
}
const CARROSSEL = {
  laminas: [
    { tipo: 'capa', titulo: 'Capa', subtitulo: null },
    { tipo: 'conteudo', titulo: 'Dois', texto: 'Texto dois', itens: null },
    { tipo: 'conteudo', titulo: 'Três', texto: 'Texto três', itens: null },
    { tipo: 'conteudo', titulo: 'Quatro', texto: 'Texto quatro', itens: null },
    { tipo: 'conteudo', titulo: 'Cinco', texto: 'Texto cinco', itens: null },
    { tipo: 'chamada', texto: 'Fale com a gente' },
  ],
  legenda: 'Legenda do carrossel',
}
const NEWS = { assunto: 'Assunto', preCabecalho: 'Pré', abertura: 'Abertura', pontos: ['Um', 'Dois', 'Três'] }

function peca(tipo: PecaTela['tipo'], extra: Partial<PecaTela> = {}): PecaTela {
  const conteudo = { linkedin_artigo: ARTIGO_LI, linkedin_post: POST, carrossel: CARROSSEL, newsletter: NEWS }[tipo]
  const id = { linkedin_artigo: 11, linkedin_post: 12, carrossel: 13, newsletter: 14 }[tipo]
  return {
    id,
    tipo,
    situacao: 'rascunho',
    conteudo,
    variacao: tipo === 'carrossel' ? 'escura' : null,
    erro: null,
    publicadoEm: null,
    urlPublicada: null,
    atualizadoEm: ATUALIZADO,
    ...extra,
  }
}

const TODAS = (): PecaTela[] => [peca('linkedin_artigo'), peca('linkedin_post'), peca('carrossel'), peca('newsletter')]

function newsletter(extra: Partial<NewsletterTela> = {}): NewsletterTela {
  return {
    envio: { id: 5, situacao: 'rascunho', destinatarios: 40, enviadoEm: null, erro: null, temBroadcast: true, atualizadoEm: '2026-10-29T13:00:00.000Z' },
    destinatarios: 42,
    previaHtml: '<html><body><p>Prévia da newsletter</p></body></html>',
    resendConfigurado: true,
    acessoPublico: true,
    ...extra,
  }
}

function montar(extra: Partial<AbaDistribuicaoProps> = {}) {
  return render(
    <AbaDistribuicao
      artigoId={7}
      pecas={TODAS()}
      bloqueio={null}
      iaConfigurada
      limites={LIMITES}
      newsletter={newsletter()}
      {...extra}
    />,
  )
}

const cartao = (nome: string) => screen.getByRole('region', { name: nome })

describe('navegação', () => {
  it('navegação tem Distribuição em /distribuicao, depois de Artigos', () => {
    const seo = NAVEGACAO.find((g) => g.titulo === 'SEO')!
    const i = seo.itens.findIndex((x) => x.rotulo === 'Distribuição')
    expect(seo.itens[i]?.href).toBe('/distribuicao')
    expect(seo.itens[i - 1]?.rotulo).toBe('Artigos')
  })

  it('abas do artigo: Distribuição é link quando pronto e fica desabilitada em rascunho', () => {
    const { rerender } = render(<AbasArtigo artigoId={7} situacao="pronto" atual="artigo" />)
    expect(screen.getByRole('link', { name: 'Distribuição' }).getAttribute('href')).toBe('/artigos/7/distribuicao')
    expect(screen.getByRole('link', { name: 'Artigo' }).getAttribute('aria-current')).toBe('page')
    rerender(<AbasArtigo artigoId={7} situacao="rascunho" atual="artigo" />)
    expect(screen.queryByRole('link', { name: 'Distribuição' })).toBeNull()
    expect(screen.getByText(/quando o artigo estiver pronto/)).toBeTruthy()
  })
})

describe('gerar peças', () => {
  it('aba desabilitada com verificar: Gerar peças desabilitado com a explicação', () => {
    const msg = 'há 2 trecho(s) marcado(s) como "verificar" no artigo; revise antes de gerar as peças'
    montar({ pecas: [], bloqueio: msg })
    expect((screen.getByRole('button', { name: 'Gerar peças' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(msg)).toBeTruthy()
  })

  it('sem IA, Gerar peças fica desabilitado com explicação', () => {
    montar({ pecas: [], iaConfigurada: false })
    expect((screen.getByRole('button', { name: 'Gerar peças' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/IA não está configurada/)).toBeTruthy()
  })

  it('gera sem tipos, mostra o estado de espera, o resultado e os ajustes, e atualiza', async () => {
    let soltar: (r: Response) => void = () => {}
    const f = vi.fn(() => new Promise<Response>((r) => (soltar = r)))
    vi.stubGlobal('fetch', f)
    montar({ pecas: [peca('linkedin_post')] })
    fireEvent.click(screen.getByRole('button', { name: 'Gerar peças' }))
    expect(screen.getByText('Gerando as peças… (leva 1 a 2 minutos)')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Gerar peças|Gerando/ }).getAttribute('aria-busy')).toBe('true')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/distribuicao/7/gerar')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body ?? '{}'))).toEqual({})
    await act(async () => {
      soltar(
        new Response(
          JSON.stringify({
            pecas: {
              linkedin_artigo: { resultado: 'ok', ajustes: ['título cortado de 120 para o limite de 100 caracteres'] },
              carrossel: { resultado: 'erro', ajustes: [] },
            },
          }),
          { status: 200 },
        ),
      )
    })
    expect(await screen.findByText(/título cortado de 120/)).toBeTruthy()
    expect(screen.getByText(/Carrossel: falhou/)).toBeTruthy()
    expect(roteador.refresh).toHaveBeenCalled()
  })

  it('recusa da rota aparece como veio', async () => {
    vi.stubGlobal('fetch', vi.fn(() => resposta({ erro: 'o artigo precisa estar pronto, agendado ou publicado' }, 409)))
    montar({ pecas: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Gerar peças' }))
    expect(await screen.findByText('o artigo precisa estar pronto, agendado ou publicado')).toBeTruthy()
  })
})

describe('cartões', () => {
  it('regerar pede confirmação e manda só o tipo', async () => {
    const f = vi.fn(() => resposta({ pecas: { linkedin_post: { resultado: 'ok', ajustes: [] } } }))
    vi.stubGlobal('fetch', f)
    montar()
    const c = cartao('LinkedIn — post')
    fireEvent.click(within(c).getByRole('button', { name: 'Regerar' }))
    expect(f).not.toHaveBeenCalled()
    expect(within(c).getByText(/Regerar substitui as edições desta peça/)).toBeTruthy()
    fireEvent.click(within(c).getByRole('button', { name: 'Confirmar regerar' }))
    await waitFor(() => expect(f).toHaveBeenCalled())
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/distribuicao/7/gerar')
    expect(JSON.parse(String(init.body))).toEqual({ tipos: ['linkedin_post'] })
  })

  it('peça publicada não pode ser regerada', () => {
    montar({ pecas: [peca('linkedin_post', { situacao: 'publicado', publicadoEm: ATUALIZADO, urlPublicada: 'https://linkedin.com/x' })] })
    const c = cartao('LinkedIn — post')
    expect((within(c).getByRole('button', { name: 'Regerar' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(c).getByText(/publicada não é regerada/)).toBeTruthy()
    expect(within(c).getByRole('link', { name: /linkedin\.com/ }).getAttribute('href')).toBe('https://linkedin.com/x')
  })

  it('copiar usa clipboard com o texto e as hashtags do post', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    montar()
    fireEvent.click(within(cartao('LinkedIn — post')).getByRole('button', { name: 'Copiar' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Um texto de post sobre o PASEP.\n\n#PASEP #Pericia #Direito'))
    expect(await within(cartao('LinkedIn — post')).findByText('Copiado.')).toBeTruthy()
  })

  it('post mostra o contador do texto', () => {
    montar()
    expect(within(cartao('LinkedIn — post')).getByText(`${POST.texto.length}/2800`)).toBeTruthy()
  })

  it('marcar como publicado manda a URL opcional', async () => {
    const f = vi.fn(() => resposta({ ...peca('linkedin_artigo'), situacao: 'publicado' }))
    vi.stubGlobal('fetch', f)
    montar()
    const c = cartao('LinkedIn — artigo')
    fireEvent.click(within(c).getByRole('button', { name: 'Marcar como publicado' }))
    fireEvent.change(within(c).getByLabelText(/URL do post/), { target: { value: 'https://linkedin.com/pulse/x' } })
    fireEvent.click(within(c).getByRole('button', { name: 'Confirmar publicado' }))
    await waitFor(() => expect(f).toHaveBeenCalled())
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/distribuicao/pecas/11/publicada')
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://linkedin.com/pulse/x' })
  })

  it('edição salva sozinha com PUT do conteúdo', async () => {
    vi.useFakeTimers()
    const f = vi.fn(() => resposta(peca('linkedin_post', { conteudo: { ...POST, texto: 'Novo' }, atualizadoEm: '2026-10-29T14:00:00.000Z' })))
    vi.stubGlobal('fetch', f)
    montar()
    fireEvent.change(within(cartao('LinkedIn — post')).getByLabelText('Texto do post'), { target: { value: 'Novo' } })
    await act(async () => {
      vi.advanceTimersByTime(1600)
    })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/distribuicao/pecas/12')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({ conteudo: { ...POST, texto: 'Novo' } })
  })
})

describe('carrossel', () => {
  it('miniaturas vêm da rota PNG com cache-buster e lazy', () => {
    montar()
    const imgs = within(cartao('Carrossel')).getAllByRole('img')
    expect(imgs).toHaveLength(6)
    const v = new Date(ATUALIZADO).getTime()
    expect(imgs[0].getAttribute('src')).toBe(`/api/distribuicao/pecas/13/lamina/1?v=${v}`)
    expect(imgs[0].getAttribute('loading')).toBe('lazy')
  })

  it('downloads de PDF e ZIP', () => {
    montar()
    const c = cartao('Carrossel')
    expect(within(c).getByRole('link', { name: /Baixar PDF/ }).getAttribute('href')).toBe('/api/distribuicao/pecas/13/pdf')
    expect(within(c).getByRole('link', { name: /Baixar PNGs/ }).getAttribute('href')).toBe('/api/distribuicao/pecas/13/zip')
  })

  it('aviso 422 aparece na lâmina certa', async () => {
    vi.useFakeTimers()
    const f = vi.fn(() => resposta({ erro: 'texto longo demais', laminas: [3] }, 422))
    vi.stubGlobal('fetch', f)
    montar()
    const c = cartao('Carrossel')
    const l3 = within(c).getByRole('group', { name: 'Lâmina 3' })
    fireEvent.change(within(l3).getByLabelText('Texto'), { target: { value: 'muito '.repeat(30) } })
    await act(async () => {
      vi.advanceTimersByTime(1600)
    })
    vi.useRealTimers()
    await waitFor(() => expect(within(l3).getByText(/não cabe na lâmina/)).toBeTruthy())
    const l2 = within(c).getByRole('group', { name: 'Lâmina 2' })
    expect(within(l2).queryByText(/não cabe na lâmina/)).toBeNull()
  })

  it('alterna para clara com PUT da variação', async () => {
    const f = vi.fn(() => resposta(peca('carrossel', { variacao: 'clara', atualizadoEm: '2026-10-29T15:00:00.000Z' })))
    vi.stubGlobal('fetch', f)
    montar()
    fireEvent.click(within(cartao('Carrossel')).getByRole('radio', { name: 'Clara' }))
    await waitFor(() => expect(f).toHaveBeenCalled())
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/distribuicao/pecas/13')
    expect(JSON.parse(String(init.body))).toEqual({ variacao: 'clara' })
  })
})

describe('newsletter', () => {
  it('prévia em iframe sandbox vazio com srcdoc', () => {
    montar()
    const iframe = within(cartao('Newsletter')).getByTitle('Prévia da newsletter') as HTMLIFrameElement
    expect(iframe.getAttribute('sandbox')).toBe('')
    expect(iframe.getAttribute('srcdoc')).toContain('Prévia da newsletter')
  })

  it('enviar newsletter pede confirmação antes do fetch', async () => {
    const f = vi.fn(() => resposta({ situacao: 'enviado', destinatarios: 42 }))
    vi.stubGlobal('fetch', f)
    montar()
    const c = cartao('Newsletter')
    fireEvent.click(within(c).getByRole('button', { name: 'Enviar newsletter' }))
    expect(f).not.toHaveBeenCalled()
    fireEvent.click(within(c).getByRole('button', { name: 'Confirmar envio para 42 contatos' }))
    await waitFor(() => expect(f).toHaveBeenCalled())
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/distribuicao/pecas/14/newsletter')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ acao: 'enviar' })
    expect(await within(c).findByText(/enviada para 42 contatos/)).toBeTruthy()
  })

  it('recusa do envio aparece como veio', async () => {
    const msg = 'há descadastros ainda não sincronizados com o Resend; tente de novo em alguns minutos'
    vi.stubGlobal('fetch', vi.fn(() => resposta({ erro: msg }, 422)))
    montar()
    const c = cartao('Newsletter')
    fireEvent.click(within(c).getByRole('button', { name: 'Enviar newsletter' }))
    fireEvent.click(within(c).getByRole('button', { name: 'Confirmar envio para 42 contatos' }))
    expect(await within(c).findByText(msg)).toBeTruthy()
  })

  it('criar rascunho manda acao rascunho', async () => {
    const f = vi.fn(() => resposta({ envio: { id: 5, situacao: 'rascunho' } }))
    vi.stubGlobal('fetch', f)
    montar({ newsletter: newsletter({ envio: null }) })
    const c = cartao('Newsletter')
    expect((within(c).getByRole('button', { name: 'Enviar newsletter' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(c).getByRole('button', { name: 'Criar rascunho no Resend' }))
    await waitFor(() => expect(f).toHaveBeenCalled())
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ acao: 'rascunho' })
  })

  it('sem Resend, botões bloqueados com link para a integração', () => {
    montar({ newsletter: newsletter({ resendConfigurado: false }) })
    const c = cartao('Newsletter')
    expect((within(c).getByRole('button', { name: 'Atualizar rascunho no Resend' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(c).getByRole('button', { name: 'Enviar newsletter' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(c).getByRole('link', { name: /Integração/ }).getAttribute('href')).toBe('/crm/integracao')
  })

  it('sem acesso público, envio bloqueado com explicação', () => {
    montar({ newsletter: newsletter({ acessoPublico: false }) })
    const c = cartao('Newsletter')
    expect((within(c).getByRole('button', { name: 'Enviar newsletter' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(c).getByText(/acessível publicamente/)).toBeTruthy()
  })

  it('peça editada depois do rascunho bloqueia o envio até atualizar o rascunho', () => {
    montar({ pecas: [peca('newsletter', { atualizadoEm: '2026-10-29T18:00:00.000Z' })] })
    const c = cartao('Newsletter')
    expect((within(c).getByRole('button', { name: 'Enviar newsletter' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(c).getByText(/mudou depois do rascunho/)).toBeTruthy()
  })

  it('já enviada: mostra quando e não oferece enviar de novo', () => {
    montar({
      newsletter: newsletter({
        envio: { id: 5, situacao: 'enviado', destinatarios: 42, enviadoEm: '2026-10-29T16:00:00.000Z', erro: null, temBroadcast: true, atualizadoEm: '2026-10-29T16:00:00.000Z' },
      }),
    })
    const c = cartao('Newsletter')
    expect(within(c).queryByRole('button', { name: 'Enviar newsletter' })).toBeNull()
    expect(within(c).getByText(/Enviada em/)).toBeTruthy()
  })
})

describe('/distribuicao', () => {
  it('lista cada artigo com o estado das 4 peças', () => {
    render(
      <TabelaDistribuicao
        linhas={[
          { artigoId: 7, titulo: 'Revisão do PASEP', keyword: 'pasep', situacoes: { linkedin_artigo: 'rascunho', carrossel: 'publicado' } },
        ]}
      />,
    )
    expect(screen.getByRole('link', { name: 'Revisão do PASEP' }).getAttribute('href')).toBe('/artigos/7/distribuicao')
    expect(screen.getByText('Publicado')).toBeTruthy()
    expect(screen.getAllByText('Não gerada')).toHaveLength(2)
  })
})
