import { afterEach, describe, expect, it } from 'vitest'
import { SITE_URL_PADRAO, hostSite, padraoUrlPublicada, siteUrl } from '../site'

const original = process.env.SITE_URL
afterEach(() => {
  if (original === undefined) delete process.env.SITE_URL
  else process.env.SITE_URL = original
})

describe('siteUrl', () => {
  it('sem SITE_URL, usa o endereço público do site', () => {
    delete process.env.SITE_URL
    expect(siteUrl()).toBe('https://ogpericiacontabil.com.br')
    expect(SITE_URL_PADRAO).toBe('https://ogpericiacontabil.com.br')
    expect(hostSite()).toBe('ogpericiacontabil.com.br')
  })
  it('SITE_URL vazia também cai no padrão', () => {
    process.env.SITE_URL = '  '
    expect(siteUrl()).toBe('https://ogpericiacontabil.com.br')
  })
  it('lê SITE_URL e devolve só a origem, sem barra final', () => {
    process.env.SITE_URL = 'https://exemplo.com.br/'
    expect(siteUrl()).toBe('https://exemplo.com.br')
    expect(hostSite()).toBe('exemplo.com.br')
  })
  it('SITE_URL inválida ou sem https falha com mensagem clara', () => {
    process.env.SITE_URL = 'exemplo.com.br'
    expect(() => siteUrl()).toThrow(/SITE_URL/)
    process.env.SITE_URL = 'http://exemplo.com.br'
    expect(() => siteUrl()).toThrow(/SITE_URL/)
  })
})

describe('padraoUrlPublicada', () => {
  it('escapa os pontos do host e casa só URLs https do site', () => {
    delete process.env.SITE_URL
    const p = padraoUrlPublicada()
    expect(p).toBe('https://ogpericiacontabil\\.com\\.br/.*')
    const re = new RegExp(`^(?:${p})$`, 'v')
    expect(re.test('https://ogpericiacontabil.com.br/blog/x')).toBe(true)
    expect(re.test('https://ogpericiacontabilXcom.br/x')).toBe(false)
    expect(re.test('http://ogpericiacontabil.com.br/x')).toBe(false)
  })
})
