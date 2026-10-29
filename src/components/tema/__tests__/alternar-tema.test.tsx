// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AlternarTema } from '../alternar-tema'
import { temaDoCookie } from '../tema'

beforeEach(() => {
  localStorage.clear()
  document.cookie = 'tema=; path=/; max-age=0'
})
afterEach(cleanup)

describe('AlternarTema', () => {
  it('alterna escuro → claro → escuro e persiste a escolha', () => {
    document.documentElement.setAttribute('data-theme', 'escuro')
    render(<AlternarTema />)
    const botao = screen.getByRole('button')

    fireEvent.click(botao)
    expect(document.documentElement.getAttribute('data-theme')).toBe('claro')
    expect(temaDoCookie(document.cookie)).toBe('claro')
    expect(localStorage.getItem('tema')).toBe('claro')

    fireEvent.click(botao)
    expect(document.documentElement.getAttribute('data-theme')).toBe('escuro')
    expect(temaDoCookie(document.cookie)).toBe('escuro')
  })

  it('o HTML não depende do tema (sem divergência de hidratação)', () => {
    document.documentElement.setAttribute('data-theme', 'escuro')
    const a = render(<AlternarTema />).container.innerHTML
    cleanup()
    document.documentElement.setAttribute('data-theme', 'claro')
    const b = render(<AlternarTema />).container.innerHTML
    expect(a).toBe(b)
    // Os dois rótulos existem; o CSS esconde o que não vale.
    expect(b).toContain('Mudar para o tema escuro')
    expect(b).toContain('Mudar para o tema claro')
  })

  it('reaplica o atributo se o React o apagou (remontagem em dev)', () => {
    document.documentElement.removeAttribute('data-theme')
    localStorage.setItem('tema', 'escuro')
    render(<AlternarTema />)
    expect(document.documentElement.getAttribute('data-theme')).toBe('escuro')
  })
})
