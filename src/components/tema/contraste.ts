/**
 * Contraste WCAG 2.x entre duas cores sólidas em hex (#rgb ou #rrggbb).
 * Usado pelo teste que confere os tokens de `globals.css` nos dois temas.
 */

function canal(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function hexParaRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, '')
  const cheio = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(cheio)) throw new Error(`cor inválida: ${hex}`)
  return [0, 2, 4].map((i) => parseInt(cheio.slice(i, i + 2), 16)) as [number, number, number]
}

/** Luminância relativa (0 = preto, 1 = branco). */
export function luminancia(hex: string): number {
  const [r, g, b] = hexParaRgb(hex)
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
}

/** Razão de contraste, de 1 a 21. */
export function razaoContraste(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (claro + 0.05) / (escuro + 0.05)
}

/** Mínimos AA: 4,5 para texto normal; 3 para texto grande e elementos gráficos. */
export const AA_TEXTO = 4.5
export const AA_GRAFICO = 3

/**
 * Extrai os tokens `--og-*` com valor hex de um bloco de seletor no CSS.
 * Lê só a primeira ocorrência literal do seletor; devolve nome (sem `--og-`) → hex.
 */
export function tokensDoBloco(css: string, seletor: string): Record<string, string> {
  const inicio = css.indexOf(seletor)
  if (inicio < 0) throw new Error(`seletor não encontrado: ${seletor}`)
  const abre = css.indexOf('{', inicio)
  const fecha = css.indexOf('}', abre)
  const corpo = css.slice(abre + 1, fecha)
  const tokens: Record<string, string> = {}
  for (const m of corpo.matchAll(/--og-([\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
    tokens[m[1]] = m[2].toLowerCase()
  }
  return tokens
}
