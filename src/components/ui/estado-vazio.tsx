import type { ReactNode } from 'react'
import { cx } from './cx'

export type EstadoVazioProps = {
  titulo: ReactNode
  /** Por que está vazio e o que fazer — nunca um zero disfarçado de resultado. */
  explicacao?: ReactNode
  /** Botão ou link para resolver ("Rodar auditoria", "Conectar"). */
  acao?: ReactNode
  /** Nível do título; padrão h2. */
  nivelTitulo?: 2 | 3
  className?: string
}

export function EstadoVazio({ titulo, explicacao, acao, nivelTitulo = 2, className }: EstadoVazioProps) {
  const Titulo = nivelTitulo === 2 ? 'h2' : 'h3'
  return (
    <div
      className={cx(
        'flex flex-col items-center rounded-xl border border-dashed border-borda-forte bg-superficie/60 px-6 py-10 text-center',
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="mb-3 size-8 text-acento-texto"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="4" y="3.5" width="16" height="17" rx="2" />
        <path d="M8 8.5h8M8 12h8M8 15.5h4" />
      </svg>
      <Titulo className="font-titulo text-lg font-semibold text-tinta">{titulo}</Titulo>
      {explicacao != null && <div className="mt-1 max-w-prose text-sm text-tinta-suave">{explicacao}</div>}
      {acao != null && <div className="mt-4 flex flex-wrap justify-center gap-2">{acao}</div>}
    </div>
  )
}
