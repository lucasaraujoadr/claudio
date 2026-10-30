// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { MarcaVerificar, trechosVerificar } from '../[id]/marca-verificar'
import { TrechosVerificar } from '../[id]/trechos-verificar'

afterEach(() => cleanup())

function novoEditor(html: string) {
  return new Editor({ extensions: [StarterKit, MarcaVerificar], content: html })
}

describe('trechosVerificar', () => {
  it('lista cada trecho marcado com texto e motivo, na ordem do texto', () => {
    const editor = novoEditor(
      '<p>a <mark data-verificar="lei">Lei 1/2020</mark> b</p><ul><li><mark data-verificar="">item com <strong>negrito</strong> marcado</mark></li></ul>',
    )
    const t = trechosVerificar(editor.state.doc)
    expect(t.map((x) => [x.texto, x.motivo])).toEqual([
      ['Lei 1/2020', 'lei'],
      ['item com negrito marcado', ''],
    ])
    expect(editor.state.doc.textBetween(t[0].de, t[0].ate)).toBe('Lei 1/2020')
    editor.destroy()
  })

  it('sem marcas, lista vazia', () => {
    const editor = novoEditor('<p>nada aqui</p>')
    expect(trechosVerificar(editor.state.doc)).toEqual([])
    editor.destroy()
  })
})

describe('TrechosVerificar', () => {
  it('sem trechos, não renderiza nada', () => {
    const editor = novoEditor('<p>limpo</p>')
    const { container } = render(<TrechosVerificar editor={editor} />)
    expect(container.innerHTML).toBe("")
    editor.destroy()
  })

  it('"Já conferi" tira só a marca daquele trecho e mantém o texto', async () => {
    const editor = novoEditor('<p><mark data-verificar="um">primeiro</mark> e <mark data-verificar="dois">segundo</mark></p>')
    render(<TrechosVerificar editor={editor} />)
    expect(screen.getByText(/2 trechos a verificar/i)).toBeTruthy()
    expect(screen.getByText('primeiro')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /já conferi/i })[0])
    })
    const html = editor.getHTML()
    expect(html).toContain('primeiro')
    expect(html).not.toContain('data-verificar="um"')
    expect(html).toContain('<mark data-verificar="dois">segundo</mark>')
    expect(await screen.findByText(/1 trecho a verificar/i)).toBeTruthy()
    editor.destroy()
  })

  it('mostra os trechos quando o editor chega depois da montagem (sem nenhuma edição)', () => {
    const editor = novoEditor('<p><mark data-verificar="m">tardio</mark></p>')
    const { rerender } = render(<TrechosVerificar editor={null} />)
    rerender(<TrechosVerificar editor={editor} />)
    expect(screen.getByText('tardio')).toBeTruthy()
    editor.destroy()
  })

  it('"Ir ao trecho" seleciona o trecho no editor', async () => {
    const editor = novoEditor('<p>x <mark data-verificar="m">alvo</mark></p>')
    render(<TrechosVerificar editor={editor} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ir ao trecho/i }))
    })
    const { from, to } = editor.state.selection
    expect(editor.state.doc.textBetween(from, to)).toBe('alvo')
    editor.destroy()
  })
})
