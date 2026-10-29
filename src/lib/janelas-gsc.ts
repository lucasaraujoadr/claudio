const DIA_MS = 24 * 60 * 60 * 1000

export function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Aritmética em UTC: independe do fuso da máquina. */
export function meiaNoiteUtc(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * Janela atual (28 dias terminando 3 dias antes de hoje) e os 28 dias imediatamente
 * anteriores. Sem dependências de servidor: a visão geral usa para rotular a comparação.
 */
export function janelas(hoje: Date): {
  atual: { inicio: string; fim: string }
  anterior: { inicio: string; fim: string }
} {
  const base = meiaNoiteUtc(hoje)
  const fimAtual = base - 3 * DIA_MS
  const inicioAtual = fimAtual - 27 * DIA_MS
  const fimAnterior = inicioAtual - DIA_MS
  const inicioAnterior = fimAnterior - 27 * DIA_MS
  return {
    atual: { inicio: iso(inicioAtual), fim: iso(fimAtual) },
    anterior: { inicio: iso(inicioAnterior), fim: iso(fimAnterior) },
  }
}
