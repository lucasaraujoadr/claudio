import { describe, expect, it } from 'vitest'
import { urlPublicadaValida } from '../url-publicada'

describe('urlPublicadaValida', () => {
  it('aceita URL https do domínio do site', () => {
    expect(urlPublicadaValida('https://ogpericiacontabil.com.br/blog/pericia')).toBe(true)
  })
  it.each([
    'http://ogpericiacontabil.com.br/x',
    'https://outro.com.br/x',
    'https://ogpericiacontabil.com.br.evil.com/x',
    'https://ogpericiacontabil.com.br@evil.com/x',
    'https://www.ogpericiacontabil.com.br/x',
    'texto solto',
    '',
  ])('rejeita %s', (v) => {
    expect(urlPublicadaValida(v)).toBe(false)
  })
})
