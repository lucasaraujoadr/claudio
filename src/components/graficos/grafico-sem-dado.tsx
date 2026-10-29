import type { ReactNode } from 'react'
import { cx } from '@/components/ui/cx'

export type GraficoSemDadoProps = {
  /** Nome do gráfico que não pode ser desenhado. */
  titulo: string
  /** Por que não há dado, em pt-BR simples ("O Search Console ainda não liberou acesso."). */
  motivo: ReactNode
  /** O que fazer, se houver algo a fazer. */
  acao?: ReactNode
  /** Altura reservada, igual à do gráfico, para a página não pular quando o dado chegar. */
  altura?: number
  className?: string
}

/**
 * Lugar de um gráfico sem dado. De propósito, não desenha eixo, grade nem linha de base:
 * um eixo vazio leria como "zero". Mostra só o motivo e, se houver, a ação.
 */
export function GraficoSemDado({ titulo, motivo, acao, altura = 220, className }: GraficoSemDadoProps) {
  return (
    <div
      role="group"
      aria-label={titulo}
      data-sem-dado=""
      style={{ minHeight: altura }}
      className={cx(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-borda-forte bg-elevada/50 px-6 py-8 text-center',
        className,
      )}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-7 text-tinta-suave" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        {/* Linha interrompida: "não há série", não "série em zero". */}
        <path d="M3 16c2-3 3.5-4 5-4M16 8c1.5 0 3 1 5 4" />
        <path d="M10.5 11.5 13.5 8.5" strokeDasharray="0.1 2.6" />
      </svg>
      <p className="text-sm font-semibold text-tinta">Sem dado</p>
      <div className="max-w-md text-sm text-tinta-suave">{motivo}</div>
      {acao != null && <div className="mt-1 text-sm">{acao}</div>}
    </div>
  )
}
