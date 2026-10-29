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
