import { ehOportunidade, ganhoEstimado } from './ctr'
import type { LinhaGsc } from './gsc'

export type Oportunidade = LinhaGsc & { ganho: number }

/**
 * Queries que ranqueiam entre as posições 5 e 20, ordenadas por ganho estimado
 * (decrescente). Linhas com position, impressions ou ctr não finitos são descartadas
 * antes de qualquer cálculo. Empates: mais impressões primeiro, depois ordem alfabética.
 */
export function montarOportunidades(linhas: LinhaGsc[]): Oportunidade[] {
  return linhas
    .filter(
      (l) =>
        Number.isFinite(l.position) && Number.isFinite(l.impressions) && Number.isFinite(l.ctr),
    )
    .filter((l) => ehOportunidade(l.position))
    .map((l) => ({ ...l, ganho: ganhoEstimado({ impressoes: l.impressions, ctrAtual: l.ctr }) }))
    .sort(
      (a, b) =>
        b.ganho - a.ganho || b.impressions - a.impressions || a.query.localeCompare(b.query, 'pt-BR'),
    )
}

/** Dias inteiros entre uma data 'AAAA-MM-DD' e hoje (UTC-3 aproximado via data local de São Paulo). */
export function diasDesde(dataIso: string, agora: Date = new Date()): number {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora)
  return Math.round((Date.parse(hoje) - Date.parse(dataIso)) / 86_400_000)
}
