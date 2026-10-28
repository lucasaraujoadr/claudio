import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { criarTokenSessao, isCorrectPassword, tokenSessaoValido } from '@/lib/auth'

const ORIGINAL = { ...process.env }

beforeEach(() => {
  process.env.AUTH_SECRET = 'segredo-de-teste-descartavel'
})

afterEach(() => {
  process.env = { ...ORIGINAL }
})

describe('isCorrectPassword', () => {
  it('aceita a senha correta', () => {
    process.env.DASHBOARD_PASSWORD = 'segredo-real'
    expect(isCorrectPassword('segredo-real')).toBe(true)
  })
  it('recusa senha errada', () => {
    process.env.DASHBOARD_PASSWORD = 'segredo-real'
    expect(isCorrectPassword('outra')).toBe(false)
  })
  // Review Focus 1
  it('recusa tudo quando DASHBOARD_PASSWORD não está definida', () => {
    delete process.env.DASHBOARD_PASSWORD
    expect(isCorrectPassword('')).toBe(false)
    expect(isCorrectPassword('qualquer')).toBe(false)
  })
  it('recusa tudo quando DASHBOARD_PASSWORD está vazia', () => {
    process.env.DASHBOARD_PASSWORD = ''
    expect(isCorrectPassword('')).toBe(false)
  })
})

describe('tokenSessaoValido', () => {
  it('aceita token recém-criado', () => {
    expect(tokenSessaoValido(criarTokenSessao())).toBe(true)
  })
  it('recusa token com assinatura adulterada', () => {
    const t = criarTokenSessao()
    expect(tokenSessaoValido(t.slice(0, -1) + (t.endsWith('0') ? '1' : '0'))).toBe(false)
  })
  it('recusa token expirado', () => {
    const passado = new Date(Date.now() - 31 * 24 * 3600 * 1000)
    expect(tokenSessaoValido(criarTokenSessao(passado))).toBe(false)
  })
  it('recusa ausente e malformado', () => {
    expect(tokenSessaoValido(undefined)).toBe(false)
    expect(tokenSessaoValido(null)).toBe(false)
    expect(tokenSessaoValido('')).toBe(false)
    expect(tokenSessaoValido('sem-ponto')).toBe(false)
  })
  it('recusa expiração editada mantendo a assinatura original', () => {
    const [, assinatura] = criarTokenSessao().split('.')
    const expFuturo = Date.now() + 365 * 24 * 3600 * 1000
    expect(tokenSessaoValido(`${expFuturo}.${assinatura}`)).toBe(false)
  })
  it('recusa token assinado com outro segredo', () => {
    const t = criarTokenSessao()
    process.env.AUTH_SECRET = 'outro-segredo-descartavel'
    expect(tokenSessaoValido(t)).toBe(false)
  })
})

describe('AUTH_SECRET ausente ou vazio (falha fechada)', () => {
  it('criarTokenSessao lança quando AUTH_SECRET não está definido', () => {
    delete process.env.AUTH_SECRET
    expect(() => criarTokenSessao()).toThrow()
  })
  it('criarTokenSessao lança quando AUTH_SECRET está vazio', () => {
    process.env.AUTH_SECRET = ''
    expect(() => criarTokenSessao()).toThrow()
  })
  it('tokenSessaoValido retorna false sem lançar quando AUTH_SECRET não está definido', () => {
    const t = criarTokenSessao()
    delete process.env.AUTH_SECRET
    expect(() => tokenSessaoValido(t)).not.toThrow()
    expect(tokenSessaoValido(t)).toBe(false)
  })
  it('recusa token forjado com HMAC de segredo vazio quando AUTH_SECRET está vazio', () => {
    process.env.AUTH_SECRET = ''
    const exp = Date.now() + 3600 * 1000
    const forjado = `${exp}.${createHmac('sha256', '').update(String(exp)).digest('hex')}`
    expect(tokenSessaoValido(forjado)).toBe(false)
  })
})
