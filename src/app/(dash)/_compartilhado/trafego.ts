/**
 * Regras puras da tela de Tráfego e do bloco de tráfego da visão geral, a partir da
 * série diária do Google Analytics (`ga4_diario`).
 */
import { datasEntre, somarDias, type Ponto } from '@/components/graficos/serie'
import { calcularVariacao, type Variacao } from '@/lib/visao-geral'

export type DiaGa4 = {
  data: string
  sessoes: number
  usuarios: number
  sessoesEngajadas: number
  eventosChave: number
}

/**
 * Métricas que se podem somar dia a dia. Usuários ficam de fora de propósito: somar os
 * usuários de cada dia conta de novo quem voltou; o total de usuários vem de `ga4_totais`.
 */
export type MetricaGa4 = 'sessoes' | 'sessoesEngajadas' | 'eventosChave'

export const METRICAS_GA4: readonly { chave: MetricaGa4; rotulo: string }[] = [
  { chave: 'sessoes', rotulo: 'Sessões' },
  { chave: 'sessoesEngajadas', rotulo: 'Sessões engajadas' },
  { chave: 'eventosChave', rotulo: 'Eventos-chave' },
]

/** Linha de `ga4_totais`: usuários deduplicados das duas janelas de 28 dias. */
export type TotaisUsuariosGa4 = {
  inicioAtual: string
  fimAtual: string
  inicioAnterior: string
  fimAnterior: string
  usuariosAtual: number
  usuariosAnterior: number
}

/** Valor e variação do indicador de usuários. Sem linha: null ("sem dado", nunca uma soma). */
export function indicadorUsuarios(t: TotaisUsuariosGa4 | null | undefined): {
  valor: number
  variacao: Variacao
  periodo: Janela
  anterior: Janela
} | null {
  if (!t || !Number.isFinite(t.usuariosAtual)) return null
  return {
    valor: t.usuariosAtual,
    variacao: calcularVariacao(t.usuariosAtual, t.usuariosAnterior),
    periodo: { inicio: t.inicioAtual, fim: t.fimAtual },
    anterior: { inicio: t.inicioAnterior, fim: t.fimAnterior },
  }
}

/** Nenhum evento-chave nas duas janelas: provavelmente nenhum evento está marcado como chave. */
export function semEventosChave(r: Pick<ResumoTrafego, 'totais' | 'comparacao'>): boolean {
  return r.totais.eventosChave === 0 && (r.comparacao?.totais.eventosChave ?? 0) === 0
}

export const DIAS_JANELA_TRAFEGO = 28
export const DIAS_SERIE_TRAFEGO = 90

export type Janela = { inicio: string; fim: string }

/** Janela de `dias` terminando em `fim` e a janela de mesmo tamanho imediatamente anterior. */
export function janelasComparacao(fim: string, dias = DIAS_JANELA_TRAFEGO): { atual: Janela; anterior: Janela } {
  const inicioAtual = somarDias(fim, -(dias - 1))
  const fimAnterior = somarDias(inicioAtual, -1)
  return {
    atual: { inicio: inicioAtual, fim },
    anterior: { inicio: somarDias(fimAnterior, -(dias - 1)), fim: fimAnterior },
  }
}

type Totais = Record<MetricaGa4, number>

function somar(dias: readonly DiaGa4[], j: Janela): { totais: Totais; diasComDado: number } {
  const totais: Totais = { sessoes: 0, sessoesEngajadas: 0, eventosChave: 0 }
  let diasComDado = 0
  for (const d of dias) {
    if (d.data < j.inicio || d.data > j.fim) continue
    diasComDado++
    for (const m of METRICAS_GA4) totais[m.chave] += Number.isFinite(d[m.chave]) ? d[m.chave] : 0
  }
  return { totais, diasComDado }
}

/**
 * Período que o Analytics de fato cobriu: do primeiro ao último dia gravado, estendido até
 * a véspera da última sincronização bem-sucedida (a rotina busca até "ontem", em UTC).
 * O GA4 não devolve linha para dia sem sessão, então, dentro dessa faixa, dia sem linha é
 * zero de verdade; fora dela, é "sem dado". Null sem nenhum dia gravado.
 */
export function faixaSincronizada(dias: readonly DiaGa4[], ultimaSincronizacaoOk?: Date | null): Janela | null {
  const datas = dias.map((d) => d.data).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  if (datas.length === 0) return null
  let fim = datas[datas.length - 1]
  if (ultimaSincronizacaoOk && Number.isFinite(ultimaSincronizacaoOk.getTime())) {
    const vespera = somarDias(ultimaSincronizacaoOk.toISOString().slice(0, 10), -1)
    if (vespera > fim) fim = vespera
  }
  return { inicio: datas[0], fim }
}

/**
 * Série diária de uma métrica de `inicio` a `fim`: valor gravado; 0 para dia sem linha
 * dentro da faixa sincronizada; `null` (sem dado) fora dela.
 */
export function preencherDiasGa4(
  dias: readonly DiaGa4[],
  metrica: MetricaGa4,
  faixa: Janela,
  inicio: string,
  fim: string,
): Ponto[] {
  const porData = new Map(dias.map((d) => [d.data, d[metrica]]))
  return datasEntre(inicio, fim).map((data) => {
    const v = porData.get(data)
    if (v !== undefined && Number.isFinite(v)) return { data, valor: v }
    return { data, valor: data >= faixa.inicio && data <= faixa.fim ? 0 : null }
  })
}

export type ResumoTrafego = {
  /** Último dia da faixa sincronizada: a janela termina nele. */
  ultimoDia: string
  faixa: Janela
  atual: Janela
  anterior: Janela
  totais: Totais
  /** Dias da janela atual sem sessão nenhuma (sem linha no GA4 dentro da faixa). */
  diasSemSessao: number
  /** Null quando não há comparação honesta (a faixa sincronizada não cobre a janela anterior). */
  comparacao: { totais: Totais; variacoes: Record<MetricaGa4, Variacao> } | null
}

/**
 * Totais dos últimos 28 dias da faixa sincronizada e variação contra os 28 anteriores.
 * Null sem nenhum dia gravado (estado "sem dado", nunca zeros). Só compara quando a faixa
 * sincronizada cobre toda a janela anterior: período nunca buscado não é "zero sessões".
 */
export function resumirTrafego(
  dias: readonly DiaGa4[],
  ultimaSincronizacaoOk?: Date | null,
  tamanho = DIAS_JANELA_TRAFEGO,
): ResumoTrafego | null {
  const faixa = faixaSincronizada(dias, ultimaSincronizacaoOk)
  if (!faixa) return null
  const validos = dias.filter((d) => d.data >= faixa.inicio && d.data <= faixa.fim)
  const { atual, anterior } = janelasComparacao(faixa.fim, tamanho)
  const a = somar(validos, atual)
  const b = somar(validos, anterior)
  const cobreAnterior = faixa.inicio <= anterior.inicio
  const diasAtual = datasEntre(atual.inicio < faixa.inicio ? faixa.inicio : atual.inicio, atual.fim).length
  return {
    ultimoDia: faixa.fim,
    faixa,
    atual,
    anterior,
    totais: a.totais,
    diasSemSessao: diasAtual - a.diasComDado,
    comparacao: cobreAnterior
      ? {
          totais: b.totais,
          variacoes: Object.fromEntries(
            METRICAS_GA4.map((m) => [m.chave, calcularVariacao(a.totais[m.chave], b.totais[m.chave])]),
          ) as Record<MetricaGa4, Variacao>,
        }
      : null,
  }
}

/** Série diária de uma métrica nos últimos `tamanho` dias até o fim da faixa sincronizada. */
export function serieTrafego(
  dias: readonly DiaGa4[],
  metrica: MetricaGa4,
  resumo: Pick<ResumoTrafego, 'faixa' | 'ultimoDia'>,
  tamanho = DIAS_SERIE_TRAFEGO,
): Ponto[] {
  return preencherDiasGa4(dias, metrica, resumo.faixa, somarDias(resumo.ultimoDia, -(tamanho - 1)), resumo.ultimoDia)
}
