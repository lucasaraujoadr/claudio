import { desc, eq } from 'drizzle-orm'
import { criarClienteBrevo, type ClienteBrevo } from '@/lib/brevo'
import { briefings, topics } from '@/lib/db/schema'
import { bancoPadrao, type BancoCrm } from './banco'
import { comporCampanhaBlog, type CampanhaComposta } from './funis-conteudo'

/**
 * Nutrição com o blog: rascunho de campanha no Brevo para a lista do funil `nutricao-blog`,
 * a partir de um tema publicado. **Nunca envia** (o cliente cria sem `scheduledAt` e não
 * tem `sendNow`). Sem chave, sem lista ou sem remetente, devolve o texto composto para a
 * tela mostrar e o usuário copiar.
 */

export type Remetente = { nome?: string; email: string }

/** Remetente das campanhas: `BREVO_REMETENTE_EMAIL` (obrigatório) e `BREVO_REMETENTE_NOME`. */
export function remetenteConfigurado(env: Record<string, string | undefined> = process.env): Remetente | null {
  const email = env.BREVO_REMETENTE_EMAIL?.trim()
  if (!email) return null
  const nome = env.BREVO_REMETENTE_NOME?.trim()
  return nome ? { nome, email } : { email }
}

export type TemaParaCampanha =
  | { ok: true; composta: CampanhaComposta; titulo: string }
  | { ok: false; motivo: 'nao_encontrado' | 'nao_publicado' }

export async function comporCampanhaDoTema(topicId: number, opts: { db?: BancoCrm } = {}): Promise<TemaParaCampanha> {
  const db = opts.db ?? bancoPadrao()
  const [t] = await db.select().from(topics).where(eq(topics.id, topicId))
  if (!t) return { ok: false, motivo: 'nao_encontrado' }
  if (t.status !== 'publicado' || !t.urlPublicada) return { ok: false, motivo: 'nao_publicado' }
  const [b] = await db
    .select({ title: briefings.title, metaDescription: briefings.metaDescription })
    .from(briefings)
    .where(eq(briefings.topicId, t.id))
    .orderBy(desc(briefings.criadoEm), desc(briefings.id))
    .limit(1)
  const composta = comporCampanhaBlog({ topicId: t.id, titulo: t.titulo, keyword: t.keyword, urlPublicada: t.urlPublicada, briefing: b ?? null })
  return { ok: true, composta, titulo: t.titulo }
}

export type ResultadoRascunho =
  | { ok: true; campanhaId: number; composta: CampanhaComposta }
  | { ok: false; motivo: 'nao_encontrado' | 'nao_publicado' }
  | { ok: false; motivo: 'nao_conectado' | 'sem_lista' | 'sem_remetente' | 'brevo'; composta: CampanhaComposta; mensagem?: string }

export async function criarRascunhoCampanhaBlog(
  topicId: number,
  opts: { db?: BancoCrm; cliente?: ClienteBrevo; remetente?: Remetente | null } = {},
): Promise<ResultadoRascunho> {
  const db = opts.db ?? bancoPadrao()
  const tema = await comporCampanhaDoTema(topicId, { db })
  if (!tema.ok) return tema
  const { composta } = tema
  const cliente = opts.cliente ?? criarClienteBrevo()
  if (!cliente.conectado) return { ok: false, motivo: 'nao_conectado', composta }
  // O funil não guarda mais lista do Brevo: sem lista, a campanha do blog não é criada (removida no Task 7).
  return { ok: false, motivo: 'sem_lista', composta }
}
