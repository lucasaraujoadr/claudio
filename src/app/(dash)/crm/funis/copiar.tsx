'use client'

import { useState } from 'react'
import { classesBotao } from '@/components/ui'

/** Botão "Copiar" para um texto pronto (assunto, pré-cabeçalho, corpo do email). */
export function BotaoCopiar({ texto, rotulo = 'Copiar' }: { texto: string; rotulo?: string }) {
  const [estado, setEstado] = useState<'ok' | 'falhou' | null>(null)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      setEstado('ok')
    } catch {
      setEstado('falhou')
    }
    window.setTimeout(() => setEstado(null), 2500)
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={copiar} className={classesBotao('secundario', 'sm')}>
        {rotulo}
      </button>
      <span aria-live="polite" className="text-xs text-tinta-suave">
        {estado === 'ok' ? 'Copiado.' : estado === 'falhou' ? 'Não deu para copiar; selecione e copie à mão.' : ''}
      </span>
    </span>
  )
}

/** Destaca os marcadores ainda não resolvidos (`[link do WhatsApp]`, `[fonte do contato]`). */
function ComMarcadores({ texto }: { texto: string }) {
  const partes = texto.split(/(\[(?:link do WhatsApp|fonte do contato)\])/)
  return (
    <>
      {partes.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-aviso-fundo px-0.5 font-semibold text-aviso">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  )
}

/** Bloco de texto com rótulo e botão de copiar. */
export function TextoCopiavel({ rotulo, texto, multilinha = false }: { rotulo: string; texto: string; multilinha?: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-tinta-suave">{rotulo}</p>
        <BotaoCopiar texto={texto} />
      </div>
      {multilinha ? (
        <pre className="max-h-96 overflow-auto rounded-md border border-borda bg-elevada px-3 py-2 font-sans text-sm whitespace-pre-wrap text-tinta"><ComMarcadores texto={texto} /></pre>
      ) : (
        <p className="rounded-md border border-borda bg-elevada px-3 py-2 text-sm text-tinta"><ComMarcadores texto={texto} /></p>
      )}
    </div>
  )
}
