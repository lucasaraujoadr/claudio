import { asc, desc, eq, gte, max } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { ga4Diario, ga4Paginas, gscTotais, sincronizacoes } from '@/lib/db/schema'
import { somarDias } from '@/components/graficos/serie'
import type { DiaGa4 } from './trafego'
import type { LinhaOrigem } from './canais'
import type { LinhaTotaisGsc } from './search-console'
import type { RegistroSincronizacao } from './sincronizacao'

/** Último registro de cada fonte da rotina diária. Leitura apenas. */
export async function carregarSincronizacoes(): Promise<Record<string, RegistroSincronizacao>> {
  const linhas = await getDb().select().from(sincronizacoes)
  return Object.fromEntries(linhas.map((l) => [l.fonte, l]))
}

/**
 * Versão que nunca lança: um problema ao ler o estado das fontes não pode derrubar a
 * página que só o usa para explicar um aviso.
 */
export async function carregarSincronizacoesSeguro(): Promise<Record<string, RegistroSincronizacao> | null> {
  try {
    return await carregarSincronizacoes()
  } catch (e) {
    console.error('sincronizações: leitura falhou:', e instanceof Error ? e.name : 'erro')
    return null
  }
}

/**
 * Série diária do GA4 suficiente para o gráfico de 90 dias e para a comparação de
 * 28 contra 28 dias, terminando no último dia gravado.
 */
export async function carregarDiarioGa4(dias = 90): Promise<DiaGa4[]> {
  const db = getDb()
  const [{ ultimo } = { ultimo: null }] = await db.select({ ultimo: max(ga4Diario.data) }).from(ga4Diario)
  if (!ultimo) return []
  return db
    .select()
    .from(ga4Diario)
    .where(gte(ga4Diario.data, somarDias(ultimo, -(dias - 1))))
    .orderBy(asc(ga4Diario.data))
}

/** Páginas de entrada × origem/mídia do snapshot mais recente (janela de 28 dias). */
export async function carregarPaginasGa4(): Promise<{ snapshotDate: string; linhas: LinhaOrigem[] } | null> {
  const db = getDb()
  const [ultimo] = await db
    .select({ data: ga4Paginas.snapshotDate })
    .from(ga4Paginas)
    .orderBy(desc(ga4Paginas.snapshotDate))
    .limit(1)
  if (!ultimo) return null
  const linhas = await db
    .select({
      pagina: ga4Paginas.pagina,
      origemMidia: ga4Paginas.origemMidia,
      sessoes: ga4Paginas.sessoes,
      eventosChave: ga4Paginas.eventosChave,
    })
    .from(ga4Paginas)
    .where(eq(ga4Paginas.snapshotDate, ultimo.data))
  return { snapshotDate: ultimo.data, linhas }
}

/** Totais da janela de 28 dias do Search Console, um por dia de sincronização (até 90). */
export async function carregarTotaisGsc(dias = 90): Promise<LinhaTotaisGsc[]> {
  const linhas = await getDb()
    .select({ data: gscTotais.snapshotDate, cliques: gscTotais.clicksAtual, impressoes: gscTotais.impressionsAtual })
    .from(gscTotais)
    .orderBy(desc(gscTotais.snapshotDate))
    .limit(dias)
  return linhas.reverse()
}
