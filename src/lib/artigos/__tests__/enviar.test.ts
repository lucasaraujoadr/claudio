import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { artigos, topics } from '@/lib/db/schema'
import type { BancoCrm } from '@/lib/crm/banco'
import { ErroWp, type DadosPost, type PostWp, type criarClienteWp } from '@/lib/wordpress'
import { criarBancoTesteArtigos } from './banco-teste-artigos'
import { obterArtigo, reivindicarEnvio, liberarEnvio } from '../repositorio'
import { enviarArtigo, sincronizarAgendados } from '../enviar'

type Cliente = ReturnType<typeof criarClienteWp>

let db: BancoCrm
let fechar: () => Promise<void>
const AGORA = new Date('2026-10-29T12:00:00Z')
const KW = 'perícia contábil'

beforeAll(async () => {
  ;({ db, fechar } = await criarBancoTesteArtigos())
})
afterAll(async () => {
  await fechar()
})
beforeEach(async () => {
  await db.delete(artigos)
  await db.delete(topics)
})

async function criarArtigo(extra: Partial<typeof artigos.$inferInsert> = {}) {
  const [t] = await db
    .insert(topics)
    .values({ titulo: 'T', keyword: KW, keywordNormalizada: 'pericia contabil', intencao: 'informacional', prioridade: 'media', origem: 'ia' })
    .returning()
  const [a] = await db
    .insert(artigos)
    .values({
      topicId: t.id,
      situacao: 'pronto',
      titulo: 'Perícia contábil: guia',
      slug: 'pericia-contabil-guia',
      metaDescription: 'Resumo do artigo.',
      conteudoHtml: '<p>Texto sobre perícia contábil.</p><p>Outro <strong>parágrafo</strong>.</p>',
      revisado: true,
      ...extra,
    })
    .returning()
  return a
}

function fake(over: Partial<Cliente> = {}) {
  const chamadas: { criar: DadosPost[]; atualizar: { id: number; d: DadosPost }[] } = { criar: [], atualizar: [] }
  const post = (id: number, d: DadosPost): PostWp => ({
    id,
    status: d.status,
    link: `https://site.test/${d.slug}/`,
    modificadoGmt: '2026-10-29T12:00:00',
    metaGravada: true,
  })
  const cliente = {
    listarCategorias: async () => [],
    enviarImagem: async () => ({ id: 1, url: 'x' }),
    criarPost: async (d: DadosPost) => {
      chamadas.criar.push(d)
      return post(500, d)
    },
    atualizarPost: async (id: number, d: DadosPost) => {
      chamadas.atualizar.push({ id, d })
      return post(id, d)
    },
    lerPost: async () => null,
    slugEmUso: async () => null,
    ...over,
  } as Cliente
  return { cliente, chamadas }
}

const opts = (cliente: Cliente, extra = {}) => ({ cliente, db, agora: AGORA, keyword: KW, ...extra })

describe('enviarArtigo', () => {
  it('rascunho cria post draft e grava wpPostId/link', async () => {
    const a = await criarArtigo({ revisado: false, situacao: 'rascunho' })
    const { cliente, chamadas } = fake()
    const r = await enviarArtigo(a.id, 'rascunho', opts(cliente))
    expect(r).toEqual({ tipo: 'ok', link: 'https://site.test/pericia-contabil-guia/', metaGravada: true })
    expect(chamadas.criar[0].status).toBe('draft')
    const s = await obterArtigo(a.id, db)
    expect(s?.wpPostId).toBe(500)
    expect(s?.wpLink).toBe('https://site.test/pericia-contabil-guia/')
    expect(s?.situacao).toBe('rascunho')
  })

  it('publicar sem revisado -> bloqueado com item revisado', async () => {
    const a = await criarArtigo({ revisado: false, situacao: 'rascunho' })
    const { cliente } = fake()
    const r = await enviarArtigo(a.id, 'publicar', opts(cliente))
    expect(r.tipo).toBe('bloqueado')
    if (r.tipo === 'bloqueado') expect(r.itens.some((i) => i.id === 'revisado' && i.nivel === 'bloqueia')).toBe(true)
  })

  it('publicar com mark verificar -> bloqueado', async () => {
    const a = await criarArtigo({ conteudoHtml: '<p>Lei <mark data-verificar>123</mark></p>' })
    const { cliente, chamadas } = fake()
    const r = await enviarArtigo(a.id, 'publicar', opts(cliente))
    expect(r.tipo).toBe('bloqueado')
    if (r.tipo === 'bloqueado') expect(r.itens.some((i) => i.id === 'verificar' && i.nivel === 'bloqueia')).toBe(true)
    expect(chamadas.criar).toHaveLength(0)
  })

  it('publicar ok atualiza tema para publicado', async () => {
    const a = await criarArtigo()
    const { cliente } = fake()
    const r = await enviarArtigo(a.id, 'publicar', opts(cliente))
    expect(r.tipo).toBe('ok')
    expect((await obterArtigo(a.id, db))?.situacao).toBe('publicado')
    const [t] = await db.select().from(topics).where(eq(topics.id, a.topicId))
    expect(t.status).toBe('publicado')
    expect(t.urlPublicada).toBe('https://site.test/pericia-contabil-guia/')
  })

  it('conteúdo enviado não contém <mark nem data-verificar e contém <!-- wp:paragraph -->', async () => {
    const a = await criarArtigo({ revisado: false, situacao: 'rascunho', conteudoHtml: '<p>Lei <mark data-verificar>123</mark> vale.</p>' })
    const { cliente, chamadas } = fake()
    const r = await enviarArtigo(a.id, 'rascunho', opts(cliente))
    expect(r.tipo).toBe('ok')
    const c = chamadas.criar[0].conteudo
    expect(c).not.toContain('<mark')
    expect(c).not.toContain('data-verificar')
    expect(c).toContain('<!-- wp:paragraph -->')
    expect(c).toContain('123')
    expect(chamadas.criar[0].resumo).toBe('Resumo do artigo.')
  })

  describe('post já vinculado', () => {
    const vinculado = { wpPostId: 77, wpStatus: 'draft', wpLink: 'https://site.test/x/', wpModificadoGmt: '2026-10-29T10:00:00' }

    it('editado no WP (modified diferente) -> conflito; com sobrescrever -> ok', async () => {
      const a = await criarArtigo(vinculado)
      const { cliente, chamadas } = fake({
        lerPost: async () => ({ id: 77, status: 'draft', link: 'https://site.test/x/', modificadoGmt: '2026-10-29T11:00:00', metaGravada: true }),
      })
      expect(await enviarArtigo(a.id, 'rascunho', opts(cliente))).toEqual({ tipo: 'conflito' })
      expect(chamadas.atualizar).toHaveLength(0)
      const r = await enviarArtigo(a.id, 'rascunho', opts(cliente, { sobrescrever: true }))
      expect(r.tipo).toBe('ok')
      expect(chamadas.atualizar[0].id).toBe(77)
    })

    it('sem alteração no WP -> atualiza o mesmo post', async () => {
      const a = await criarArtigo(vinculado)
      const { cliente, chamadas } = fake({
        lerPost: async () => ({ id: 77, status: 'draft', link: 'https://site.test/x/', modificadoGmt: '2026-10-29T10:00:00', metaGravada: true }),
      })
      expect((await enviarArtigo(a.id, 'publicar', opts(cliente))).tipo).toBe('ok')
      expect(chamadas.atualizar[0].id).toBe(77)
      expect((await obterArtigo(a.id, db))?.wpPostId).toBe(77)
    })

    it('post apagado no WP (lerPost null) -> cria novo e troca wpPostId', async () => {
      const a = await criarArtigo(vinculado)
      const { cliente, chamadas } = fake({ lerPost: async () => null })
      const r = await enviarArtigo(a.id, 'rascunho', opts(cliente))
      expect(r.tipo).toBe('ok')
      expect(chamadas.criar).toHaveLength(1)
      expect((await obterArtigo(a.id, db))?.wpPostId).toBe(500)
    })
  })

  it('slug em uso por outro post -> bloqueado com o link', async () => {
    const a = await criarArtigo()
    const { cliente, chamadas } = fake({ slugEmUso: async () => 'https://site.test/outro/' })
    const r = await enviarArtigo(a.id, 'publicar', opts(cliente))
    expect(r.tipo).toBe('bloqueado')
    if (r.tipo === 'bloqueado') {
      const s = r.itens.find((i) => i.id === 'slug')
      expect(s?.nivel).toBe('bloqueia')
      expect(s?.texto).toContain('https://site.test/outro/')
    }
    expect(chamadas.criar).toHaveLength(0)
  })

  it('rascunho com título vazio -> bloqueado', async () => {
    const a = await criarArtigo({ titulo: '' })
    const { cliente } = fake()
    expect((await enviarArtigo(a.id, 'rascunho', opts(cliente))).tipo).toBe('bloqueado')
  })

  it('ErroWp credencial -> erro com a mensagem fixa e artigo.erro gravado, wpPostId inalterado', async () => {
    const a = await criarArtigo()
    const { cliente } = fake({
      criarPost: async () => {
        throw new ErroWp('credencial')
      },
    })
    const r = await enviarArtigo(a.id, 'rascunho', opts(cliente))
    expect(r).toEqual({ tipo: 'erro', mensagem: 'senha de aplicativo inválida ou usuário sem permissão de Editor' })
    const s = await obterArtigo(a.id, db)
    expect(s?.erro).toBe('senha de aplicativo inválida ou usuário sem permissão de Editor')
    expect(s?.wpPostId).toBeNull()
  })

  it('agendar com data passada -> bloqueado', async () => {
    const a = await criarArtigo({ agendadoPara: new Date(AGORA.getTime() + 2 * 60_000) })
    const { cliente, chamadas } = fake()
    const r = await enviarArtigo(a.id, 'agendar', opts(cliente))
    expect(r.tipo).toBe('bloqueado')
    if (r.tipo === 'bloqueado') expect(r.itens.some((i) => i.id === 'agendamento' && i.texto.includes('data futura'))).toBe(true)
    expect(chamadas.criar).toHaveLength(0)
  })

  it('agendar ok -> agendado e dataGmt sem Z', async () => {
    const a = await criarArtigo({ agendadoPara: new Date('2026-11-05T13:30:00Z') })
    const { cliente, chamadas } = fake()
    const r = await enviarArtigo(a.id, 'agendar', opts(cliente))
    expect(r.tipo).toBe('ok')
    expect(chamadas.criar[0].status).toBe('future')
    expect(chamadas.criar[0].dataGmt).toBe('2026-11-05T13:30:00')
    expect((await obterArtigo(a.id, db))?.situacao).toBe('agendado')
  })
})

describe('sincronizarAgendados', () => {
  it('publica o que o WP publicou e desvincula o apagado', async () => {
    const a = await criarArtigo({ situacao: 'agendado', wpPostId: 10, wpStatus: 'future', wpLink: 'https://site.test/a/', wpModificadoGmt: '2026-10-29T10:00:00' })
    const { cliente } = fake({
      lerPost: async () => ({ id: 10, status: 'publish', link: 'https://site.test/a/', modificadoGmt: '2026-11-05T13:30:00', metaGravada: true }),
    })
    expect(await sincronizarAgendados(cliente, db)).toBe(1)
    const s = await obterArtigo(a.id, db)
    expect(s?.situacao).toBe('publicado')
    expect(s?.wpStatus).toBe('publish')

    const b = await db.insert(topics).values({ titulo: 'U', keyword: 'u', keywordNormalizada: 'u', intencao: 'informacional', prioridade: 'media', origem: 'ia' }).returning()
    const [c] = await db.insert(artigos).values({ topicId: b[0].id, situacao: 'agendado', wpPostId: 11, wpStatus: 'future', revisado: true }).returning()
    const { cliente: c2 } = fake({ lerPost: async () => null })
    expect(await sincronizarAgendados(c2, db)).toBe(0)
    expect((await obterArtigo(c.id, db))?.wpPostId).toBeNull()
  })

  it('ainda agendado no WP não muda; erro em um não derruba o resto', async () => {
    const a = await criarArtigo({ situacao: 'agendado', wpPostId: 10, wpStatus: 'future' })
    const { cliente } = fake({
      lerPost: async () => ({ id: 10, status: 'future', link: 'l', modificadoGmt: 'm', metaGravada: true }),
    })
    expect(await sincronizarAgendados(cliente, db)).toBe(0)
    expect((await obterArtigo(a.id, db))?.situacao).toBe('agendado')
    const { cliente: ruim } = fake({
      lerPost: async () => {
        throw new ErroWp('rede')
      },
    })
    expect(await sincronizarAgendados(ruim, db)).toBe(0)
  })
})

describe('correções da revisão', () => {
  const publicado = { situacao: 'publicado' as const, wpPostId: 77, wpStatus: 'publish', wpLink: 'https://site.test/x/', wpModificadoGmt: '2026-10-29T10:00:00' }
  const lerIgual = async () => ({ id: 77, status: 'publish', link: 'https://site.test/x/', modificadoGmt: '2026-10-29T10:00:00', metaGravada: true })

  it('artigo publicado: rascunho e agendar são bloqueados; publicar atualiza', async () => {
    const a = await criarArtigo({ ...publicado, agendadoPara: new Date('2026-11-05T13:30:00Z') })
    const { cliente, chamadas } = fake({ lerPost: lerIgual })
    for (const modo of ['rascunho', 'agendar'] as const) {
      const r = await enviarArtigo(a.id, modo, opts(cliente))
      expect(r.tipo).toBe('bloqueado')
      if (r.tipo === 'bloqueado') expect(r.itens.some((i) => i.id === 'publicado' && i.nivel === 'bloqueia')).toBe(true)
    }
    expect(chamadas.atualizar).toHaveLength(0)
    expect((await enviarArtigo(a.id, 'publicar', opts(cliente))).tipo).toBe('ok')
    expect(chamadas.atualizar[0].d.dataGmt).toBeUndefined()
  })

  it('publicar em rascunho ou agendado envia dataGmt = agora', async () => {
    const a = await criarArtigo()
    const { cliente, chamadas } = fake()
    await enviarArtigo(a.id, 'publicar', opts(cliente))
    expect(chamadas.criar[0].dataGmt).toBe('2026-10-29T12:00:00')
  })

  it('publicar em post agendado no WP envia dataGmt = agora', async () => {
    const a = await criarArtigo({ wpPostId: 5, wpStatus: 'future', wpModificadoGmt: '2026-10-29T10:00:00', situacao: 'agendado' })
    const { cliente, chamadas } = fake({
      lerPost: async () => ({ id: 5, status: 'future', link: 'l', modificadoGmt: '2026-10-29T10:00:00', metaGravada: true }),
    })
    await enviarArtigo(a.id, 'publicar', opts(cliente))
    expect(chamadas.atualizar[0].d.dataGmt).toBe('2026-10-29T12:00:00')
  })

  it('WP devolve future para publicar: fica agendado e o tema não vira publicado', async () => {
    const a = await criarArtigo({ situacao: 'agendado', wpPostId: 77, wpStatus: 'future', wpModificadoGmt: '2026-10-29T10:00:00' })
    const { cliente } = fake({
      lerPost: async () => ({ id: 77, status: 'future', link: 'l', modificadoGmt: '2026-10-29T10:00:00', metaGravada: true }),
      atualizarPost: async (id) => ({ id, status: 'future', link: 'https://site.test/x/', modificadoGmt: '2026-10-29T12:00:00', metaGravada: true }),
    })
    await enviarArtigo(a.id, 'publicar', opts(cliente))
    const s = await obterArtigo(a.id, db)
    expect(s?.situacao).toBe('agendado')
    expect(s?.wpStatus).toBe('future')
    const [t] = await db.select().from(topics).where(eq(topics.id, a.topicId))
    expect(t.status).not.toBe('publicado')
  })

  it('status desconhecido do WP (pending) vira draft', async () => {
    const a = await criarArtigo()
    const { cliente } = fake({
      criarPost: async (d) => ({ id: 500, status: 'pending', link: 'l', modificadoGmt: 'm', metaGravada: true, ...(d ? {} : {}) }),
    })
    await enviarArtigo(a.id, 'rascunho', opts(cliente))
    expect((await obterArtigo(a.id, db))?.wpStatus).toBe('draft')
  })

  it('sincronizar não esconde edição do WP: próximo publicar dá conflito', async () => {
    const a = await criarArtigo({ situacao: 'agendado', wpPostId: 10, wpStatus: 'future', wpModificadoGmt: '2026-10-29T10:00:00' })
    const lido = { id: 10, status: 'publish', link: 'https://site.test/a/', modificadoGmt: '2026-11-05T13:30:00', metaGravada: true }
    const { cliente } = fake({ lerPost: async () => lido })
    expect(await sincronizarAgendados(cliente, db)).toBe(1)
    const s = await obterArtigo(a.id, db)
    expect(s?.situacao).toBe('publicado')
    expect(s?.wpModificadoGmt).toBe('2026-10-29T10:00:00')
    expect(await enviarArtigo(a.id, 'publicar', opts(cliente))).toEqual({ tipo: 'conflito' })
  })

  it('sincronizar propaga credencial e nao_encontrado, ignora outros erros', async () => {
    await criarArtigo({ situacao: 'agendado', wpPostId: 10, wpStatus: 'future' })
    for (const t of ['credencial', 'nao_encontrado'] as const) {
      const { cliente } = fake({ lerPost: async () => { throw new ErroWp(t) } })
      await expect(sincronizarAgendados(cliente, db)).rejects.toBeInstanceOf(ErroWp)
    }
  })

  it('envio concorrente: segundo é recusado; trava é liberada após sucesso e após ErroWp', async () => {
    const a = await criarArtigo()
    expect(await reivindicarEnvio(a.id, AGORA, db)).toEqual(AGORA)
    expect(await reivindicarEnvio(a.id, new Date(AGORA.getTime() + 60_000), db)).toBeNull()
    const { cliente, chamadas } = fake()
    expect(await enviarArtigo(a.id, 'rascunho', opts(cliente, { agora: new Date(AGORA.getTime() + 60_000) }))).toEqual({ tipo: 'erro', mensagem: 'envio já em andamento; aguarde' })
    expect(chamadas.criar).toHaveLength(0)
    const marcaB = new Date(AGORA.getTime() + 3 * 60_000)
    expect(await reivindicarEnvio(a.id, marcaB, db)).toEqual(marcaB) // a de A expirou
    await liberarEnvio(a.id, AGORA, db) // A atrasado não solta a de B
    expect((await obterArtigo(a.id, db))?.enviandoDesde).toEqual(marcaB)
    await liberarEnvio(a.id, marcaB, db)
    expect((await enviarArtigo(a.id, 'rascunho', opts(cliente))).tipo).toBe('ok')
    expect((await obterArtigo(a.id, db))?.enviandoDesde).toBeNull()
    expect(await enviarArtigo(99999, 'rascunho', opts(cliente))).toEqual({ tipo: 'erro', mensagem: 'artigo não encontrado' })
    const b = fake({ criarPost: async () => { throw new ErroWp('rede') } })
    await db.update(artigos).set({ wpPostId: null, wpStatus: null }).where(eq(artigos.id, a.id))
    expect((await enviarArtigo(a.id, 'rascunho', opts(b.cliente))).tipo).toBe('erro')
    expect((await obterArtigo(a.id, db))?.enviandoDesde).toBeNull()
  })
})
