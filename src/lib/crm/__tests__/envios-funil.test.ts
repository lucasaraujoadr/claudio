import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { contatos, enviosFunil, funilInscricoes, webhookEventosRecebidos } from '@/lib/db/schema'
import type { BancoCrm } from '../banco'
import { garantirFunis } from '../funis'
import { criarBancoTesteFunis } from './banco-teste-funis'

let db: BancoCrm
let fechar: () => Promise<void>
beforeEach(async () => {
  ;({ db, fechar } = await criarBancoTesteFunis())
})
afterEach(async () => {
  await fechar()
})

async function inscricao() {
  const [f] = await garantirFunis({ db })
  const [c] = await db
    .insert(contatos)
    .values({ nome: 'A', email: 'a@example.com', emailNormalizado: 'a@example.com', origem: 'site', baseLegal: 'consentimento' })
    .returning()
  const [i] = await db.insert(funilInscricoes).values({ contatoId: c.id, funilId: f.id, origem: 'site' }).returning()
  return i
}

describe('envios_funil', () => {
  it('uma etapa nunca é gravada duas vezes para a mesma inscrição', async () => {
    const i = await inscricao()
    await db.insert(enviosFunil).values({ inscricaoId: i.id, etapa: 0, status: 'enviado', resendEmailId: 'r1' })
    await expect(db.insert(enviosFunil).values({ inscricaoId: i.id, etapa: 0, status: 'erro' })).rejects.toThrow()
    await db.insert(enviosFunil).values({ inscricaoId: i.id, etapa: 1, status: 'erro', erro: 'x' })
    expect(await db.select().from(enviosFunil)).toHaveLength(2)
  })

  it('apagar a inscrição apaga os envios (cascade)', async () => {
    const i = await inscricao()
    await db.insert(enviosFunil).values({ inscricaoId: i.id, etapa: 0, status: 'enviado' })
    await db.delete(funilInscricoes).where(eq(funilInscricoes.id, i.id))
    expect(await db.select().from(enviosFunil)).toHaveLength(0)
  })
})

describe('webhook_eventos_recebidos', () => {
  it('o mesmo svix-id não grava duas vezes', async () => {
    await db.insert(webhookEventosRecebidos).values({ id: 'msg_1' }).onConflictDoNothing()
    await db.insert(webhookEventosRecebidos).values({ id: 'msg_1' }).onConflictDoNothing()
    expect(await db.select().from(webhookEventosRecebidos)).toHaveLength(1)
  })
})
