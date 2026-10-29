// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ErroDash from '@/app/(dash)/error'

afterEach(cleanup)

describe('fronteira de erro do painel', () => {
  it('diz que a consulta falhou, tem botão de tentar novamente e não mostra resultado zero', () => {
    const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const retry = vi.fn()
    const { container } = render(<ErroDash error={new Error('conexão recusada')} retry={retry} />)

    expect(screen.getByRole('alert').textContent).toMatch(/não foi possível consultar/i)
    expect(container.textContent).not.toMatch(/\b0\b/)
    expect(container.textContent).not.toMatch(/nenhum problema/i)

    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(retry).toHaveBeenCalledTimes(1)
    consoleErro.mockRestore()
  })
})
