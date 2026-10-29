import type { ReactNode } from 'react'
import { cx } from '@/components/ui/cx'
import { larguraPercentual } from './serie'

export type ItemBarra = {
  chave: string
  /** Rótulo da categoria (texto ou um `Selo`). */
  rotulo: ReactNode
  /** Texto simples do rótulo, para a dica e leitores de tela. */
  rotuloTexto: string
  valor: number
  /** Texto extra na dica e na tabela ("12% do total"). */
  detalhe?: string
}

export type GraficoBarrasProps = {
  /** Nome acessível (legenda da tabela). */
  titulo: string
  /** Mostra o título como legenda visível acima das barras. */
  tituloVisivel?: boolean
  itens: ItemBarra[]
  /** Cabeçalho da coluna de valores: "Problemas", "Sessões". */
  rotuloValor: string
  rotuloCategoria: string
  formatar?: (n: number) => string
  className?: string
}

const fmtPadrao = (n: number) => n.toLocaleString('pt-BR')

/**
 * Barras horizontais desenhadas como tabela: o próprio gráfico é a alternativa em texto
 * (leitor de tela lê categoria e valor, linha a linha). Uma série = uma cor (série 1);
 * a identidade de cada categoria vem do rótulo, nunca da cor. Valor na ponta da barra;
 * dica no ponteiro e no foco (cada linha é focável) com o detalhe.
 */
export function GraficoBarras({
  titulo,
  tituloVisivel = false,
  itens,
  rotuloValor,
  rotuloCategoria,
  formatar = fmtPadrao,
  className,
}: GraficoBarrasProps) {
  const maximo = Math.max(0, ...itens.map((i) => i.valor))
  return (
    <table className={cx('w-full border-separate border-spacing-y-1.5 text-sm', className)}>
      <caption className={tituloVisivel ? 'mb-1 text-left text-sm font-medium text-tinta' : 'sr-only'}>{titulo}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">{rotuloCategoria}</th>
          <th scope="col">{rotuloValor}</th>
        </tr>
      </thead>
      <tbody>
        {itens.map((item) => {
          const pct = larguraPercentual(item.valor, maximo)
          return (
            <tr key={item.chave} tabIndex={0} className="group rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco">
              <th scope="row" className="w-[1%] pr-3 text-left font-normal whitespace-nowrap align-middle">
                {item.rotulo}
              </th>
              <td className="relative align-middle">
                <div className="flex items-center gap-2">
                  <div className="relative h-6 min-w-0 flex-1">
                    {/* Barra: até 24 px de espessura, ponta arredondada, base reta. */}
                    {pct > 0 ? (
                      <div
                        aria-hidden="true"
                        className="absolute inset-y-1 left-0 rounded-r bg-serie-1 transition-opacity group-hover:opacity-80 group-focus-visible:opacity-80"
                        style={{ width: `max(${pct}%, 3px)` }}
                      />
                    ) : (
                      <div aria-hidden="true" className="absolute inset-y-1 left-0 w-px bg-borda-forte" />
                    )}
                  </div>
                  <span className="w-16 shrink-0 text-right font-semibold text-tinta tabular-nums">
                    {formatar(item.valor)}
                    {item.detalhe && <span className="sr-only"> ({item.detalhe})</span>}
                  </span>
                </div>
                {item.detalhe && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-7 left-0 z-10 hidden rounded-md border border-borda bg-superficie px-2 py-1 text-xs whitespace-nowrap text-tinta shadow-cartao group-hover:block group-focus-visible:block"
                  >
                    <span className="font-semibold tabular-nums">{formatar(item.valor)}</span>{' '}
                    <span className="text-tinta-suave">
                      {item.rotuloTexto} · {item.detalhe}
                    </span>
                  </span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
