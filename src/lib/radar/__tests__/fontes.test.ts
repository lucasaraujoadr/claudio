import { describe, expect, it } from 'vitest'
import { ehPaginaDeBusca, hashDeFonte, validarFonte } from '../fontes'

const FONTES = ['https://www.stj.jus.br/sites/portalp/Paginas/Comunicacao/Noticias/2026/materia.aspx', 'https://www.gov.br/receitafederal/pt-br/noticia/']

describe('validarFonte', () => {
  it('aceita URL presente em fontes (ignora caixa do host, fragmento e barra final)', () => {
    expect(validarFonte('https://WWW.stj.jus.br/sites/portalp/Paginas/Comunicacao/Noticias/2026/materia.aspx#topo', FONTES).ok).toBe(true)
    expect(validarFonte('https://www.gov.br/receitafederal/pt-br/noticia', FONTES).ok).toBe(true)
  })
  it('rejeita URL ausente de fontes', () => {
    expect(validarFonte('https://www.stf.jus.br/noticia/inventada', FONTES)).toEqual({ ok: false, motivo: 'fonte_nao_citada' })
  })
  it('rejeita página de busca mesmo se o provedor a citou', () => {
    const busca = 'https://www.stj.jus.br/sites/portalp/Paginas/busca?q=selic'
    expect(validarFonte(busca, [busca])).toEqual({ ok: false, motivo: 'pagina_de_busca' })
  })
  it('rejeita javascript:, ftp: e texto que não é URL', () => {
    expect(validarFonte('javascript:alert(1)', ['javascript:alert(1)'])).toEqual({ ok: false, motivo: 'url_invalida' })
    expect(validarFonte('ftp://x.gov.br/a', ['ftp://x.gov.br/a'])).toEqual({ ok: false, motivo: 'url_invalida' })
    expect(validarFonte('não é url', FONTES)).toEqual({ ok: false, motivo: 'url_invalida' })
  })
})

describe('ehPaginaDeBusca', () => {
  const b = (u: string) => ehPaginaDeBusca(new URL(u))
  it.each([
    'https://x.gov.br/a?q=selic',
    'https://x.gov.br/a?pesquisa=pasep',
    'https://x.gov.br/a?busca=1',
    'https://x.gov.br/a?s1=tr',
    'https://x.gov.br/pesquisa/jurisprudencia',
    'https://x.gov.br/search',
    'https://x.gov.br/',
  ])('detecta %s', (u) => expect(b(u)).toBe(true))
  it.each(['https://x.gov.br/noticias/selic-sobe', 'https://x.gov.br/a?id=10'])('não confunde %s', (u) => expect(b(u)).toBe(false))
})

describe('hashDeFonte', () => {
  it('é sha256 hex estável', () => {
    expect(hashDeFonte('a')).toBe(hashDeFonte('a'))
    expect(hashDeFonte('a')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashDeFonte('a')).not.toBe(hashDeFonte('b'))
  })
})
