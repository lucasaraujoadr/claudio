import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { artigos, newslettersEnvios, pecasDistribuicao, topics } from '@/lib/db/schema'
import type { BancoCrm } from '@/lib/crm/banco'
import { criarBancoTesteArtigos } from './banco-teste-artigos'

let db: BancoCrm
let fechar: () => Promise<void>
beforeEach(async () => {
  ;({ db, fechar } = await criarBancoTesteArtigos())
})
afterEach(async () => {
  await fechar()
})

async function artigo() {
  const [t] = await db.insert(topics).values({ titulo: 'T', keyword: 'k', keywordNormalizada: 'k', intencao: 'informacional', prioridade: 'media', origem: 'ia' }).returning()
  const [a] = await db.insert(artigos).values({ topicId: t.id }).returning()
  return a
}

describe('tabelas da distribuição', () => {
  it('uma peça por artigo e tipo', async () => {
    const a = await artigo()
    await db.insert(pecasDistribuicao).values({ artigoId: a.id, tipo: 'carrossel' })
    await expect(db.insert(pecasDistribuicao).values({ artigoId: a.id, tipo: 'carrossel' })).rejects.toThrow()
    await db.insert(pecasDistribuicao).values({ artigoId: a.id, tipo: 'newsletter' })
    const [p] = await db.select().from(pecasDistribuicao)
    expect(p).toMatchObject({ situacao: 'gerando', conteudo: null, variacao: null })
  })

  it('newsletter começa como rascunho', async () => {
    const a = await artigo()
    const [n] = await db.insert(newslettersEnvios).values({ artigoId: a.id, resendBroadcastId: 'b1' }).returning()
    expect(n).toMatchObject({ situacao: 'rascunho', destinatarios: null })
  })
})
