import type { ReactNode } from 'react'
import { cx } from './cx'

/** Mesmo formato de `Variacao` em `@/lib/visao-geral`. */
export type VariacaoIndicador = {
  /** Diferença absoluta em relação ao período de comparação. */
  delta: number
  /** Variação em %, já multiplicada por 100; null quando não há base (anterior = 0). */
  percentual: number | null
}

/** Para onde é bom o número ir; define a cor da variação. */
export type SentidoIndicador = 'maior-melhor' | 'menor-melhor' | 'neutro'

export type IndicadorProps = {
  rotulo: ReactNode
  /**
   * O número. `null`/`undefined`/`NaN` mostram o estado "sem dado" — nunca 0.
   * Strings são exibidas como vieram (valor já formatado).
   */
  valor: number | string | null | undefined
  /** Formatação de números; padrão pt-BR com separador de milhar. */
  formatar?: (n: number) => string
  /** Sufixo curto ("%", "cliques"). */
  unidade?: string
  /**
   * Variação contra um período anterior. `null` = não há comparação honesta (mostra
   * "sem comparação"); omitida = não exibe nada.
   */
  variacao?: VariacaoIndicador | null
  /** Contra o quê se compara: "vs. 28 dias antes". */
  comparacao?: string
  sentido?: SentidoIndicador
  /** Texto do estado vazio; padrão "sem dado". */
  textoSemDado?: string
  /** Linha de contexto abaixo do valor (fonte, data). */
  detalhe?: ReactNode
  className?: string
}

const fmtPadrao = (n: number) => n.toLocaleString('pt-BR')

export function temValor(valor: IndicadorProps['valor']): valor is number | string {
  if (valor === null || valor === undefined) return false
  if (typeof valor === 'number') return Number.isFinite(valor)
  return valor.trim() !== ''
}

/** "+1.234 (+12,5%)", "−80 (sem base de comparação)". */
export function formatarVariacao(v: VariacaoIndicador, formatar: (n: number) => string = fmtPadrao): string {
  const sinal = v.delta > 0 ? '+' : v.delta < 0 ? '−' : ''
  const pct =
    v.percentual === null
      ? 'sem base de comparação'
      : `${v.percentual > 0 ? '+' : v.percentual < 0 ? '−' : ''}${Math.abs(v.percentual).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
  return `${sinal}${formatar(Math.abs(v.delta))} (${pct})`
}

function tomDaVariacao(v: VariacaoIndicador, sentido: SentidoIndicador): 'bom' | 'ruim' | 'neutro' {
  if (sentido === 'neutro' || v.delta === 0) return 'neutro'
  const subiu = v.delta > 0
  return subiu === (sentido === 'maior-melhor') ? 'bom' : 'ruim'
}

const COR_TOM = {
  bom: 'text-sucesso',
  ruim: 'text-critico',
  neutro: 'text-tinta-suave',
} as const

export function Indicador({
  rotulo,
  valor,
  formatar = fmtPadrao,
  unidade,
  variacao,
  comparacao,
  sentido = 'maior-melhor',
  textoSemDado = 'sem dado',
  detalhe,
  className,
}: IndicadorProps) {
  const presente = temValor(valor)
  const texto = presente ? (typeof valor === 'number' ? formatar(valor) : valor) : null
  const tom = variacao ? tomDaVariacao(variacao, sentido) : 'neutro'

  return (
    <div className={cx('min-w-0', className)} data-sem-dado={presente ? undefined : ''}>
      <p className="text-sm text-tinta-suave">{rotulo}</p>
      {presente ? (
        <p className="mt-1 text-3xl font-semibold leading-tight tracking-tight text-tinta">
          {texto}
          {unidade && <span className="ml-1 text-base font-medium text-tinta-suave">{unidade}</span>}
        </p>
      ) : (
        <p className="mt-1 text-3xl font-semibold leading-tight text-tinta-suave">
          <span aria-hidden="true">—</span>
          <span className="ml-2 align-middle text-sm font-medium">{textoSemDado}</span>
        </p>
      )}
      {presente && variacao !== undefined && (
        <p className={cx('mt-1 text-sm tabular-nums', variacao ? COR_TOM[tom] : 'text-tinta-suave')}>
          {variacao ? (
            <>
              <span aria-hidden="true" className="mr-1">
                {variacao.delta > 0 ? '▲' : variacao.delta < 0 ? '▼' : '='}
              </span>
              {formatarVariacao(variacao, formatar)}
              {tom !== 'neutro' && <span className="sr-only">{tom === 'bom' ? ' (melhora)' : ' (piora)'}</span>}
            </>
          ) : (
            'sem comparação'
          )}
          {comparacao && <span className="text-tinta-suave"> {comparacao}</span>}
        </p>
      )}
      {detalhe != null && <p className="mt-1 text-xs text-tinta-suave">{detalhe}</p>}
    </div>
  )
}
