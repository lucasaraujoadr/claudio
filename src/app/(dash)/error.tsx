'use client'

import { useEffect } from 'react'

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
    <div
      role="alert"
      className="max-w-xl rounded-lg border border-red-200 bg-red-50 p-6 text-red-900"
    >
      <h2 className="text-lg font-semibold">Não foi possível consultar os dados</h2>
      <p className="mt-2 text-sm">
        A consulta ao banco falhou, então não sabemos o que há aqui. Isso não significa que
        não haja dados. Tente novamente em instantes.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-4 rounded bg-red-900 px-3 py-2 text-sm font-medium text-white hover:bg-red-800"
      >
        Tentar novamente
      </button>
    </div>
  )
}
