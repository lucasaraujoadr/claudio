'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Aviso } from '@/components/ui/aviso'
import { classesBotao } from '@/components/ui/botao'

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
        aria-busy={rodando}
        className={classesBotao('primario')}
      >
        {rodando ? 'Rastreando… (pode levar alguns minutos)' : rotulo}
      </button>
      {erro && (
        <Aviso tipo="erro" className="mt-2">
          {erro}
        </Aviso>
      )}
    </div>
  )
}
