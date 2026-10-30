import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { artigos, pecasDistribuicao, topics } from '@/lib/db/schema'
import type { BancoCrm } from '@/lib/crm/banco'
import type { GerarObjeto } from '@/lib/ai/cliente'
import { criarBancoTesteArtigos } from '@/lib/artigos/__tests__/banco-teste-artigos'
import { gerarPecas } from '../gerar'
import { listarDistribuicao, marcarPublicada, pecasDoArtigo, reivindicarPeca, salvarPeca } from '../repositorio'

let db: BancoCrm
let fechar: () => Promise<void>
const AGORA = new Date('2026-10-29T12:00:00Z')

beforeAll(async () => {
  ;({ db, fechar } = await criarBancoTesteArtigos())
})
afterAll(async () => {
  await fechar()
})
beforeEach(async () => {
  await db.delete(pecasDistribuicao)
  await db.delete(artigos)
  await db.delete(topics)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

async function artigo(over: Partial<typeof artigos.$inferInsert> = {}) {
  const [t] = await db
    .insert(topics)
    .values({ titulo: 'Tema', keyword: 'pericia contabil', keywordNormalizada: 'pericia contabil', intencao: 'informacional', prioridade: 'alta', origem: 'ia' })
    .returning()
  const [a] = await db
    .insert(artigos)
    .values({
      topicId: t.id,
      situacao: 'pronto',
      titulo: 'Perícia contábil para advogados',
      slug: 'pericia-contabil',
      conteudoHtml: '<h2>O que é</h2><p>Texto do artigo.</p><ul><li>Item um</li></ul>',
      ...over,
    })
    .returning()
  return a
}

const lam = (tipo: string, o: Record<string, unknown> = {}) => ({ tipo, titulo: null, subtitulo: null, texto: null, itens: null, ...o })
const modelos: Record<string, unknown> = {
  linkedin_artigo: { titulo: 'T', subtitulo: null, blocos: [{ tipo: 'paragrafo', texto: 'Corpo', itens: null }] },
  linkedin_post: { texto: 'Post', hashtags: ['a', 'b', 'c'] },
  carrossel: {
    laminas: [lam('capa', { titulo: 'Capa' }), ...[1, 2, 3, 4].map((n) => lam('conteudo', { titulo: `P${n}`, texto: 'x' })), lam('chamada', { texto: 'Fale' })],
    legenda: 'Leg',
  },
  newsletter: { assunto: 'A', preCabecalho: 'P', abertura: 'Ab', pontos: ['1', '2', '3'] },
}
function fake(falhar: string[] = []) {
  const prompts: string[] = []
  const gerar = (async ({ prompt }: { prompt: string }) => {
    prompts.push(prompt)
    const tipo = Object.keys(modelos).find((t) => prompt.includes(`[[${t}]]`)) ?? ''
    if (falhar.includes(tipo)) throw new Error('boom')
    return modelos[tipo]
  }) as unknown as GerarObjeto
  return { gerar, prompts }
}
// Marca cada prompt pelo tipo, a partir da instrução própria de cada peça.
const MARCAS: Record<string, string> = {
  linkedin_artigo: 'ARTIGO DO LINKEDIN',
  linkedin_post: 'POST DO LINKEDIN',
  carrossel: 'CARROSSEL',
  newsletter: 'NEWSLETTER',
}
function fake2(falhar: string[] = []) {
  const f = fake(falhar)
  const gerar = (async (o: { prompt: string }) =>
    f.gerar({ schema: undefined as never, prompt: o.prompt + Object.entries(MARCAS).map(([t, m]) => (o.prompt.includes(m) ? `[[${t}]]` : '')).join('') })) as unknown as GerarObjeto
  return { gerar, prompts: f.prompts }
}

describe('gerarPecas', () => {
  it('gera as quatro e grava rascunho', async () => {
    const a = await artigo()
    const r = await gerarPecas(a.id, { gerar: fake2().gerar, db, agora: () => AGORA })
    expect(r.tipo).toBe('processado')
    const pecas = await pecasDoArtigo(a.id, db)
    expect(pecas.map((p) => p.situacao)).toEqual(['rascunho', 'rascunho', 'rascunho', 'rascunho'])
    expect(pecas.find((p) => p.tipo === 'carrossel')?.variacao).toBe('escura')
  })
  it("artigo com 'verificar' recusa", async () => {
    const a = await artigo({ conteudoHtml: '<p>Veja <mark data-verificar="conferir">art. 5</mark></p>' })
    const g = fake2()
    const r = await gerarPecas(a.id, { gerar: g.gerar, db })
    expect(r).toMatchObject({ tipo: 'recusado', motivo: 'verificar' })
    expect(g.prompts).toHaveLength(0)
    expect(await pecasDoArtigo(a.id, db)).toHaveLength(0)
  })
  it('artigo em rascunho recusa', async () => {
    const a = await artigo({ situacao: 'rascunho' })
    expect(await gerarPecas(a.id, { gerar: fake2().gerar, db })).toMatchObject({ tipo: 'recusado', motivo: 'situacao' })
  })
  it('uma peça falhando não derruba as outras', async () => {
    const a = await artigo()
    const r = await gerarPecas(a.id, { gerar: fake2(['carrossel']).gerar, db, agora: () => AGORA })
    expect(r.tipo === 'processado' && r.pecas.carrossel?.resultado).toBe('erro')
    const pecas = await pecasDoArtigo(a.id, db)
    expect(pecas.find((p) => p.tipo === 'carrossel')).toMatchObject({ situacao: 'erro', erro: 'falha ao gerar a peça; tente de novo' })
    expect(pecas.filter((p) => p.situacao === 'rascunho')).toHaveLength(3)
  })
  it('modelo devolvendo carrossel de 9 lâminas → peça em erro', async () => {
    const a = await artigo()
    const nove = { laminas: Array.from({ length: 9 }, () => lam('conteudo', { titulo: 'x', texto: 'y' })), legenda: 'l' }
    const gerar = (async () => nove) as unknown as GerarObjeto
    await gerarPecas(a.id, { tipos: ['carrossel'], gerar, db })
    expect((await pecasDoArtigo(a.id, db))[0].situacao).toBe('erro')
  })
  it('prompt não contém email/telefone de contato e contém o link do blog', async () => {
    const a = await artigo({ wpLink: 'https://ogpericiacontabil.com.br/meu-artigo/' })
    const g = fake2()
    await gerarPecas(a.id, { tipos: ['linkedin_post'], gerar: g.gerar, db })
    expect(g.prompts[0]).toContain('https://ogpericiacontabil.com.br/meu-artigo/')
    expect(g.prompts[0]).toContain('## O que é')
    expect(g.prompts[0]).toContain('- Item um')
    expect(g.prompts[0]).not.toMatch(/@[\w-]+\.|\(\d{2}\)\s?\d{4,5}-\d{4}/)
  })
  it('sem wpLink usa o link previsto com o slug', async () => {
    const a = await artigo()
    const g = fake2()
    await gerarPecas(a.id, { tipos: ['newsletter'], gerar: g.gerar, db })
    expect(g.prompts[0]).toContain('https://ogpericiacontabil.com.br/pericia-contabil/')
  })
})

describe('repositório', () => {
  it('reivindicação dupla → uma só gera', async () => {
    const a = await artigo()
    const [x, y] = await Promise.all([
      reivindicarPeca(a.id, 'newsletter', AGORA, db),
      reivindicarPeca(a.id, 'newsletter', AGORA, db),
    ])
    expect([x.tipo, y.tipo].sort()).toEqual(['em_andamento', 'reivindicada'])
  })
  it('gerando há mais de 10 min é retomada; recente não', async () => {
    const a = await artigo()
    await reivindicarPeca(a.id, 'newsletter', AGORA, db)
    expect((await reivindicarPeca(a.id, 'newsletter', new Date(AGORA.getTime() + 9 * 60_000), db)).tipo).toBe('em_andamento')
    expect((await reivindicarPeca(a.id, 'newsletter', new Date(AGORA.getTime() + 11 * 60_000), db)).tipo).toBe('reivindicada')
  })
  it('peça publicada não é regerada', async () => {
    const a = await artigo()
    const c = await reivindicarPeca(a.id, 'linkedin_post', AGORA, db)
    await db.update(pecasDistribuicao).set({ situacao: 'rascunho' }).where(eq(pecasDistribuicao.artigoId, a.id))
    if (c.tipo !== 'reivindicada') throw new Error()
    await marcarPublicada(c.pecaId, 'https://linkedin.com/x', AGORA, db)
    expect((await reivindicarPeca(a.id, 'linkedin_post', AGORA, db)).tipo).toBe('publicada')
  })
  it('salvarPeca valida pelo estrito e listarDistribuicao junta o artigo', async () => {
    const a = await artigo()
    const c = await reivindicarPeca(a.id, 'linkedin_post', AGORA, db)
    if (c.tipo !== 'reivindicada') throw new Error()
    expect(await salvarPeca(c.pecaId, { texto: 'x', hashtags: [] }, AGORA, db)).toBeNull() // gerando
    await db.update(pecasDistribuicao).set({ situacao: 'erro' })
    await expect(salvarPeca(c.pecaId, { texto: 'x', hashtags: [] }, AGORA, db)).rejects.toThrow()
    const ok = await salvarPeca(c.pecaId, { texto: 'x', hashtags: ['a', 'b', 'c'] }, AGORA, db)
    expect(ok?.situacao).toBe('rascunho')
    expect((await listarDistribuicao(db))[0]).toMatchObject({ keyword: 'pericia contabil', artigoTitulo: a.titulo })
  })
})
