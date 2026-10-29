import { normalizarEmail } from './email'
import type { ChecklistLgpd } from './funis-regras'
import type { ResultadoInscricao } from './funis'

/** Máximo de emails colados de uma vez na inscrição manual. */
export const MAX_EMAILS_INSCRICAO = 1000

/** Emails colados (um por linha, ou separados por vírgula/ponto e vírgula), normalizados e únicos. */
export function lerEmails(texto: string): { emails: string[]; invalidos: number; excedeu: boolean } {
  const partes = texto.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean)
  const emails = new Set<string>()
  let invalidos = 0
  for (const p of partes) {
    const e = normalizarEmail(p)
    if (e) emails.add(e)
    else invalidos++
  }
  const lista = [...emails]
  return { emails: lista.slice(0, MAX_EMAILS_INSCRICAO), invalidos, excedeu: lista.length > MAX_EMAILS_INSCRICAO }
}

export function lerChecklist(form: FormData): ChecklistLgpd {
  return {
    avaliacaoLegitimoInteresse: form.get('avaliacao') === '1',
    descadastroEmTodoEmail: form.get('descadastro') === '1',
    volumeBaixoAquecido: form.get('volume') === '1',
  }
}

export function lerInteiro(v: FormDataEntryValue | null): number | null {
  if (typeof v !== 'string' || !/^\d{1,9}$/.test(v.trim())) return null
  return Number(v.trim())
}

/** Parâmetros da URL que a tela usa para resumir uma inscrição manual. */
export function paramsResultadoInscricao(r: ResultadoInscricao, naoEncontrados: number): URLSearchParams {
  const motivos = Object.entries(r.recusados)
    .filter(([k, n]) => k !== 'nao_encontrado' && (n ?? 0) > 0)
    .map(([k, n]) => `${k}:${n}`)
    .join(',')
  return new URLSearchParams({
    aviso: 'inscricao',
    inscritos: String(r.inscritos.length),
    ja: String(r.jaInscritos),
    nao: String(naoEncontrados + (r.recusados.nao_encontrado ?? 0)),
    ...(motivos ? { motivos } : {}),
  })
}
