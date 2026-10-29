import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { artigos, briefings, topics } from '@/lib/db/schema'
import type { BancoCrm } from '@/lib/crm/banco'
import type { GerarObjeto } from '@/lib/ai/cliente'
import { criarBancoTesteArtigos } from './banco-teste-artigos'
import { obterArtigo, reivindicarGeracao } from '../repositorio'
import { executarGeracao, montarPromptArtigo, reescreverTrecho } from '../gerar'

let db: BancoCrm
let fechar: () => Promise<void>
const AGORA = new Date('2026-10-29T12:00:00Z')
const URL_OK = 'https://ogpericiacontabil.com.br/perito-contabil'
const KEYWORD = 'pericia contabil trabalhista'

beforeAll(async () => {
  ;({ db, fechar } = await criarBancoTesteArtigos())
})
afterAll(async () => {
  await fechar()
})
beforeEach(async () => {
  await db.delete(artigos)
  await db.delete(briefings)
  await db.delete(topics)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const briefingModelo = {
  title: 'Perícia contábil trabalhista: guia para advogados',
  metaDescription:
    'Entenda quando contratar a perícia contábil trabalhista, o que o perito analisa e como isso fortalece a tese do advogado.',
  outline: [{ h2: 'O que é', h3: ['Conceito'] }],
  faq: [1, 2, 3, 4].map((n) => ({ pergunta: `Pergunta ${n}?`, resposta: `Resposta ${n}.` })),
  linksInternos: [],
  keywordsSecundarias: ['perito contábil'],
}

function artigoModelo(over: Record<string, unknown> = {}) {
  return {
    titulo: 'Perícia contábil trabalhista: guia para advogados',
    slug: 'pericia-contabil-trabalhista',
    metaDescription: briefingModelo.metaDescription,
    introducao: [{ tipo: 'paragrafo', texto: `Veja o [perito](${URL_OK}) e o [fantasma](https://x.com/inventado).` }],
    secoes: [{ titulo: 'O que é', blocos: [{ tipo: 'paragrafo', texto: 'Art. 879 da CLT.', verificar: 'conferir artigo' }] }],
    faq: [{ pergunta: 'Quando contratar?', resposta: 'Antes da liquidação.' }],
    conclusao: [{ tipo: 'paragrafo', texto: 'Fale com a OG.' }],
    ...over,
  }
}

function fakeGerar(artigo: () => unknown) {
  const prompts: string[] = []
  const gerar = (async ({ prompt }: { prompt: string }) => {
    prompts.push(prompt)
    return prompt.includes('Elabore o briefing') ? briefingModelo : artigo()
  }) as unknown as GerarObjeto
  return { gerar, prompts }
}

const buscaOk = (async () => ({
  valor: { fatos: [{ afirmacao: 'CLT art. 879', fonte: 'https://planalto.gov.br' }] },
  fontes: ['https://planalto.gov.br/clt'],
})) as never

async function preparar(opts: { briefado?: boolean } = {}) {
  const [t] = await db
    .insert(topics)
    .values({
      titulo: 'Perícia contábil trabalhista',
      keyword: KEYWORD,
      keywordNormalizada: KEYWORD,
      intencao: 'informacional',
      prioridade: 'alta',
      origem: 'ia',
      status: opts.briefado ? 'briefado' : 'ideia',
    })
    .returning()
  if (opts.briefado) {
    await db.insert(briefings).values({ topicId: t.id, ...briefingModelo, modelo: 'x' })
  }
  const r = await reivindicarGeracao({ topicId: t.id }, AGORA, db)
  if (r.tipo !== 'reivindicado') throw new Error('falha no preparo')
  return { topicId: t.id, artigoId: r.artigoId }
}

const deps = (extra: object) => ({ db, agora: () => AGORA, urlsDoSite: async () => [URL_OK], ...extra })

describe('executarGeracao', () => {
  it('ok grava rascunho com html sanitizado e fontes da busca', async () => {
    const { artigoId, topicId } = await preparar({ briefado: true })
    const { gerar } = fakeGerar(() => artigoModelo())
    expect(await executarGeracao(artigoId, topicId, deps({ gerar, buscar: buscaOk }))).toBe('ok')
    const a = await obterArtigo(artigoId, db)
    expect(a?.situacao).toBe('rascunho')
    expect(a?.conteudoHtml).toContain('<h2>O que é</h2>')
    expect(a?.conteudoHtml).toContain('data-verificar')
    expect(a?.fontes).toEqual([{ url: 'https://planalto.gov.br/clt' }])
    expect(a?.slug).toBe('pericia-contabil-trabalhista')
  })

  it('busca falhando ainda gera (fontes [])', async () => {
    const { artigoId, topicId } = await preparar({ briefado: true })
    const { gerar, prompts } = fakeGerar(() => artigoModelo())
    const buscar = (async () => {
      throw new Error('boom')
    }) as never
    expect(await executarGeracao(artigoId, topicId, deps({ gerar, buscar }))).toBe('ok')
    expect((await obterArtigo(artigoId, db))?.fontes).toEqual([])
    expect(prompts[0]).toContain('Não há notas de pesquisa')
  })

  it('modelo devolve link inventado → html sem o link', async () => {
    const { artigoId, topicId } = await preparar({ briefado: true })
    const { gerar } = fakeGerar(() => artigoModelo())
    await executarGeracao(artigoId, topicId, deps({ gerar, buscar: buscaOk }))
    const html = (await obterArtigo(artigoId, db))?.conteudoHtml ?? ''
    expect(html).toContain(`href="${URL_OK}"`)
    expect(html).not.toContain('x.com/inventado')
    expect(html).toContain('fantasma')
  })

  it('slug do modelo com acento é normalizado', async () => {
    const { artigoId, topicId } = await preparar({ briefado: true })
    const { gerar } = fakeGerar(() => artigoModelo({ slug: 'Perícia Contábil: Guia Rápido!' }))
    await executarGeracao(artigoId, topicId, deps({ gerar, buscar: buscaOk }))
    expect((await obterArtigo(artigoId, db))?.slug).toBe('pericia-contabil-guia-rapido')
  })

  it('slug vazio vem da keyword', async () => {
    const { artigoId, topicId } = await preparar({ briefado: true })
    const { gerar } = fakeGerar(() => artigoModelo({ slug: '!!!' }))
    await executarGeracao(artigoId, topicId, deps({ gerar, buscar: buscaOk }))
    expect((await obterArtigo(artigoId, db))?.slug).toBe('pericia-contabil-trabalhista')
  })

  it('título de 80 chars é reparado', async () => {
    const { artigoId, topicId } = await preparar({ briefado: true })
    const longo = 'Perícia contábil trabalhista: guia completo e prático para advogados de todo o país'
    expect(longo.length).toBeGreaterThan(60)
    const { gerar } = fakeGerar(() => artigoModelo({ titulo: longo }))
    await executarGeracao(artigoId, topicId, deps({ gerar, buscar: buscaOk }))
    const t = (await obterArtigo(artigoId, db))?.titulo ?? ''
    expect(t.length).toBeLessThanOrEqual(60)
    expect(t.length).toBeGreaterThanOrEqual(30)
    expect(t.toLowerCase()).toContain('perícia contábil trabalhista')
  })

  it('redação falhando → erro_geracao com mensagem fixa', async () => {
    const { artigoId, topicId } = await preparar({ briefado: true })
    const { gerar } = fakeGerar(() => {
      throw new Error('segredo-sk-123')
    })
    expect(await executarGeracao(artigoId, topicId, deps({ gerar, buscar: buscaOk }))).toBe('erro')
    const a = await obterArtigo(artigoId, db)
    expect(a?.situacao).toBe('erro_geracao')
    expect(a?.erro).toBe('falha ao gerar o artigo; tente de novo')
    expect(JSON.stringify((console.error as never as { mock: { calls: unknown[] } }).mock.calls)).not.toContain('segredo')
  })

  it('tema sem briefing gera e grava briefing antes', async () => {
    const { artigoId, topicId } = await preparar()
    const { gerar } = fakeGerar(() => artigoModelo())
    expect(await executarGeracao(artigoId, topicId, deps({ gerar, buscar: buscaOk }))).toBe('ok')
    const bs = await db.select().from(briefings).where(eq(briefings.topicId, topicId))
    expect(bs).toHaveLength(1)
    const [t] = await db.select().from(topics).where(eq(topics.id, topicId))
    expect(t.status).toBe('briefado')
  })
})

describe('montarPromptArtigo', () => {
  it("contém as urls permitidas e não contém 'email'/'telefone' de contato", async () => {
    const { topicId } = await preparar({ briefado: true })
    const [topico] = await db.select().from(topics).where(eq(topics.id, topicId))
    const [briefing] = await db.select().from(briefings).where(eq(briefings.topicId, topicId))
    const p = montarPromptArtigo({ topico, briefing, fatos: [], urlsDoSite: [URL_OK] })
    expect(p).toContain(URL_OK)
    expect(p.toLowerCase()).not.toContain('email')
    expect(p.toLowerCase()).not.toContain('e-mail')
    expect(p.toLowerCase()).not.toContain('telefone')
    expect(p).toContain('1.200')
  })
})

describe('reescreverTrecho', () => {
  it('recusa instrução com 501 chars e trecho acima de 4000', async () => {
    const gerar = vi.fn()
    await expect(
      reescreverTrecho({ trecho: 'a', instrucao: 'x'.repeat(501), keyword: 'k' }, gerar as never),
    ).rejects.toThrow('trecho longo demais')
    await expect(
      reescreverTrecho({ trecho: 'a'.repeat(4001), instrucao: 'x', keyword: 'k' }, gerar as never),
    ).rejects.toThrow('trecho longo demais')
    expect(gerar).not.toHaveBeenCalled()
  })

  it('devolve texto puro, sem HTML', async () => {
    const gerar = (async () => ({ texto: '<p>Texto <b>novo</b></p>' })) as unknown as GerarObjeto
    expect(await reescreverTrecho({ trecho: 'a', instrucao: 'x', keyword: 'k' }, gerar)).toBe('Texto novo')
  })

  it('não rebaixa tema publicado ao gerar o briefing', async () => {
    const { artigoId, topicId } = await preparar()
    await db.update(topics).set({ status: 'publicado' }).where(eq(topics.id, topicId))
    const { gerar } = fakeGerar(() => artigoModelo())
    expect(await executarGeracao(artigoId, topicId, deps({ gerar, buscar: buscaOk }))).toBe('ok')
    const [t] = await db.select().from(topics).where(eq(topics.id, topicId))
    expect(t.status).toBe('publicado')
  })

  it('título e meta do modelo saem sem tags', async () => {
    const { artigoId, topicId } = await preparar()
    const { gerar } = fakeGerar(() =>
      artigoModelo({
        titulo: '<script>x</script>Perícia contábil trabalhista: guia para advogados',
        metaDescription: `<b>${briefingModelo.metaDescription}</b>`,
      }),
    )
    expect(await executarGeracao(artigoId, topicId, deps({ gerar, buscar: buscaOk }))).toBe('ok')
    const a = await obterArtigo(artigoId, db)
    expect(a?.titulo).not.toContain('<')
    expect(a?.metaDescription).not.toContain('<')
  })
})
