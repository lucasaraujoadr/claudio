import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import * as schema from '@/lib/db/schema'
import { artigos, contatos, funilInscricoes, newslettersEnvios, pecasDistribuicao, topics } from '@/lib/db/schema'
import type { BancoCrm } from '@/lib/crm/banco'
import { garantirFunis } from '@/lib/crm/funis'
import { ErroResend } from '@/lib/resend'
import { funis } from '@/lib/db/schema'
import {
  contarDestinatariosNewsletter,
  criarRascunhoNewsletter,
  enviarNewsletter,
  MENSAGEM_DESCADASTROS_PENDENTES,
  montarNewsletter,
} from '../newsletter'

let db: BancoCrm
let pg: PGlite
beforeAll(async () => {
  pg = new PGlite()
  const tabelas = Object.fromEntries(Object.entries(schema).filter(([, v]) => v && (typeof v === 'object' || typeof v === 'function')))
  for (const c of await generateMigration(generateDrizzleJson({}), generateDrizzleJson(tabelas))) await pg.exec(c)
  db = drizzle(pg, { schema }) as unknown as BancoCrm
})
afterAll(async () => {
  await pg.close()
})
beforeEach(async () => {
  await db.delete(newslettersEnvios)
  await db.delete(funilInscricoes)
  await db.delete(contatos)
  await db.delete(pecasDistribuicao)
  await db.delete(artigos)
  await db.delete(topics)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const CONTEUDO = {
  assunto: 'Perícia contábil na prática',
  preCabecalho: 'O que o advogado precisa saber',
  abertura: 'Resumo <b>do</b> artigo & mais.',
  pontos: ['Ponto um', 'Ponto dois', 'Ponto três'],
}

async function artigoComPeca(over: Partial<typeof artigos.$inferInsert> = {}, conteudo: unknown = CONTEUDO) {
  const [t] = await db
    .insert(topics)
    .values({ titulo: 'T', keyword: 'k', keywordNormalizada: 'k', intencao: 'informacional', prioridade: 'alta', origem: 'ia' })
    .returning()
  const [a] = await db
    .insert(artigos)
    .values({ topicId: t.id, situacao: 'pronto', titulo: 'Título', slug: 'pericia-contabil', ...over })
    .returning()
  const [p] = await db
    .insert(pecasDistribuicao)
    .values({ artigoId: a.id, tipo: 'newsletter', situacao: 'rascunho', conteudo })
    .returning()
  return { artigo: a, peca: p }
}

function resendFalso() {
  const chamadas: string[] = []
  let n = 0
  const estado = { falharEnvio: null as ErroResend | null, falharAtualizar: null as ErroResend | null }
  const cliente = {
    garantirSegmento: vi.fn(async () => ({ id: 'seg1' })),
    criarBroadcast: vi.fn(async (b: { segmentoId: string; html: string }) => {
      chamadas.push('criar')
      return { id: `bc_${++n}` }
    }),
    atualizarBroadcast: vi.fn(async () => {
      chamadas.push('atualizar')
      if (estado.falharAtualizar) throw estado.falharAtualizar
    }),
    enviarBroadcast: vi.fn(async () => {
      chamadas.push('enviar')
      if (estado.falharEnvio) throw estado.falharEnvio
    }),
    lerBroadcast: vi.fn(async (id: string) => ({ id, status: 'draft' })),
    salvarContato: vi.fn(async () => ({ id: 'rc' })),
    adicionarAoSegmento: vi.fn(async () => {}),
    removerDoSegmento: vi.fn(async () => {}),
  }
  return { cliente: cliente as unknown as import('@/lib/resend').ClienteResend, mocks: cliente, chamadas, estado }
}

let seq = 0
async function contato(extra: Partial<typeof contatos.$inferInsert> = {}, naNutricao = true) {
  await garantirFunis({ db })
  const email = `c${++seq}@example.com`
  const [c] = await db
    .insert(contatos)
    .values({ nome: 'Fulano', email, emailNormalizado: email, origem: 'site', baseLegal: 'consentimento', status: 'lead', syncStatus: 'sincronizado', ...extra })
    .returning()
  if (naNutricao) {
    const [f] = await db.select().from(funis).where(eq(funis.slug, 'nutricao-blog'))
    await db.insert(funilInscricoes).values({ contatoId: c.id, funilId: f.id, status: 'ativo', origem: 'manual' })
  }
  return c
}

const ok = async () => true
const opts = (r: ReturnType<typeof resendFalso>, extra: object = {}) => ({ db, cliente: r.cliente, acessoPublico: ok, ...extra })

describe('montarNewsletter', () => {
  const m = montarNewsletter(CONTEUDO as never, { link: 'https://ogpericiacontabil.com.br/pericia-contabil/', slug: 'pericia-contabil' })
  it('html tem RESEND_UNSUBSCRIBE_URL e UTM', () => {
    expect(m.html).toContain('{{{RESEND_UNSUBSCRIBE_URL}}}')
    expect(m.texto).toContain('{{{RESEND_UNSUBSCRIBE_URL}}}')
    expect(m.html).toContain('utm_source=newsletter&amp;utm_medium=email&amp;utm_campaign=pericia-contabil')
    expect(m.texto).toContain('utm_source=newsletter&utm_medium=email&utm_campaign=pericia-contabil')
    expect(m.html).toContain('Ler o artigo completo')
  })
  it('pré-cabeçalho oculto no topo do corpo e texto escapado', () => {
    expect(m.html).toMatch(/<body[^>]*>\s*<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">O que o advogado precisa saber<\/div>/)
    expect(m.html).toContain('Resumo &lt;b&gt;do&lt;/b&gt; artigo &amp; mais.')
    expect(m.html).not.toContain('<b>do</b>')
    expect(m.assunto).toBe(CONTEUDO.assunto)
    expect(m.preCabecalho).toBe(CONTEUDO.preCabecalho)
  })
  it('preserva query existente do link', () => {
    const x = montarNewsletter(CONTEUDO as never, { link: 'https://x.com/?p=3', slug: 's' })
    expect(x.texto).toContain('https://x.com/?p=3&utm_source=newsletter')
  })
})

describe('criarRascunhoNewsletter', () => {
  it('cria o broadcast no segmento e grava rascunho com o link do wpLink', async () => {
    const { peca } = await artigoComPeca({ wpLink: 'https://ogpericiacontabil.com.br/artigo-wp/' })
    await contato()
    const r = resendFalso()
    const res = await criarRascunhoNewsletter(peca.id, opts(r))
    expect(res.ok).toBe(true)
    const [e] = await db.select().from(newslettersEnvios)
    expect(e).toMatchObject({ situacao: 'rascunho', resendBroadcastId: 'bc_1', destinatarios: 1 })
    const arg = r.mocks.criarBroadcast.mock.calls[0][0]
    expect(arg.segmentoId).toBe('seg1')
    expect(arg.html).toContain('artigo-wp')
  })
  it('sem wpLink usa siteUrl/slug', async () => {
    const { peca } = await artigoComPeca()
    const r = resendFalso()
    await criarRascunhoNewsletter(peca.id, opts(r))
    expect(r.mocks.criarBroadcast.mock.calls[0][0].html).toContain('https://ogpericiacontabil.com.br/pericia-contabil/?utm_source')
  })
  it('segundo rascunho atualiza o mesmo broadcast', async () => {
    const { peca } = await artigoComPeca()
    const r = resendFalso()
    await criarRascunhoNewsletter(peca.id, opts(r))
    await criarRascunhoNewsletter(peca.id, opts(r))
    expect(r.chamadas).toEqual(['criar', 'atualizar'])
    const linhas = await db.select().from(newslettersEnvios)
    expect(linhas).toHaveLength(1)
    expect(linhas[0].resendBroadcastId).toBe('bc_1')
  })
  it('broadcast sumiu no Resend: cria outro e troca o id na mesma linha', async () => {
    const { peca } = await artigoComPeca()
    const r = resendFalso()
    await criarRascunhoNewsletter(peca.id, opts(r))
    r.estado.falharAtualizar = new ErroResend('nao_encontrado')
    await criarRascunhoNewsletter(peca.id, opts(r))
    const linhas = await db.select().from(newslettersEnvios)
    expect(linhas).toHaveLength(1)
    expect(linhas[0].resendBroadcastId).toBe('bc_2')
  })
  it('recusa peça que não é newsletter, não existe ou sem conteúdo válido', async () => {
    const { peca } = await artigoComPeca({}, { assunto: '' })
    const r = resendFalso()
    expect((await criarRascunhoNewsletter(peca.id, opts(r))).ok).toBe(false)
    expect((await criarRascunhoNewsletter(9999, opts(r))).ok).toBe(false)
    expect(r.mocks.criarBroadcast).not.toHaveBeenCalled()
  })
  it('erro do Resend na criação não grava a chave nem derruba', async () => {
    const { peca } = await artigoComPeca()
    const r = resendFalso()
    r.mocks.criarBroadcast.mockRejectedValueOnce(new ErroResend('credencial'))
    const res = await criarRascunhoNewsletter(peca.id, opts(r))
    expect(res).toMatchObject({ ok: false })
    expect(await db.select().from(newslettersEnvios)).toHaveLength(0)
  })
})

describe('rascunho: envio repetido e concorrência', () => {
  it('re-rascunho depois de enviado é recusado', async () => {
    await contato()
    const r = resendFalso()
    const { peca } = await artigoComPeca()
    await criarRascunhoNewsletter(peca.id, opts(r))
    const [e] = await db.select().from(newslettersEnvios)
    expect((await enviarNewsletter(e.id, opts(r))).ok).toBe(true)
    const res = await criarRascunhoNewsletter(peca.id, opts(r))
    expect(res).toEqual({ ok: false, mensagem: 'a newsletter deste artigo já foi enviada' })
    expect(await db.select().from(newslettersEnvios)).toHaveLength(1)
    expect(r.mocks.criarBroadcast).toHaveBeenCalledTimes(1)
  })
  it('duas criações simultâneas: uma linha e um broadcast', async () => {
    const { peca } = await artigoComPeca()
    const r = resendFalso()
    await Promise.all([criarRascunhoNewsletter(peca.id, opts(r)), criarRascunhoNewsletter(peca.id, opts(r))])
    expect(await db.select().from(newslettersEnvios)).toHaveLength(1)
    expect(r.mocks.criarBroadcast).toHaveBeenCalledTimes(1)
  })
  it('falha ao criar o broadcast não deixa linha órfã', async () => {
    const { peca } = await artigoComPeca()
    const r = resendFalso()
    r.mocks.criarBroadcast.mockRejectedValueOnce(new ErroResend('servidor'))
    expect((await criarRascunhoNewsletter(peca.id, opts(r))).ok).toBe(false)
    expect(await db.select().from(newslettersEnvios)).toHaveLength(0)
    expect((await criarRascunhoNewsletter(peca.id, opts(r))).ok).toBe(true)
  })
  it('link malformado devolve recusa amigável', async () => {
    const { peca } = await artigoComPeca({ wpLink: 'http://' })
    const r = resendFalso()
    const res = await criarRascunhoNewsletter(peca.id, opts(r))
    expect(res).toMatchObject({ ok: false })
    expect(r.mocks.criarBroadcast).not.toHaveBeenCalled()
  })
})

describe('contarDestinatariosNewsletter', () => {
  it('conta só elegíveis já sincronizados', async () => {
    await contato() // conta
    await contato({ status: 'cliente', baseLegal: 'contrato' }) // conta
    await contato({ syncStatus: 'pendente' })
    await contato({ status: 'descadastrado' })
    await contato({ dadosApagadosEm: new Date() })
    await contato({ baseLegal: 'legitimo_interesse' })
    await contato({}, false) // fora da nutrição
    expect(await contarDestinatariosNewsletter(db)).toBe(2)
  })
})

async function rascunhoPronto(r: ReturnType<typeof resendFalso>) {
  const { peca } = await artigoComPeca()
  await criarRascunhoNewsletter(peca.id, opts(r))
  const [e] = await db.select().from(newslettersEnvios)
  return e
}

describe('enviarNewsletter', () => {
  it('envia imediatamente: enviado, com destinatários', async () => {
    await contato()
    const r = resendFalso()
    const e = await rascunhoPronto(r)
    const res = await enviarNewsletter(e.id, opts(r))
    expect(res).toMatchObject({ ok: true, situacao: 'enviado' })
    const [depois] = await db.select().from(newslettersEnvios)
    expect(depois).toMatchObject({ situacao: 'enviado', destinatarios: 1 })
    expect(depois.enviadoEm).not.toBeNull()
    expect(r.mocks.enviarBroadcast).toHaveBeenCalledWith('bc_1')
  })
  it('enviar sem acesso público → bloqueado', async () => {
    await contato()
    const r = resendFalso()
    const e = await rascunhoPronto(r)
    const res = await enviarNewsletter(e.id, opts(r, { acessoPublico: async () => false }))
    expect(res).toMatchObject({ ok: false })
    expect(r.mocks.enviarBroadcast).not.toHaveBeenCalled()
    expect((await db.select().from(newslettersEnvios))[0].situacao).toBe('rascunho')
  })
  it('enviar duas vezes → a segunda recusa', async () => {
    await contato()
    const r = resendFalso()
    const e = await rascunhoPronto(r)
    expect((await enviarNewsletter(e.id, opts(r))).ok).toBe(true)
    expect((await enviarNewsletter(e.id, opts(r))).ok).toBe(false)
    expect(r.mocks.enviarBroadcast).toHaveBeenCalledTimes(1)
  })
  it('duas chamadas simultâneas: só uma envia', async () => {
    await contato()
    const r = resendFalso()
    const e = await rascunhoPronto(r)
    const [a, b] = await Promise.all([enviarNewsletter(e.id, opts(r)), enviarNewsletter(e.id, opts(r))])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    expect(r.mocks.enviarBroadcast).toHaveBeenCalledTimes(1)
  })
  it('erro do Resend grava erro sem a chave e volta a rascunho', async () => {
    await contato()
    const r = resendFalso()
    const e = await rascunhoPronto(r)
    r.estado.falharEnvio = new ErroResend('credencial')
    const res = await enviarNewsletter(e.id, opts(r))
    expect(res).toMatchObject({ ok: false })
    const [depois] = await db.select().from(newslettersEnvios)
    expect(depois.situacao).toBe('rascunho')
    expect(depois.enviadoEm).toBeNull()
    expect(depois.erro).toBe('chave do Resend inválida ou sem permissão')
    expect(depois.erro).not.toMatch(/re_|Bearer/)
    // pode tentar de novo
    r.estado.falharEnvio = null
    expect((await enviarNewsletter(e.id, opts(r))).ok).toBe(true)
  })
  it('sincroniza pendentes antes de enviar; descadastro pendente que sincroniza não bloqueia', async () => {
    await contato()
    const d = await contato({ status: 'descadastrado', syncStatus: 'pendente' }, false)
    const r = resendFalso()
    const e = await rascunhoPronto(r)
    const res = await enviarNewsletter(e.id, opts(r))
    expect(res.ok).toBe(true)
    expect(r.mocks.salvarContato).toHaveBeenCalledWith(expect.objectContaining({ email: d.emailNormalizado, descadastrado: true }))
    const ordem = [r.mocks.salvarContato.mock.invocationCallOrder[0], r.mocks.enviarBroadcast.mock.invocationCallOrder[0]]
    expect(ordem[0]).toBeLessThan(ordem[1])
  })
  it('descadastro que não sincroniza → recusa com a mensagem e não envia', async () => {
    await contato()
    await contato({ status: 'descadastrado', syncStatus: 'pendente' }, false)
    const r = resendFalso()
    const e = await rascunhoPronto(r)
    r.mocks.salvarContato.mockRejectedValue(new ErroResend('servidor'))
    const res = await enviarNewsletter(e.id, opts(r))
    expect(res).toEqual({
      ok: false,
      mensagem: 'há descadastros ainda não sincronizados com o Resend; tente de novo em alguns minutos',
    })
    expect(r.mocks.enviarBroadcast).not.toHaveBeenCalled()
    expect((await db.select().from(newslettersEnvios))[0].situacao).toBe('rascunho')
  })
  it('dados apagados em erro de sincronização também bloqueiam', async () => {
    await contato()
    await contato({ dadosApagadosEm: new Date(), syncStatus: 'erro' }, false)
    const r = resendFalso()
    const e = await rascunhoPronto(r)
    r.mocks.salvarContato.mockRejectedValue(new ErroResend('servidor'))
    const res = await enviarNewsletter(e.id, opts(r))
    expect(res.ok).toBe(false)
    expect(r.mocks.enviarBroadcast).not.toHaveBeenCalled()
  })
  it('saiu do funil e o sync falhou → recusa', async () => {
    await contato()
    const c = await contato({ syncStatus: 'erro' }, false) // sem inscrição ativa
    const r = resendFalso()
    const e = await rascunhoPronto(r)
    r.mocks.removerDoSegmento.mockRejectedValue(new ErroResend('servidor'))
    r.mocks.salvarContato.mockRejectedValue(new ErroResend('servidor'))
    expect(c.id).toBeGreaterThan(0)
    const res = await enviarNewsletter(e.id, opts(r))
    expect(res).toEqual({ ok: false, mensagem: MENSAGEM_DESCADASTROS_PENDENTES })
    expect(r.mocks.enviarBroadcast).not.toHaveBeenCalled()
  })
  it('base legal mudou e o sync falhou → recusa', async () => {
    await contato()
    await contato({ baseLegal: 'legitimo_interesse', syncStatus: 'pendente' })
    const r = resendFalso()
    const e = await rascunhoPronto(r)
    r.mocks.removerDoSegmento.mockRejectedValue(new ErroResend('servidor'))
    const res = await enviarNewsletter(e.id, opts(r))
    expect(res.ok).toBe(false)
    expect(r.mocks.enviarBroadcast).not.toHaveBeenCalled()
  })
  it('contato elegível pendente não bloqueia', async () => {
    await contato()
    await contato({ syncStatus: 'pendente' })
    const r = resendFalso()
    const e = await rascunhoPronto(r)
    r.mocks.salvarContato.mockRejectedValue(new ErroResend('servidor'))
    expect((await enviarNewsletter(e.id, opts(r))).ok).toBe(true)
  })
  it('erro ambíguo: broadcast já não é rascunho → mantém enviado', async () => {
    await contato()
    const r = resendFalso()
    const e = await rascunhoPronto(r)
    r.estado.falharEnvio = new ErroResend('rede')
    r.mocks.lerBroadcast.mockResolvedValue({ id: 'bc_1', status: 'sent' })
    expect(await enviarNewsletter(e.id, opts(r))).toMatchObject({ ok: true, situacao: 'enviado' })
    expect((await db.select().from(newslettersEnvios))[0].situacao).toBe('enviado')
  })
  it('erro ambíguo: ainda rascunho ou leitura falha → volta a rascunho com erro', async () => {
    await contato()
    const r = resendFalso()
    const e = await rascunhoPronto(r)
    r.estado.falharEnvio = new ErroResend('servidor')
    expect((await enviarNewsletter(e.id, opts(r))).ok).toBe(false)
    expect((await db.select().from(newslettersEnvios))[0]).toMatchObject({ situacao: 'rascunho', erro: expect.any(String) })
    r.mocks.lerBroadcast.mockRejectedValue(new ErroResend('rede'))
    expect((await enviarNewsletter(e.id, opts(r))).ok).toBe(false)
    expect((await db.select().from(newslettersEnvios))[0].situacao).toBe('rascunho')
  })
  it('contagem não duplica contato', async () => {
    const c = await contato()
    await garantirFunis({ db })
    expect(await contarDestinatariosNewsletter(db)).toBe(1)
    expect(c.id).toBeGreaterThan(0)
  })
  it('sem destinatários → recusa', async () => {
    const r = resendFalso()
    const e = await rascunhoPronto(r)
    expect((await enviarNewsletter(e.id, opts(r))).ok).toBe(false)
    expect(r.mocks.enviarBroadcast).not.toHaveBeenCalled()
  })
  it('envio inexistente → recusa', async () => {
    const r = resendFalso()
    expect((await enviarNewsletter(9999, opts(r))).ok).toBe(false)
  })
})
