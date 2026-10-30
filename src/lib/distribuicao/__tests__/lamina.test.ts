import { describe, expect, it } from 'vitest'
import { renderizarLamina, type Lamina } from '../arte/lamina'

async function dimensoes(r: Response) {
  const b = Buffer.from(await r.arrayBuffer())
  expect(b.subarray(1, 4).toString()).toBe('PNG')
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

describe('renderizarLamina', () => {
  it('devolve image/png e PNG 1080×1350', async () => {
    const l: Lamina = { tipo: 'conteudo', titulo: 'Título', texto: 'Texto', itens: ['a', 'b'] }
    const r = await renderizarLamina(l, 2, 8, 'escura')
    expect(r).toBeInstanceOf(Response)
    const resp = r as Response
    expect(resp.headers.get('content-type')).toContain('image/png')
    expect(await dimensoes(resp)).toEqual({ w: 1080, h: 1350 })
  }, 30000)

  it('renderiza capa e chamada na variação clara', async () => {
    for (const l of [
      { tipo: 'capa', titulo: 'Capa', subtitulo: null },
      { tipo: 'chamada', texto: 'Fale conosco' },
    ] as Lamina[]) {
      const r = await renderizarLamina(l, 1, 3, 'clara')
      expect(await dimensoes(r as Response)).toEqual({ w: 1080, h: 1350 })
    }
  }, 30000)

  it('texto longo → erro com o número da lâmina', async () => {
    const l: Lamina = { tipo: 'conteudo', titulo: 'T', texto: 'palavra '.repeat(600), itens: null }
    expect(await renderizarLamina(l, 5, 8, 'escura')).toEqual({
      erro: 'texto longo demais na lâmina 5',
    })
  })
})
