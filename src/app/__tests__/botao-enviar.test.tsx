// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BotaoEnviar } from '@/app/(dash)/botao-enviar'

afterEach(cleanup)

function formulario() {
  render(
    <form method="POST" action="/api/temas/pesquisar" onSubmit={(e) => e.preventDefault()}>
      <BotaoEnviar rotuloEnviando="Gerando…">Pesquisar temas</BotaoEnviar>
    </form>,
  )
  return screen.getByRole('button')
}

describe('BotaoEnviar', () => {
  it('começa habilitado com o rótulo normal', () => {
    const b = formulario()
    expect(b.textContent).toBe('Pesquisar temas')
    expect((b as HTMLButtonElement).disabled).toBe(false)
  })

  it('ao enviar o formulário (action por URL), desabilita e mostra "Gerando…"', () => {
    const b = formulario()
    fireEvent.submit(b.closest('form')!)
    expect((b as HTMLButtonElement).disabled).toBe(true)
    expect(b.textContent).toBe('Gerando…')
    expect(b.getAttribute('aria-busy')).toBe('true')
  })

  it('volta ao normal quando a página é restaurada do cache de voltar', () => {
    const b = formulario()
    fireEvent.submit(b.closest('form')!)
    act(() => {
      const e = new Event('pageshow') as Event & { persisted: boolean }
      Object.defineProperty(e, 'persisted', { value: true })
      window.dispatchEvent(e)
    })
    expect((b as HTMLButtonElement).disabled).toBe(false)
  })
})
