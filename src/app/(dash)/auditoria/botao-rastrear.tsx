'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function BotaoRastrear({ rotulo }: { rotulo: string }) {
  const router = useRouter()
  const [rodando, setRodando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function rastrear() {
    setRodando(true)
    setErro(null)
    try {
      const resposta = await fetch('/api/auditoria/run', { method: 'POST' })
      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null
        setErro(corpo?.erro ?? 'O rastreamento falhou.')
      }
    } catch {
      setErro('Não foi possível iniciar o rastreamento.')
    } finally {
      setRodando(false)
      router.refresh()
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={rastrear}
        disabled={rodando}
        className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {rodando ? 'Rastreando… (pode levar alguns minutos)' : rotulo}
      </button>
      {erro && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {erro}
        </p>
      )}
    </div>
  )
}
