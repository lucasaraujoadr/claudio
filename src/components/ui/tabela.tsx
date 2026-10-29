import type { ReactNode } from 'react'
import { cx } from './cx'

export type TabelaProps = {
  /**
   * Legenda da tabela (`<caption>`), obrigatória: nomeia a tabela e a região rolável
   * para leitores de tela.
   */
  legenda: string
  /** Mostra a legenda visualmente; padrão: só para leitores de tela. */
  legendaVisivel?: boolean
  /** `<thead>`, `<tbody>`, `<tfoot>` comuns; o estilo vem do contêiner. */
  children: ReactNode
  /** Linhas mais baixas, para listas longas. */
  compacta?: boolean
  className?: string
}

/** Classe para células numéricas: alinhadas à direita, dígitos de largura fixa. */
export const CELULA_NUMERICA = 'text-right tabular-nums'

/**
 * Tabela responsiva: em telas estreitas rola na horizontal dentro do próprio contêiner
 * (a página nunca rola de lado). O contêiner é focável para rolar pelo teclado.
 */
export function Tabela({ legenda, legendaVisivel = false, children, compacta = false, className }: TabelaProps) {
  const py = compacta ? '[&_td]:py-1.5 [&_th]:py-1.5' : '[&_td]:py-2.5 [&_th]:py-2.5'
  return (
    <div
      role="region"
      aria-label={legenda}
      tabIndex={0}
      className={cx(
        'w-full overflow-x-auto rounded-lg border border-borda bg-superficie focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco',
        className,
      )}
    >
      <table
        className={cx(
          'w-full border-collapse text-left text-sm tabular-nums',
          '[&_thead_th]:border-b [&_thead_th]:border-borda [&_thead_th]:bg-elevada [&_thead_th]:text-xs [&_thead_th]:font-semibold [&_thead_th]:tracking-wide [&_thead_th]:text-tinta-suave [&_thead_th]:uppercase',
          '[&_th]:px-3 [&_td]:px-3 [&_td]:align-top [&_th]:align-bottom [&_th]:whitespace-nowrap',
          '[&_tbody_tr]:border-b [&_tbody_tr]:border-borda [&_tbody_tr:last-child]:border-b-0 [&_tbody_tr:hover]:bg-elevada',
          '[&_tfoot]:border-t [&_tfoot]:border-borda-forte [&_tfoot]:font-medium',
          py,
        )}
      >
        <caption className={legendaVisivel ? 'px-3 pt-3 pb-1 text-left text-sm font-medium text-tinta' : 'sr-only'}>
          {legenda}
        </caption>
        {children}
      </table>
    </div>
  )
}
