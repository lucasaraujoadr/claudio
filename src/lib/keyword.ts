/**
 * Identidade de uma keyword: sem acento, sem diferença de caixa e com espaços colapsados.
 * Queries do Search Console costumam vir em minúsculas e sem acento; keywords da IA, não.
 * Toda comparação de "este assunto já tem tema?" passa por aqui, e a coluna
 * topics.keyword_normalizada (índice único) guarda este valor.
 */
export function normalizarKeyword(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').toLowerCase().trim()
}
