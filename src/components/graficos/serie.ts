/**
 * Funções puras que preparam dados para os gráficos. Sem React, sem banco: testáveis.
 *
 * Regra do painel: dado ausente nunca vira zero. Um dia sem linha na tabela é `null` na
 * série e aparece como lacuna na linha, não como queda a zero.
 */

const DIA_MS = 86_400_000

export type Ponto = { data: string; valor: number | null }

function msIso(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`)
}

function isoMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** `2026-10-28` + 3 → `2026-10-31`. Aritmética em UTC: independe do fuso da máquina. */
export function somarDias(iso: string, dias: number): string {
  return isoMs(msIso(iso) + dias * DIA_MS)
}

/** Todas as datas de `inicio` a `fim`, inclusive. Vazio se `fim` < `inicio` ou datas inválidas. */
export function datasEntre(inicio: string, fim: string): string[] {
  const a = msIso(inicio)
  const b = msIso(fim)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return []
  const datas: string[] = []
  for (let t = a; t <= b; t += DIA_MS) datas.push(isoMs(t))
  return datas
}

/**
 * Série diária contínua de `inicio` a `fim`: um ponto por dia, `null` onde não há linha.
 * Valores não finitos também viram `null`.
 */
export function serieDiaria<T extends { data: string }>(
  linhas: readonly T[],
  valor: (l: T) => number,
  inicio: string,
  fim: string,
): Ponto[] {
  const porData = new Map<string, number>()
  for (const l of linhas) {
    const v = valor(l)
    if (Number.isFinite(v)) porData.set(l.data, v)
  }
  return datasEntre(inicio, fim).map((data) => ({ data, valor: porData.get(data) ?? null }))
}

/** Há pelo menos um valor de verdade? Uma série só de `null` é "sem dado", nunca um eixo em zero. */
export function temDado(valores: readonly (number | null | undefined)[]): boolean {
  return valores.some((v) => typeof v === 'number' && Number.isFinite(v))
}

/** Quantos pontos têm valor. */
export function contarComDado(valores: readonly (number | null)[]): number {
  return valores.filter((v) => typeof v === 'number' && Number.isFinite(v)).length
}

/**
 * Marcas limpas do eixo Y, de 0 até cobrir `maximo` (passo 1, 2, 2,5 ou 5 × 10ⁿ).
 * `maximo` ≤ 0 ou inválido → [0, 1] (o gráfico ainda precisa de uma escala).
 */
export function ticksEixo(maximo: number, alvo = 4): number[] {
  if (!Number.isFinite(maximo) || maximo <= 0) return [0, 1]
  const bruto = maximo / Math.max(1, alvo)
  const ordem = 10 ** Math.floor(Math.log10(bruto))
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * ordem).find((p) => p >= bruto) ?? 10 * ordem
  // Eixo de contagens: passo inteiro.
  const passoFinal = Math.max(1, Math.round(passo * 100) / 100)
  const ticks: number[] = []
  for (let v = 0; v < maximo + passoFinal; v += passoFinal) {
    ticks.push(Math.round(v * 100) / 100)
    if (v >= maximo) break
  }
  return ticks
}

/** Rótulo de eixo compacto em pt-BR: 950, 1,2 mil, 3,4 mi. */
export function formatarCompacto(n: number): string {
  return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** `2026-10-28` → `28/10`. */
export function formatarDiaMes(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

/** `2026-10-28` → `28/10/2026`. */
export function formatarDataIso(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

/**
 * Caminho SVG de uma linha com lacunas: cada trecho contínuo começa com `M`; um `null`
 * interrompe a linha. Um ponto isolado vira um trecho de comprimento zero (o gráfico
 * desenha um marcador por cima para que ele apareça).
 */
export function caminhoLinha(
  valores: readonly (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  let d = ''
  let aberto = false
  valores.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      aberto = false
      return
    }
    d += `${aberto ? 'L' : 'M'}${arred(x(i))},${arred(y(v))}`
    aberto = true
  })
  return d
}

/** Área sob a linha até a base, um polígono por trecho contínuo. */
export function caminhoArea(
  valores: readonly (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
  base: number,
): string {
  const trechos: number[][] = []
  let atual: number[] = []
  valores.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (atual.length) trechos.push(atual)
      atual = []
      return
    }
    atual.push(i)
  })
  if (atual.length) trechos.push(atual)
  return trechos
    .filter((t) => t.length > 1)
    .map((t) => {
      const topo = t.map((i, k) => `${k === 0 ? 'M' : 'L'}${arred(x(i))},${arred(y(valores[i] as number))}`).join('')
      return `${topo}L${arred(x(t[t.length - 1]))},${arred(base)}L${arred(x(t[0]))},${arred(base)}Z`
    })
    .join('')
}

/** Índices de ~`quantos` rótulos do eixo X, igualmente espaçados, sempre com o último. */
export function indicesRotulosX(total: number, quantos: number): number[] {
  if (total <= 0) return []
  if (total <= quantos) return Array.from({ length: total }, (_, i) => i)
  const passo = (total - 1) / (quantos - 1)
  const idx = new Set<number>()
  for (let k = 0; k < quantos; k++) idx.add(Math.round(k * passo))
  return [...idx].sort((a, b) => a - b)
}

/** Índice do ponto mais próximo de uma coordenada X (crosshair). */
export function indiceMaisProximo(px: number, total: number, x0: number, largura: number): number {
  if (total <= 1) return 0
  const passo = largura / (total - 1)
  return Math.min(total - 1, Math.max(0, Math.round((px - x0) / passo)))
}

/** Largura de uma barra em % da maior (0 a 100). Máximo 0 → 0. */
export function larguraPercentual(valor: number, maximo: number): number {
  if (!Number.isFinite(valor) || !Number.isFinite(maximo) || maximo <= 0 || valor <= 0) return 0
  return Math.min(100, (valor / maximo) * 100)
}

function arred(n: number): number {
  return Math.round(n * 10) / 10
}
