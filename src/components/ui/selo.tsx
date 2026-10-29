import type { ReactNode } from 'react'
import { cx } from './cx'
import { IconeTom, type Tom } from './icones'

export type VarianteSelo = Tom | 'neutro' | 'acento'

export type SeloProps = {
  variante?: VarianteSelo
  /** Mostra o ícone do status (padrão: sim para os quatro tons de status). */
  icone?: boolean
  children: ReactNode
  className?: string
}

const CLASSES: Record<VarianteSelo, string> = {
  critico: 'border-critico-borda bg-critico-fundo text-critico',
  aviso: 'border-aviso-borda bg-aviso-fundo text-aviso',
  info: 'border-info-borda bg-info-fundo text-info',
  sucesso: 'border-sucesso-borda bg-sucesso-fundo text-sucesso',
  neutro: 'border-borda bg-elevada text-tinta-suave',
  acento: 'border-acento/40 bg-acento-suave text-acento-texto',
}

/** Severidade da auditoria (enum `severidade` do banco) → variante do selo. */
export const SELO_SEVERIDADE = {
  critico: { variante: 'critico', rotulo: 'Crítico' },
  aviso: { variante: 'aviso', rotulo: 'Aviso' },
  info: { variante: 'info', rotulo: 'Info' },
} as const satisfies Record<string, { variante: VarianteSelo; rotulo: string }>

/** Etiqueta curta de status. A cor nunca vem sozinha: há sempre texto (e ícone nos tons de status). */
export function Selo({ variante = 'neutro', icone, children, className }: SeloProps) {
  const mostrarIcone = icone ?? (variante !== 'neutro' && variante !== 'acento')
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-5 whitespace-nowrap',
        CLASSES[variante],
        className,
      )}
    >
      {mostrarIcone && variante !== 'neutro' && variante !== 'acento' && (
        <IconeTom tom={variante} className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{children}</span>
    </span>
  )
}
