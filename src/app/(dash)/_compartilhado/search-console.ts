/** Séries do Search Console para os gráficos (puro). */
import { serieDiaria, temDado, type Ponto } from '@/components/graficos/serie'

/** Uma linha de `gsc_totais`: cliques e impressões da janela de 28 dias daquele dia de sincronização. */
export type LinhaTotaisGsc = { data: string; cliques: number; impressoes: number }

export type SeriesGsc = { datas: string[]; cliques: Ponto[]; impressoes: Ponto[] }

/**
 * Séries contínuas do primeiro ao último dia sincronizado; dia sem sincronização = `null`
 * (lacuna). Null quando não há nenhuma linha: o gráfico mostra "sem dado", nunca zero.
 */
export function seriesSearchConsole(linhas: readonly LinhaTotaisGsc[]): SeriesGsc | null {
  const datas = linhas.map((l) => l.data).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  if (datas.length === 0) return null
  const inicio = datas[0]
  const fim = datas[datas.length - 1]
  const cliques = serieDiaria(linhas, (l) => l.cliques, inicio, fim)
  const impressoes = serieDiaria(linhas, (l) => l.impressoes, inicio, fim)
  if (!temDado(cliques.map((p) => p.valor)) && !temDado(impressoes.map((p) => p.valor))) return null
  return { datas: cliques.map((p) => p.data), cliques, impressoes }
}
