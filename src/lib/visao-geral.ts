import { janelas } from './janelas-gsc'

const DIA_MS = 86_400_000
export const DIAS_JANELA = 28
export const TOLERANCIA_DIAS = 3

export type Variacao = { delta: number; percentual: number | null }

/**
 * Variação entre dois períodos. `percentual` é null quando o período anterior é zero
 * (a divisão não tem significado) e 0 quando os valores são iguais. Entradas não
 * finitas são tratadas como 0: o resultado nunca contém Infinity nem NaN.
 */
export function calcularVariacao(atual: number, anterior: number): Variacao {
  const a = Number.isFinite(atual) ? atual : 0
  const b = Number.isFinite(anterior) ? anterior : 0
  const delta = a - b
  if (b === 0) return { delta, percentual: delta === 0 ? 0 : null }
  return { delta, percentual: (delta / b) * 100 }
}

function ms(dataIso: string): number {
  return Date.parse(`${dataIso}T00:00:00Z`)
}

/**
 * Entre os snapshots armazenados, o mais próximo de 28 dias antes do snapshot atual,
 * aceitando 28 ± 3 dias. Null se não houver: nesse caso não existe comparação honesta.
 * Empate: o mais antigo.
 */
export function escolherSnapshotComparacao(atual: string, datas: string[]): string | null {
  const alvo = ms(atual) - DIAS_JANELA * DIA_MS
  let melhor: string | null = null
  let melhorDist = Infinity
  for (const d of datas) {
    const t = ms(d)
    if (!Number.isFinite(t) || d >= atual) continue
    const dist = Math.abs(t - alvo)
    if (dist > TOLERANCIA_DIAS * DIA_MS) continue
    if (dist < melhorDist || (dist === melhorDist && melhor !== null && d < melhor)) {
      melhor = d
      melhorDist = dist
    }
  }
  return melhor
}

export type Totais = { clicks: number; impressions: number }
export type LinhaTotais = {
  snapshotDate: string
  clicksAtual: number
  impressionsAtual: number
  clicksAnterior: number
  impressionsAnterior: number
}
export type FonteComparacao =
  | { tipo: 'totais'; atual: Totais; anterior: Totais; periodoAnterior: { inicio: string; fim: string } }
  | { tipo: 'snapshot'; dataAnterior: string }
  | { tipo: 'nenhuma' }

/**
 * De onde vem a comparação da visão geral. Preferência: os totais que o cron gravou
 * para o snapshot mais recente (janela atual contra os 28 dias anteriores, buscados
 * juntos). Sem essa linha, recorre ao snapshot armazenado de cerca de 28 dias antes.
 */
export function escolherComparacao(
  ultima: string,
  datas: string[],
  totais: LinhaTotais | null,
): FonteComparacao {
  if (totais && totais.snapshotDate === ultima) {
    return {
      tipo: 'totais',
      atual: { clicks: totais.clicksAtual, impressions: totais.impressionsAtual },
      anterior: { clicks: totais.clicksAnterior, impressions: totais.impressionsAnterior },
      periodoAnterior: janelas(new Date(`${ultima}T00:00:00Z`)).anterior,
    }
  }
  const dataAnterior = escolherSnapshotComparacao(ultima, datas)
  return dataAnterior ? { tipo: 'snapshot', dataAnterior } : { tipo: 'nenhuma' }
}
