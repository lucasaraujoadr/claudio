'use client'

import { useState } from 'react'

export function CopiarMarkdown({ markdown }: { markdown: string }) {
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null)

  async function copiar() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('indisponível')
      await navigator.clipboard.writeText(markdown)
      setMsg({ texto: 'Markdown copiado.', erro: false })
    } catch {
      setMsg({ texto: 'Não foi possível copiar automaticamente. Selecione o texto abaixo e copie manualmente.', erro: true })
    }
  }

  return (
    <div>
      <button type="button" onClick={copiar} className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-gray-800">
        Copiar Markdown
      </button>
      <p role={msg?.erro ? 'alert' : 'status'} className={`mt-2 text-sm ${msg?.erro ? 'text-red-600' : 'text-green-700'}`}>
        {msg?.texto}
      </p>
      {msg?.erro && (
        <>
          <label htmlFor="md-manual" className="sr-only">Markdown do briefing</label>
          <textarea id="md-manual" readOnly value={markdown} rows={12} className="mt-2 w-full rounded border border-gray-400 p-2 font-mono text-xs" />
        </>
      )}
    </div>
  )
}
