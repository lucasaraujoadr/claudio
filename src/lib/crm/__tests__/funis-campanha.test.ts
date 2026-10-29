import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { criarClienteBrevo } from '@/lib/brevo'
import { briefings, funis, topics } from '@/lib/db/schema'
import type { BancoCrm } from '../banco'
import { criarRascunhoCampanhaBlog, remetenteConfigurado } from '../funis-campanha'
import { garantirFunis } from '../funis'
import { criarBancoTesteFunis } from './banco-teste-funis'
import { brevoFalso } from './brevo-fake'

let db: BancoCrm
let fechar: () => Promise<void>
beforeEach(async () => {
  ;({ db, fechar } = await criarBancoTesteFunis())
})
afterEach(async () => {
  await fechar()
})

async function tema(extra: Partial<typeof topics.$inferInsert> = {}) {
  const [t] = await db
    .insert(topics)
    .values({
      titulo: 'Revisão de contrato bancário',
      keyword: 'revisão de contrato bancário',
      keywordNormalizada: `revisao-${Math.random()}`,
      intencao: 'informacional',
      prioridade: 'alta',
      status: 'publicado',
      origem: 'ia',
      urlPublicada: 'https://ogpericiacontabil.com.br/blog/revisao/',
      ...extra,
    })
    .returning()
  return t
}
const REMETENTE = { nome: 'OG', email: 'contato@example.com' }

describe('criarRascunhoCampanhaBlog', () => {
  it('cria rascunho para a lista da nutrição, com título e resumo do briefing; nunca agenda nem envia', async () => {
    const t = await tema()
    await db.insert(briefings).values({ topicId: t.id, title: 'Revisão: o que conferir', metaDescription: 'Pontos de atenção.', outline: [], faq: [], linksInternos: [], keywordsSecundarias: [], modelo: 'x' })
    await garantirFunis({ db })
    await db.update(funis).set({ brevoListaId: 9 }).where(eq(funis.slug, 'nutricao-blog'))
    const b = brevoFalso()
    const r = await criarRascunhoCampanhaBlog(t.id, { db, cliente: b.cliente, remetente: REMETENTE })
    expect(r.ok).toBe(true)
    expect(b.campanhas).toHaveLength(1)
    expect(b.campanhas[0]).toMatchObject({ assunto: 'Novo artigo: Revisão: o que conferir', previewText: 'Pontos de atenção.', listIds: [9], remetente: REMETENTE })
    expect(Object.keys(b.campanhas[0])).not.toContain('scheduledAt')
    expect(b.chamadas.map((c) => c.op)).toEqual(['campanha'])
  })

  it('sem chave: devolve o texto composto para copiar', async () => {
    const t = await tema()
    const r = await criarRascunhoCampanhaBlog(t.id, { db, cliente: criarClienteBrevo({ apiKey: null }), remetente: REMETENTE })
    expect(r).toMatchObject({ ok: false, motivo: 'nao_conectado' })
    if (!r.ok && 'composta' in r) expect(r.composta.texto).toContain('https://ogpericiacontabil.com.br/blog/revisao/?utm_source=brevo')
  })

  it('sem lista da nutrição ou sem remetente: não chama o Brevo e devolve o texto', async () => {
    const t = await tema()
    const b = brevoFalso()
    expect(await criarRascunhoCampanhaBlog(t.id, { db, cliente: b.cliente, remetente: REMETENTE })).toMatchObject({ ok: false, motivo: 'sem_lista' })
    await db.update(funis).set({ brevoListaId: 9 }).where(eq(funis.slug, 'nutricao-blog'))
    expect(await criarRascunhoCampanhaBlog(t.id, { db, cliente: b.cliente, remetente: null })).toMatchObject({ ok: false, motivo: 'sem_remetente' })
    expect(b.campanhas).toHaveLength(0)
  })

  it('tema não publicado ou sem URL não vira campanha', async () => {
    const t1 = await tema({ status: 'briefado', urlPublicada: null })
    expect(await criarRascunhoCampanhaBlog(t1.id, { db, cliente: brevoFalso().cliente, remetente: REMETENTE })).toEqual({ ok: false, motivo: 'nao_publicado' })
    expect(await criarRascunhoCampanhaBlog(999, { db, cliente: brevoFalso().cliente, remetente: REMETENTE })).toEqual({ ok: false, motivo: 'nao_encontrado' })
  })

  it('remetente vem do ambiente', () => {
    expect(remetenteConfigurado({})).toBeNull()
    expect(remetenteConfigurado({ BREVO_REMETENTE_EMAIL: ' a@example.com ' })).toEqual({ email: 'a@example.com' })
    expect(remetenteConfigurado({ BREVO_REMETENTE_EMAIL: 'a@example.com', BREVO_REMETENTE_NOME: 'OG' })).toEqual({ email: 'a@example.com', nome: 'OG' })
  })
})
