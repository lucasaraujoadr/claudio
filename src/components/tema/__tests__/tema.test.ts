// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SCRIPT_TEMA,
  alternarTema,
  aplicarTema,
  cookieDoTema,
  normalizarTema,
  temaAtual,
  temaDoCookie,
} from '../tema'

function limparCookie() {
  document.cookie = 'tema=; path=/; max-age=0'
}

function simularSistema(escuro: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({ matches: escuro && q.includes('dark'), media: q })),
  )
}

function rodarScript() {
  // O script é a string exata enviada no <head>.
  new Function(SCRIPT_TEMA)()
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme')
  localStorage.clear()
  limparCookie()
  simularSistema(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('funções puras', () => {
  it('normaliza só os dois temas conhecidos', () => {
    expect(normalizarTema('escuro')).toBe('escuro')
    expect(normalizarTema('claro')).toBe('claro')
    expect(normalizarTema('dark')).toBeNull()
    expect(normalizarTema(undefined)).toBeNull()
    expect(normalizarTema('<script>')).toBeNull()
  })

  it('alterna entre os dois', () => {
    expect(alternarTema('escuro')).toBe('claro')
    expect(alternarTema('claro')).toBe('escuro')
  })

  it('lê o tema de uma string de cookies', () => {
    expect(temaDoCookie('a=1; tema=escuro; b=2')).toBe('escuro')
    expect(temaDoCookie('tema=claro')).toBe('claro')
    expect(temaDoCookie('outro_tema=escuro')).toBeNull()
    expect(temaDoCookie('tema=roxo')).toBeNull()
    expect(temaDoCookie('')).toBeNull()
  })

  it('o cookie vale para o site todo por um ano', () => {
    expect(cookieDoTema('claro')).toBe('tema=claro; path=/; max-age=31536000; SameSite=Lax')
  })
})

describe('script inline do <head>', () => {
  it('respeita o atributo que o servidor já escreveu', () => {
    document.documentElement.setAttribute('data-theme', 'claro')
    localStorage.setItem('tema', 'escuro')
    simularSistema(true)
    rodarScript()
    expect(document.documentElement.getAttribute('data-theme')).toBe('claro')
  })

  it('sem atributo, usa o cookie', () => {
    document.cookie = 'tema=escuro; path=/'
    rodarScript()
    expect(document.documentElement.getAttribute('data-theme')).toBe('escuro')
  })

  it('sem cookie, usa o localStorage e regrava o cookie para o servidor', () => {
    localStorage.setItem('tema', 'escuro')
    rodarScript()
    expect(document.documentElement.getAttribute('data-theme')).toBe('escuro')
    expect(temaDoCookie(document.cookie)).toBe('escuro')
  })

  it('sem escolha salva, segue o sistema — e não grava nada', () => {
    simularSistema(true)
    rodarScript()
    expect(document.documentElement.getAttribute('data-theme')).toBe('escuro')
    expect(temaDoCookie(document.cookie)).toBeNull()
    expect(localStorage.getItem('tema')).toBeNull()

    document.documentElement.removeAttribute('data-theme')
    simularSistema(false)
    rodarScript()
    expect(document.documentElement.getAttribute('data-theme')).toBe('claro')
  })

  it('ignora valores inválidos no storage', () => {
    localStorage.setItem('tema', 'roxo')
    simularSistema(true)
    rodarScript()
    expect(document.documentElement.getAttribute('data-theme')).toBe('escuro')
  })

  it('não quebra a página se o localStorage lançar', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    expect(() => rodarScript()).not.toThrow()
    expect(document.documentElement.getAttribute('data-theme')).toBe('claro')
    vi.restoreAllMocks()
  })
})

describe('aplicarTema / temaAtual', () => {
  it('aplica no <html> e persiste em cookie e localStorage', () => {
    aplicarTema('escuro')
    expect(document.documentElement.getAttribute('data-theme')).toBe('escuro')
    expect(temaDoCookie(document.cookie)).toBe('escuro')
    expect(localStorage.getItem('tema')).toBe('escuro')
    expect(temaAtual()).toBe('escuro')
  })

  it('temaAtual cai para o sistema quando não há nada', () => {
    simularSistema(true)
    expect(temaAtual()).toBe('escuro')
  })
})
