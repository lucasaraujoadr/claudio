'use client'

import { useEffect } from 'react'
import { Aviso } from '@/components/ui/aviso'
import { Botao } from '@/components/ui/botao'

export default function ErroDash({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <Aviso
      tipo="erro"
      titulo="Não foi possível consultar os dados"
      className="max-w-xl"
      acao={
        <Botao variante="secundario" onClick={() => retry()}>
          Tentar novamente
        </Botao>
      }
    >
      A consulta ao banco falhou, então não sabemos o que há aqui. Isso não significa que
      não haja dados. Tente novamente em instantes.
    </Aviso>
  )
}
