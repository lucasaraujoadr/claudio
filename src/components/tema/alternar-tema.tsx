'use client'

import { useLayoutEffect } from 'react'
import { ATRIBUTO_TEMA, aplicarTema, alternarTema, sincronizarCorDoTema, temaAtual } from './tema'

export type AlternarTemaProps = {
  className?: string
}

/**
 * Botão de alternância de tema. Não guarda estado no React: o rótulo e o ícone
 * mudam por CSS (variante `dark:`), então o HTML do servidor e o do cliente são
 * idênticos qualquer que seja o tema — sem divergência de hidratação.
 */
export function AlternarTema({ className = '' }: AlternarTemaProps) {
  // Em desenvolvimento o Strict Mode remonta <html> e apaga o atributo que o script
  // inline aplicou; reaplica antes da pintura. Em produção é um no-op.
  // A cor da barra do navegador também passa a seguir o tema escolhido (não só o do
  // sistema), inclusive quando os <meta> chegaram depois do script do <head>.
  useLayoutEffect(() => {
    const raiz = document.documentElement
    if (!raiz.getAttribute(ATRIBUTO_TEMA)) raiz.setAttribute(ATRIBUTO_TEMA, temaAtual())
    sincronizarCorDoTema(temaAtual())
  }, [])

  return (
    <button
      type="button"
      onClick={() => aplicarTema(alternarTema(temaAtual()))}
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-borda text-tinta-suave transition-colors hover:border-borda-forte hover:bg-elevada hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco ${className}`}
    >
      <span className="sr-only dark:hidden">Mudar para o tema escuro</span>
      <span className="sr-only hidden dark:inline">Mudar para o tema claro</span>
      {/* Lua no claro (vai para o escuro); sol no escuro (vai para o claro). */}
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="size-4 dark:hidden"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7Z" />
      </svg>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="hidden size-4 dark:block"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <circle cx="10" cy="10" r="3.4" />
        <path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4" />
      </svg>
    </button>
  )
}
