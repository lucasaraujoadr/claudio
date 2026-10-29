'use client'

import { useState } from 'react'
import { classesBotao } from '@/components/ui'

/** Mostra a URL com o token mascarado; "Mostrar" revela e "Copiar" copia a URL inteira. */
export function UrlSecreta({ rotulo, base, token }: { rotulo: string; base: string; token: string }) {
  const [visivel, setVisivel] = useState(false)
  const [copiado, setCopiado] = useState<'ok' | 'falhou' | null>(null)
  const completa = `${base}?token=${encodeURIComponent(token)}`
  const exibida = visivel ? completa : `${base}?token=${'•'.repeat(12)}`

  async function copiar() {
    try {
      await navigator.clipboard.writeText(completa)
      setCopiado('ok')
    } catch {
      setCopiado('falhou')
    }
    window.setTimeout(() => setCopiado(null), 2500)
  }

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-tinta">{rotulo}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="block min-w-0 flex-1 rounded-md border border-borda bg-elevada px-3 py-2 font-mono text-xs break-all text-tinta">
          {exibida}
        </code>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => setVisivel((v) => !v)} className={classesBotao('secundario', 'sm')} aria-pressed={visivel}>
            {visivel ? 'Ocultar' : 'Mostrar'}
          </button>
          <button type="button" onClick={copiar} className={classesBotao('secundario', 'sm')}>
            Copiar
          </button>
        </div>
      </div>
      <p aria-live="polite" className="min-h-4 text-xs text-tinta-suave">
        {copiado === 'ok' ? 'Endereço copiado, com o token.' : copiado === 'falhou' ? 'Não deu para copiar; use "Mostrar" e copie à mão.' : ''}
      </p>
    </div>
  )
}
