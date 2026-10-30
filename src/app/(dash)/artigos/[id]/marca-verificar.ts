import { Mark, mergeAttributes } from '@tiptap/react'

/**
 * Marca "verificar" do TipTap ↔ `<mark data-verificar="motivo">`. É o trecho que depende
 * de fato verificável (lei, tese de tribunal, índice, data). Não se estende ao digitar
 * na borda; sai com o botão "Verificar".
 */
export const MarcaVerificar = Mark.create({
  name: 'verificar',
  inclusive: false,

  addAttributes() {
    return {
      motivo: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-verificar') ?? '',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-verificar': String(attrs.motivo ?? '') }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'mark[data-verificar]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes), 0]
  },
})

export type TrechoVerificar = { de: number; ate: number; texto: string; motivo: string }

type NoDoc = {
  descendants: (f: (no: { isText: boolean; text?: string | null; nodeSize: number; marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[] }, pos: number) => void) => void
}

/**
 * Trechos com a marca "verificar", na ordem do texto. Pedaços vizinhos com o mesmo motivo
 * (o mesmo trecho cortado por negrito, por exemplo) viram um só.
 */
export function trechosVerificar(doc: NoDoc): TrechoVerificar[] {
  const trechos: TrechoVerificar[] = []
  doc.descendants((no, pos) => {
    if (!no.isText) return
    const marca = no.marks.find((m) => m.type.name === 'verificar')
    if (!marca) return
    const motivo = String(marca.attrs.motivo ?? '')
    const texto = no.text ?? ''
    const ultimo = trechos[trechos.length - 1]
    if (ultimo && ultimo.ate === pos && ultimo.motivo === motivo) {
      ultimo.ate = pos + no.nodeSize
      ultimo.texto += texto
    } else {
      trechos.push({ de: pos, ate: pos + no.nodeSize, texto, motivo })
    }
  })
  return trechos
}
