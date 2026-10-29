import { and, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { contatos } from '@/lib/db/schema'
import { ehOrigem, ehStatus, normalizarTags, type Origem, type StatusContato } from './campos'

/** Filtro da lista de contatos, lido da URL; o mesmo filtro alimenta a exportação. */
export type FiltroContatos = {
  q: string
  status: StatusContato | null
  origem: Origem | null
  tag: string | null
  pagina: number
}

type Params = Record<string, string | string[] | undefined>

function um(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : ''
}

export function lerFiltro(sp: Params): FiltroContatos {
  const status = um(sp.status)
  const origem = um(sp.origem)
  const pagina = Number.parseInt(um(sp.pagina), 10)
  return {
    q: um(sp.q).trim().slice(0, 200),
    status: ehStatus(status) ? status : null,
    origem: ehOrigem(origem) ? origem : null,
    tag: normalizarTags([um(sp.tag)])[0] ?? null,
    pagina: Number.isInteger(pagina) && pagina > 0 ? pagina : 1,
  }
}

/** Query string do filtro (sem `pagina` quando 1), para links e para a exportação. */
export function queryDoFiltro(f: FiltroContatos, extra: Partial<FiltroContatos> = {}): string {
  const g = { ...f, ...extra }
  const p = new URLSearchParams()
  if (g.q) p.set('q', g.q)
  if (g.status) p.set('status', g.status)
  if (g.origem) p.set('origem', g.origem)
  if (g.tag) p.set('tag', g.tag)
  if (g.pagina > 1) p.set('pagina', String(g.pagina))
  return p.toString()
}

function escaparLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export function condicaoFiltro(f: FiltroContatos, opts: { ignorarStatus?: boolean } = {}): SQL | undefined {
  const partes: (SQL | undefined)[] = []
  if (f.q) {
    const padrao = `%${escaparLike(f.q)}%`
    partes.push(or(ilike(contatos.nome, padrao), ilike(contatos.email, padrao), ilike(contatos.escritorio, padrao)))
  }
  if (f.status && !opts.ignorarStatus) partes.push(eq(contatos.status, f.status))
  if (f.origem) partes.push(eq(contatos.origem, f.origem))
  if (f.tag) partes.push(sql`${contatos.tags} @> ${JSON.stringify([f.tag])}::jsonb`)
  return and(...partes)
}
