export type LinhaTermo = { query: string; impressoes: number }
export type TermoEmAlta = { query: string; atual: number; anterior: number; aumento: number }

export const MAX_TERMOS_EM_ALTA = 20

function chave(q: string): string {
  return q.replace(/\s+/g, ' ').trim().toLowerCase()
}

function somar(linhas: LinhaTermo[]): Map<string, { query: string; total: number }> {
  const m = new Map<string, { query: string; total: number }>()
  for (const l of linhas) {
    const k = chave(l.query)
    if (!k) continue
    const e = m.get(k)
    if (e) e.total += l.impressoes
    else m.set(k, { query: l.query.trim(), total: l.impressoes })
  }
  return m
}

/**
 * Impressões da janela atual contra a anterior, por query: os 20 maiores aumentos absolutos.
 * Query ausente da janela anterior conta como 0 (é nova); só aumento positivo entra.
 */
export function calcularTermosEmAlta(atual: LinhaTermo[], anterior: LinhaTermo[], limite = MAX_TERMOS_EM_ALTA): TermoEmAlta[] {
  const antes = somar(anterior)
  return [...somar(atual).entries()]
    .map(([k, v]) => {
      const ant = antes.get(k)?.total ?? 0
      return { query: v.query, atual: v.total, anterior: ant, aumento: v.total - ant }
    })
    .filter((t) => t.aumento > 0)
    .sort((a, b) => b.aumento - a.aumento || a.query.localeCompare(b.query, 'pt-BR'))
    .slice(0, limite)
}

export type DatasSnapshot = { atual: string; anterior: string | null }

const DIA_MS = 86_400_000
const dia = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

/**
 * Cada snapshot guarda a janela de 28 dias que termina nele. Para comparar duas janelas sem
 * sobreposição, a anterior é o snapshot mais recente com pelo menos 28 e no máximo 35 dias de
 * diferença. gsc_totais não serve: só tem o total da janela anterior, não o valor por query.
 */
export function escolherDatas(datas: string[]): DatasSnapshot | null {
  if (datas.length === 0) return null
  const ordenadas = [...new Set(datas)].sort().reverse()
  const atual = ordenadas[0]
  const anterior =
    ordenadas.find((d) => {
      const dif = Math.round((dia(atual) - dia(d)) / DIA_MS)
      return dif >= 28 && dif <= 35
    }) ?? null
  return { atual, anterior }
}

export type EstadoTermos = 'ok' | 'sem_dados' | 'sem_janela_anterior'
export type TermosEmAlta = { estado: EstadoTermos; termos: TermoEmAlta[]; atual?: string; anterior?: string }

export const MENSAGEM_SEM_GSC = 'Sem dados do Search Console ainda.'
export const MENSAGEM_SEM_JANELA = 'Só há um período do Search Console sincronizado; a comparação com os 28 dias anteriores aparece quando houver um snapshot com 28 a 35 dias de diferença.'
