'use client'

import { useState } from 'react'
import { classesBotao } from '@/components/ui/botao'
import { classesCampo } from '@/components/ui/campo'
import { cx } from '@/components/ui/cx'

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
      <button type="button" onClick={copiar} className={classesBotao('primario')}>
        Copiar Markdown
      </button>
      <p role={msg?.erro ? 'alert' : 'status'} className={cx('mt-2 text-sm', msg?.erro ? 'text-critico' : 'text-sucesso')}>
        {msg?.texto}
      </p>
      {msg?.erro && (
        <>
          <label htmlFor="md-manual" className="sr-only">Markdown do briefing</label>
          <textarea id="md-manual" readOnly value={markdown} rows={12} className={classesCampo('mt-2 font-mono text-xs')} />
        </>
      )}
    </div>
  )
}
