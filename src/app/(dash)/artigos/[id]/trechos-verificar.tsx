'use client'

import { useEditorState, type Editor } from '@tiptap/react'
import { Cartao } from '@/components/ui'
import { trechosVerificar } from './marca-verificar'

const MAX_TEXTO = 140

/**
 * Lista dos trechos amarelos ("verificar") com atalhos: ir até o trecho no texto e marcar
 * como conferido, sem precisar posicionar o cursor dentro da marca.
 */
export function TrechosVerificar({ editor }: { editor: Editor | null }) {
  // A assinatura só re-renderiza a cada transação; a lista é lida do documento atual, para
  // valer também quando o editor chega depois da montagem e ninguém editou ainda.
  useEditorState({ editor, selector: ({ editor: e }) => e?.state.doc ?? null })
  const trechos = editor ? trechosVerificar(editor.state.doc) : []
  if (!editor || trechos.length === 0) return null

  const n = trechos.length
  return (
    <Cartao
      titulo={`${n} ${n === 1 ? 'trecho' : 'trechos'} a verificar`}
      descricao="Confira cada trecho na fonte original. Depois, clique em “Já conferi” para tirar o destaque amarelo."
    >
      <ol className="space-y-3">
        {trechos.map((t, i) => (
          <li key={`${t.de}-${i}`} className="rounded-md border border-borda bg-aviso-fundo/40 p-2.5">
            <p className="break-words text-sm text-tinta">
              {t.texto.length > MAX_TEXTO ? `${t.texto.slice(0, MAX_TEXTO).trimEnd()}…` : t.texto}
            </p>
            {t.motivo && <p className="mt-1 text-xs text-tinta-suave">Motivo: {t.motivo}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => editor.chain().focus().setTextSelection({ from: t.de, to: t.ate }).scrollIntoView().run()}
                className="h-7 rounded border border-borda-forte px-2.5 text-xs font-medium text-tinta hover:bg-elevada"
              >
                Ir ao trecho
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().setTextSelection({ from: t.de, to: t.ate }).unsetMark('verificar').run()}
                className="h-7 rounded bg-acento px-2.5 text-xs font-medium text-sobre-acento hover:bg-acento-forte"
              >
                Já conferi
              </button>
            </div>
          </li>
        ))}
      </ol>
    </Cartao>
  )
}
