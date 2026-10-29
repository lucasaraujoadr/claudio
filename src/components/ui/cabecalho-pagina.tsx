import type { ReactNode } from 'react'
import { cx } from './cx'

export type CabecalhoPaginaProps = {
  titulo: ReactNode
  subtitulo?: ReactNode
  /** Rótulo pequeno acima do título: a seção ("SEO", "CRM"). */
  secao?: ReactNode
  /** Botões à direita; quebram para baixo do título em telas estreitas. */
  acoes?: ReactNode
  className?: string
}

export function CabecalhoPagina({ titulo, subtitulo, secao, acoes, className }: CabecalhoPaginaProps) {
  return (
    <header className={cx('flex flex-col gap-4 border-b border-borda pb-5 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {secao != null && (
          <p className="mb-1 text-xs font-semibold tracking-[0.14em] text-acento-texto uppercase">{secao}</p>
        )}
        <h1 className="font-titulo text-[1.75rem] leading-tight font-semibold text-tinta sm:text-3xl">{titulo}</h1>
        {subtitulo != null && <p className="mt-1.5 max-w-prose text-sm text-tinta-suave">{subtitulo}</p>}
      </div>
      {acoes != null && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </header>
  )
}
