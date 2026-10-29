'use client'

import type { ReactNode } from 'react'
import { useEnvioPendente } from '@/components/ui/botao-enviar'

/**
 * Versão antiga, sem estilo próprio: as páginas ainda passam as classes em `className`.
 * A lógica de "enviando" vive em `@/components/ui/botao-enviar`; páginas novas devem
 * usar o `BotaoEnviar` de lá (com variantes do sistema de design).
 */
export function BotaoEnviar({
  children,
  rotuloEnviando,
  className,
}: {
  children: ReactNode
  rotuloEnviando: string
  className?: string
}) {
  const { ref, ocupado } = useEnvioPendente()
  return (
    <button ref={ref} type="submit" disabled={ocupado} aria-busy={ocupado} className={className}>
      {ocupado ? rotuloEnviando : children}
    </button>
  )
}
