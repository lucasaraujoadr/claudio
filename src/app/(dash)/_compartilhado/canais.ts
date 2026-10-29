/**
 * Agrupa a origem/mídia do Google Analytics ("google / cpc") em canais legíveis.
 * Regras próximas do agrupamento padrão do GA4, simplificadas para este site.
 */

export type Canal = 'pago' | 'organico' | 'direto' | 'referencia' | 'social' | 'outros'

export const CANAIS: readonly Canal[] = ['pago', 'organico', 'direto', 'referencia', 'social', 'outros']

export const ROTULO_CANAL: Record<Canal, string> = {
  pago: 'Pago',
  organico: 'Orgânico',
  direto: 'Direto',
  referencia: 'Referência',
  social: 'Social',
  outros: 'Outros',
}

export const DESCRICAO_CANAL: Record<Canal, string> = {
  pago: 'Anúncios (Google Ads e outras mídias pagas)',
  organico: 'Busca orgânica (Google, Bing…)',
  direto: 'Digitou o endereço ou sem origem conhecida',
  referencia: 'Links em outros sites',
  social: 'Redes sociais e WhatsApp',
  outros: 'Origem não classificada (assistentes de IA, e-mail, sem dado…)',
}

const MIDIAS_PAGAS = /^(cpc|ppc|paid|paidsearch|paid[_ -]?search|paid[_ -]?social|cpm|cpv|cpa|display|banner|retargeting|ads?)$/

/** Domínios (ou fontes curtas) de redes sociais e mensageiros. */
const SOCIAIS = [
  'facebook.com', 'facebook', 'fb', 'instagram.com', 'instagram', 'ig', 'threads.net', 't.co', 'x.com',
  'twitter.com', 'twitter', 'linkedin.com', 'linkedin', 'lnkd.in', 'youtube.com', 'youtube', 'tiktok.com',
  'tiktok', 'pinterest.com', 'pinterest', 'whatsapp.com', 'whatsapp', 'wa.me', 'l.wl.co',
]

function ehSocial(fonte: string): boolean {
  const f = fonte.replace(/^www\./, '')
  return SOCIAIS.some((s) => f === s || f.endsWith(`.${s}`))
}

/** Separa "fonte / mídia". Sem " / ", a mídia fica vazia. */
export function separarOrigemMidia(origemMidia: string): { fonte: string; midia: string } {
  const i = origemMidia.lastIndexOf(' / ')
  if (i < 0) return { fonte: origemMidia.trim().toLowerCase(), midia: '' }
  return {
    fonte: origemMidia.slice(0, i).trim().toLowerCase(),
    midia: origemMidia.slice(i + 3).trim().toLowerCase(),
  }
}

export function canalDe(origemMidia: string): Canal {
  const { fonte, midia } = separarOrigemMidia(origemMidia)
  if (fonte === '(direct)' && (midia === '(none)' || midia === '(not set)' || midia === '')) return 'direto'
  if (MIDIAS_PAGAS.test(midia) || midia.includes('paid')) return 'pago'
  if (/social|^sm$|^social-network$|^social-media$/.test(midia)) return 'social'
  if (midia === 'organic') return ehSocial(fonte) ? 'social' : 'organico'
  if (midia === 'referral') return ehSocial(fonte) ? 'social' : 'referencia'
  return 'outros'
}

export type LinhaOrigem = { pagina: string; origemMidia: string; sessoes: number; eventosChave: number }

export type GrupoCanal = {
  canal: Canal
  sessoes: number
  eventosChave: number
  /** Fração das sessões do período (0 a 1). */
  participacao: number
  /** Valores brutos de origem/mídia, do maior para o menor. */
  origens: { origemMidia: string; sessoes: number; eventosChave: number }[]
}

function num(n: number): number {
  return Number.isFinite(n) ? n : 0
}

/** Sessões por canal, do maior para o menor; canais sem sessão ficam de fora. */
export function agruparPorCanal(linhas: readonly LinhaOrigem[]): GrupoCanal[] {
  const total = linhas.reduce((s, l) => s + num(l.sessoes), 0)
  const porCanal = new Map<Canal, Map<string, { sessoes: number; eventosChave: number }>>()
  for (const l of linhas) {
    const canal = canalDe(l.origemMidia)
    const origens = porCanal.get(canal) ?? new Map()
    const o = origens.get(l.origemMidia) ?? { sessoes: 0, eventosChave: 0 }
    o.sessoes += num(l.sessoes)
    o.eventosChave += num(l.eventosChave)
    origens.set(l.origemMidia, o)
    porCanal.set(canal, origens)
  }
  return [...porCanal.entries()]
    .map(([canal, origens]) => {
      const lista = [...origens.entries()]
        .map(([origemMidia, v]) => ({ origemMidia, ...v }))
        .sort((a, b) => b.sessoes - a.sessoes || a.origemMidia.localeCompare(b.origemMidia))
      const sessoes = lista.reduce((s, o) => s + o.sessoes, 0)
      return {
        canal,
        sessoes,
        eventosChave: lista.reduce((s, o) => s + o.eventosChave, 0),
        participacao: total > 0 ? sessoes / total : 0,
        origens: lista,
      }
    })
    .filter((g) => g.sessoes > 0)
    .sort((a, b) => b.sessoes - a.sessoes || CANAIS.indexOf(a.canal) - CANAIS.indexOf(b.canal))
}

export type PaginaDestino = {
  pagina: string
  sessoes: number
  eventosChave: number
  participacao: number
  /** Canal com mais sessões nessa página. */
  canalPrincipal: Canal
  /** Fração das sessões da página que vêm do canal principal. */
  participacaoCanalPrincipal: number
}

/** As `n` páginas de entrada com mais sessões (somando todas as origens). */
export function topPaginas(linhas: readonly LinhaOrigem[], n = 10): PaginaDestino[] {
  const total = linhas.reduce((s, l) => s + num(l.sessoes), 0)
  const porPagina = new Map<string, { sessoes: number; eventosChave: number; canais: Map<Canal, number> }>()
  for (const l of linhas) {
    const p = porPagina.get(l.pagina) ?? { sessoes: 0, eventosChave: 0, canais: new Map() }
    p.sessoes += num(l.sessoes)
    p.eventosChave += num(l.eventosChave)
    const c = canalDe(l.origemMidia)
    p.canais.set(c, (p.canais.get(c) ?? 0) + num(l.sessoes))
    porPagina.set(l.pagina, p)
  }
  return [...porPagina.entries()]
    .filter(([, p]) => p.sessoes > 0)
    .map(([pagina, p]) => {
      const [canalPrincipal, sessoesCanal] = [...p.canais.entries()].sort(
        (a, b) => b[1] - a[1] || CANAIS.indexOf(a[0]) - CANAIS.indexOf(b[0]),
      )[0]
      return {
        pagina,
        sessoes: p.sessoes,
        eventosChave: p.eventosChave,
        participacao: total > 0 ? p.sessoes / total : 0,
        canalPrincipal,
        participacaoCanalPrincipal: p.sessoes > 0 ? sessoesCanal / p.sessoes : 0,
      }
    })
    .sort((a, b) => b.sessoes - a.sessoes || a.pagina.localeCompare(b.pagina))
    .slice(0, n)
}
