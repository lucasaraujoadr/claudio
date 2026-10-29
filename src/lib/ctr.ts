// Curva de CTR por posição média no Google.
// Estes valores são uma estimativa de mercado (curva típica de resultados
// orgânicos), não medidos a partir deste site. Use-os apenas para ranquear
// oportunidades, nunca como métrica real de cliques.
export const CTR_POR_POSICAO = [
  0,     0.280, 0.152, 0.110, 0.080, 0.061,
  0.048, 0.040, 0.033, 0.028, 0.025, 0.021,
  0.018, 0.016, 0.014, 0.013, 0.012, 0.011,
  0.010, 0.009, 0.008,
] as const

const POSICAO_ALVO_PADRAO = 3

/**
 * Devolve o CTR estimado para uma posição média fracionária do Search Console.
 * Arredonda para a posição inteira mais próxima e limita o resultado ao intervalo 1–20.
 */
export function ctrNaPosicao(posicao: number): number {
  const inteira = Math.min(20, Math.max(1, Math.round(posicao)))
  return CTR_POR_POSICAO[inteira]
}

/**
 * Estima cliques adicionais por período se a query chegar à posição alvo.
 * Nunca é negativo; devolve 0 quando não há impressões ou o CTR atual já supera o alvo.
 */
export function ganhoEstimado(e: {
  impressoes: number
  ctrAtual: number
  posicaoAlvo?: number
}): number {
  const impressoes = Math.max(0, e.impressoes)
  const alvo = e.posicaoAlvo ?? POSICAO_ALVO_PADRAO
  return impressoes * Math.max(0, ctrNaPosicao(alvo) - e.ctrAtual)
}

/**
 * Indica se a posição média está na faixa de oportunidade (5 a 20, inclusive).
 * Usa o valor fracionário bruto, sem arredondamento.
 */
export function ehOportunidade(posicao: number): boolean {
  return 5 <= posicao && posicao <= 20
}
