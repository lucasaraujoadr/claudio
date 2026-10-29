import { GraficoLinha } from '@/components/graficos/grafico-linha'
import { GraficoSemDado } from '@/components/graficos/grafico-sem-dado'
import { contarComDado, formatarDataIso } from '@/components/graficos/serie'
import type { SeriesGsc } from './search-console'
import type { ExplicacaoGsc } from './sincronizacao'

export type GraficosSearchConsoleProps = {
  /** `undefined` = a leitura falhou; `null` = não há dado. */
  series: SeriesGsc | null | undefined
  explicacao: ExplicacaoGsc | null
  altura?: number
}

/**
 * Cliques e impressões do Search Console em dois gráficos separados (escalas diferentes:
 * nunca dois eixos no mesmo gráfico). Sem dado, mostra o motivo, sem eixo nenhum.
 */
export function GraficosSearchConsole({ series, explicacao, altura = 160 }: GraficosSearchConsoleProps) {
  if (!series) {
    const motivo =
      series === undefined
        ? 'Não foi possível ler os dados do Search Console agora. Isso não significa que não haja cliques.'
        : explicacao
          ? `${explicacao.titulo}.`
          : 'O Search Console ainda não foi sincronizado: não há cliques nem impressões para desenhar.'
    return <GraficoSemDado titulo="Cliques e impressões por dia (Search Console)" motivo={motivo} altura={altura} />
  }
  const dias = series.datas.length
  const sincronizados = contarComDado(series.cliques.map((p) => p.valor))
  const periodo = `${formatarDataIso(series.datas[0])} a ${formatarDataIso(series.datas[dias - 1])}`
  const nota = `Cada ponto é o total da janela de 28 dias do Search Console no dia em que foi sincronizado (${sincronizados} de ${dias} dias com sincronização; os demais aparecem como lacuna).`
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <GraficoLinha
        titulo="Cliques (janela de 28 dias), por dia de sincronização"
        resumo={`${periodo}. ${nota}`}
        datas={series.datas}
        series={[{ id: 'cliques', rotulo: 'Cliques', cor: 1, valores: series.cliques.map((p) => p.valor) }]}
        unidade="cliques"
        altura={altura}
      />
      <GraficoLinha
        titulo="Impressões (janela de 28 dias), por dia de sincronização"
        resumo={`${periodo}. ${nota}`}
        datas={series.datas}
        series={[{ id: 'impressoes', rotulo: 'Impressões', cor: 1, valores: series.impressoes.map((p) => p.valor) }]}
        unidade="impressões"
        altura={altura}
      />
    </div>
  )
}
