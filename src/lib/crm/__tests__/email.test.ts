import { describe, it, expect } from 'vitest'
import { normalizarEmail } from '../email'

describe('normalizarEmail', () => {
  it('apara e põe em minúsculas', () => {
    expect(normalizarEmail('  Fulano.Silva@Escritorio.COM.br \t')).toBe('fulano.silva@escritorio.com.br')
  })

  it('aceita endereços plausíveis', () => {
    for (const e of ['a@b.co', 'x+tag@example.com', 'nome_sobrenome@sub.dominio.adv.br', "o'neil@example.com"]) {
      expect(normalizarEmail(e)).toBe(e.toLowerCase())
    }
  })

  it('recusa o que não é um endereço plausível', () => {
    const invalidos = [
      '',
      '   ',
      'semarroba.com',
      'dois@@example.com',
      'a@b@example.com',
      '@example.com',
      'fulano@',
      'fulano@localhost',
      'fulano@dominio.',
      'fulano@.dominio.com',
      'fulano@dominio..com',
      'ful ano@example.com',
      'fulano@exa mple.com',
      'fulano@example.com, outro@example.com',
      '<fulano@example.com>',
    ]
    for (const e of invalidos) expect(normalizarEmail(e), e).toBeNull()
  })

  it('recusa acima de 254 caracteres e aceita no limite', () => {
    const dominio = '@example.com'
    const no = 'a'.repeat(254 - dominio.length) + dominio
    expect(no.length).toBe(254)
    expect(normalizarEmail(no)).toBe(no)
    expect(normalizarEmail('a' + no)).toBeNull()
  })

  it('aceita null/undefined sem lançar', () => {
    expect(normalizarEmail(null)).toBeNull()
    expect(normalizarEmail(undefined)).toBeNull()
  })
})
