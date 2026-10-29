import { asc, count, desc, eq, sql } from 'drizzle-orm'
import { contatos, type Contato } from '@/lib/db/schema'
import { bancoPadrao, type BancoCrm } from './banco'
import { STATUS_CONTATO, type StatusContato } from './campos'
import { condicaoFiltro, type FiltroContatos } from './filtros'

export const POR_PAGINA = 50

export async function listarContatos(
  f: FiltroContatos,
  opts: { db?: BancoCrm; porPagina?: number } = {},
): Promise<{ itens: Contato[]; total: number }> {
  const db = opts.db ?? bancoPadrao()
  const porPagina = opts.porPagina ?? POR_PAGINA
  const onde = condicaoFiltro(f)
  const [itens, [{ total }]] = await Promise.all([
    db
      .select()
      .from(contatos)
      .where(onde)
      .orderBy(desc(contatos.atualizadoEm), desc(contatos.id))
      .limit(porPagina)
      .offset((f.pagina - 1) * porPagina),
    db.select({ total: count() }).from(contatos).where(onde),
  ])
  return { itens, total }
}

/** Contatos por status na base inteira (os cartões do topo não dependem do filtro). */
export async function contarPorStatus(opts: { db?: BancoCrm } = {}): Promise<Record<StatusContato, number>> {
  const db = opts.db ?? bancoPadrao()
  const linhas = await db.select({ status: contatos.status, n: count() }).from(contatos).groupBy(contatos.status)
  const saida = Object.fromEntries(STATUS_CONTATO.map((s) => [s, 0])) as Record<StatusContato, number>
  for (const l of linhas) saida[l.status] = l.n
  return saida
}

/** Tags distintas em uso, em ordem alfabética (para o filtro). */
export async function tagsEmUso(opts: { db?: BancoCrm; limite?: number } = {}): Promise<string[]> {
  const db = opts.db ?? bancoPadrao()
  const tag = sql<string>`t.tag`
  const r = await db
    .select({ tag })
    .from(sql`${contatos}, jsonb_array_elements_text(${contatos.tags}) as t(tag)`)
    .groupBy(tag)
    .orderBy(asc(tag))
    .limit(opts.limite ?? 300)
  return r.map((x) => x.tag)
}

export async function buscarContato(id: number, opts: { db?: BancoCrm } = {}): Promise<Contato | null> {
  if (!Number.isInteger(id) || id <= 0) return null
  const db = opts.db ?? bancoPadrao()
  const [c] = await db.select().from(contatos).where(eq(contatos.id, id))
  return c ?? null
}
