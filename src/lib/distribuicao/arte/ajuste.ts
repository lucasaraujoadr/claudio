export type CaixaTexto = { largura: number; alturaMax: number }

/** Estima as linhas de um texto quebrando por palavras (e por '\n'), com largura média de caractere. */
export function estimarLinhas(texto: string, largura: number, tamanho: number, fatorLargura: number): number | null {
  const larguraChar = fatorLargura * tamanho
  const maxChars = Math.floor(largura / larguraChar)
  if (maxChars < 1) return null
  let linhas = 0
  for (const paragrafo of texto.split('\n')) {
    const palavras = paragrafo.split(/\s+/).filter(Boolean)
    if (palavras.length === 0) {
      linhas += 1
      continue
    }
    let atual = 0
    linhas += 1
    for (const p of palavras) {
      if (p.length > maxChars) return null // palavra mais larga que a caixa vazaria
      if (atual === 0) atual = p.length
      else if (atual + 1 + p.length <= maxChars) atual += 1 + p.length
      else {
        linhas += 1
        atual = p.length
      }
    }
  }
  return linhas
}

/** Maior degrau (em ordem decrescente) em que o texto cabe na caixa; null se não couber em nenhum. */
export function ajustarFonte(
  texto: string,
  caixa: CaixaTexto,
  degraus: number[],
  fatorLargura = 0.52,
  alturaLinha = 1.25,
): { tamanho: number; linhas: number } | null {
  for (const tamanho of degraus) {
    const linhas = estimarLinhas(texto, caixa.largura, tamanho, fatorLargura)
    if (linhas === null) continue
    if (linhas * tamanho * alturaLinha <= caixa.alturaMax) return { tamanho, linhas }
  }
  return null
}
