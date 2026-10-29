import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { artigos, tesesSugeridas, topics } from '@/lib/db/schema'
import type { BancoCrm } from '@/lib/crm/banco'
import { criarBancoTesteArtigos } from './banco-teste-artigos'
import {
  desvincularDoWp,
  falharGeracao,
  concluirGeracao,
  listarAgendados,
  listarArtigos,
  obterArtigo,
  obterArtigoDoTema,
  reivindicarGeracao,
  registrarEnvio,
  salvarEdicao,
} from '../repositorio'

let db: BancoCrm
let fechar: () => Promise<void>

const AGORA = new Date('2026-10-29T12:00:00Z')
const minutosAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000)

beforeAll(async () => {
  ;({ db, fechar } = await criarBancoTesteArtigos())
})
afterAll(async () => {
  await fechar()
})
beforeEach(async () => {
  await db.delete(artigos)
  await db.delete(tesesSugeridas)
  await db.delete(topics)
})

async function criarTema(keyword = 'pericia contabil') {
  const [t] = await db
    .insert(topics)
    .values({
      titulo: 'Perícia contábil',
      keyword,
      keywordNormalizada: keyword,
      intencao: 'informacional',
      prioridade: 'media',
      origem: 'ia',
    })
    .returning()
  return t
}

async function criarTese(keyword: string, status: 'nova' | 'virou_tema' | 'descartada' = 'nova') {
  const [t] = await db
    .insert(tesesSugeridas)
    .values({
      titulo: 'Tese ' + keyword,
      keyword,
      keywordNormalizada: keyword,
      intencao: 'informacional',
      justificativa: 'j',
      potencial: 'alto',
      sinais: [],
      status,
    })
    .returning()
  return t
}

async function artigoRascunho(opcoes: { revisado?: boolean } = {}) {
  const tema = await criarTema()
  const r = await reivindicarGeracao({ topicId: tema.id }, AGORA, db)
  if (r.tipo !== 'reivindicado') throw new Error('esperava reivindicado')
  await concluirGeracao(
    r.artigoId,
    { titulo: 'T', slug: 't', metaDescription: 'm', conteudoHtml: '<p>a</p>', fontes: [], modelo: 'x' },
    AGORA,
    db,
  )
  if (opcoes.revisado) await salvarEdicao(r.artigoId, { revisado: true }, AGORA, db)
  return { tema, id: r.artigoId }
}

const envio = (wpStatus: 'draft' | 'future' | 'publish') => ({
  wpPostId: 77,
  wpStatus,
  wpLink: 'https://site.com/p',
  wpModificadoGmt: '2026-10-29T12:00:00',
})

describe('reivindicarGeracao', () => {
  it('reivindica uma vez: dois simultâneos ({topicId}) → um reivindicado, um existe, 1 linha', async () => {
    const tema = await criarTema()
    const [a, b] = await Promise.all([
      reivindicarGeracao({ topicId: tema.id }, AGORA, db),
      reivindicarGeracao({ topicId: tema.id }, AGORA, db),
    ])
    expect([a.tipo, b.tipo].sort()).toEqual(['existe', 'reivindicado'])
    expect(await db.select().from(artigos)).toHaveLength(1)
  })

  it('gerando há 11 min é re-reivindicado; há 5 min é existe', async () => {
    const tema = await criarTema()
    const r = await reivindicarGeracao({ topicId: tema.id }, minutosAtras(11), db)
    const preso = await reivindicarGeracao({ topicId: tema.id }, AGORA, db)
    expect(preso).toEqual({ tipo: 'reivindicado', artigoId: (r as { artigoId: number }).artigoId, topicId: tema.id })
    const [linha] = await db.select().from(artigos)
    expect(linha.atualizadoEm.getTime()).toBe(AGORA.getTime())

    const recente = await reivindicarGeracao({ topicId: tema.id }, new Date(AGORA.getTime() + 5 * 60_000), db)
    expect(recente.tipo).toBe('existe')
  })

  it('erro_geracao é re-reivindicado', async () => {
    const tema = await criarTema()
    const r = await reivindicarGeracao({ topicId: tema.id }, AGORA, db)
    if (r.tipo !== 'reivindicado') throw new Error()
    await falharGeracao(r.artigoId, 'deu ruim', AGORA, db)
    expect((await obterArtigo(r.artigoId, db))?.situacao).toBe('erro_geracao')
    const de_novo = await reivindicarGeracao({ topicId: tema.id }, AGORA, db)
    expect(de_novo.tipo).toBe('reivindicado')
    const a = await obterArtigo(r.artigoId, db)
    expect(a?.situacao).toBe('gerando')
    expect(a?.erro).toBeNull()
  })

  it('tema inexistente → nao_encontrado', async () => {
    expect(await reivindicarGeracao({ topicId: 9999 }, AGORA, db)).toEqual({ tipo: 'nao_encontrado' })
  })

  it('de tese nova: cria tema origem tendencia, tese vira virou_artigo', async () => {
    const tese = await criarTese('reforma tributaria')
    const r = await reivindicarGeracao({ teseId: tese.id }, AGORA, db)
    expect(r.tipo).toBe('reivindicado')
    const [tema] = await db.select().from(topics)
    expect(tema.origem).toBe('tendencia')
    expect(tema.keywordNormalizada).toBe('reforma tributaria')
    const [t] = await db.select().from(tesesSugeridas).where(eq(tesesSugeridas.id, tese.id))
    expect(t.status).toBe('virou_artigo')
    const [art] = await db.select().from(artigos)
    expect(art.topicId).toBe(tema.id)
    expect(art.teseId).toBe(tese.id)
  })

  it('de tese cuja keyword já é tema: reaproveita o tema existente (sem novo topic)', async () => {
    const tema = await criarTema('lucro presumido')
    const tese = await criarTese('lucro presumido', 'virou_tema')
    const r = await reivindicarGeracao({ teseId: tese.id }, AGORA, db)
    expect(r).toMatchObject({ tipo: 'reivindicado', topicId: tema.id })
    expect(await db.select().from(topics)).toHaveLength(1)
  })

  it('tese descartada → nao_encontrado', async () => {
    const tese = await criarTese('x', 'descartada')
    expect(await reivindicarGeracao({ teseId: tese.id }, AGORA, db)).toEqual({ tipo: 'nao_encontrado' })
    expect(await db.select().from(artigos)).toHaveLength(0)
  })

  it('segundo clique na mesma tese → existe', async () => {
    const tese = await criarTese('segundo clique')
    await reivindicarGeracao({ teseId: tese.id }, AGORA, db)
    expect((await reivindicarGeracao({ teseId: tese.id }, AGORA, db)).tipo).toBe('existe')
    expect(await db.select().from(artigos)).toHaveLength(1)
  })
})

describe('salvarEdicao', () => {
  it('em artigo enviado marca alteradoAposEnvio; só revisado não marca', async () => {
    const { id } = await artigoRascunho()
    await registrarEnvio(id, envio('draft'), AGORA, db)
    const so_revisado = await salvarEdicao(id, { revisado: true }, AGORA, db)
    expect(so_revisado?.alteradoAposEnvio).toBe(false)
    const mudou = await salvarEdicao(id, { titulo: 'Novo título' }, AGORA, db)
    expect(mudou?.alteradoAposEnvio).toBe(true)
    expect(mudou?.titulo).toBe('Novo título')
  })

  it('não marca alteradoAposEnvio em artigo nunca enviado', async () => {
    const { id } = await artigoRascunho()
    expect((await salvarEdicao(id, { titulo: 'Outro' }, AGORA, db))?.alteradoAposEnvio).toBe(false)
  })

  it('recusa artigo gerando', async () => {
    const tema = await criarTema()
    const r = await reivindicarGeracao({ topicId: tema.id }, AGORA, db)
    if (r.tipo !== 'reivindicado') throw new Error()
    expect(await salvarEdicao(r.artigoId, { titulo: 'x' }, AGORA, db)).toBeNull()
  })

  it('revisado=true leva rascunho a pronto e false volta', async () => {
    const { id } = await artigoRascunho()
    expect((await salvarEdicao(id, { revisado: true }, AGORA, db))?.situacao).toBe('pronto')
    expect((await salvarEdicao(id, { revisado: false }, AGORA, db))?.situacao).toBe('rascunho')
  })

  it('revisado não mexe em agendado/publicado', async () => {
    const { id } = await artigoRascunho({ revisado: true })
    await registrarEnvio(id, envio('future'), AGORA, db)
    expect((await salvarEdicao(id, { revisado: false }, AGORA, db))?.situacao).toBe('agendado')
  })
})

describe('envio ao WordPress', () => {
  it('publish atualiza topics.status publicado e url_publicada', async () => {
    const { id, tema } = await artigoRascunho({ revisado: true })
    const a = await registrarEnvio(id, envio('publish'), AGORA, db)
    expect(a?.situacao).toBe('publicado')
    const [t] = await db.select().from(topics).where(eq(topics.id, tema.id))
    expect(t.status).toBe('publicado')
    expect(t.urlPublicada).toBe('https://site.com/p')
  })

  it('future → agendado; draft com revisado → pronto; draft sem revisado → rascunho', async () => {
    const a = await artigoRascunho({ revisado: true })
    expect((await registrarEnvio(a.id, envio('future'), AGORA, db))?.situacao).toBe('agendado')
    expect((await registrarEnvio(a.id, envio('draft'), AGORA, db))?.situacao).toBe('pronto')
    await salvarEdicao(a.id, { revisado: false }, AGORA, db)
    expect((await registrarEnvio(a.id, envio('draft'), AGORA, db))?.situacao).toBe('rascunho')
  })

  it('registrarEnvio zera alteradoAposEnvio e erro, grava enviadoEm', async () => {
    const { id } = await artigoRascunho()
    await registrarEnvio(id, envio('draft'), AGORA, db)
    await salvarEdicao(id, { titulo: 'm' }, AGORA, db)
    const a = await registrarEnvio(id, envio('draft'), AGORA, db)
    expect(a?.alteradoAposEnvio).toBe(false)
    expect(a?.erro).toBeNull()
    expect(a?.enviadoEm?.getTime()).toBe(AGORA.getTime())
  })

  it('desvincularDoWp zera wpPostId/wpLink/wpStatus', async () => {
    const { id } = await artigoRascunho({ revisado: true })
    await registrarEnvio(id, envio('future'), AGORA, db)
    const a = await desvincularDoWp(id, db)
    expect(a).toMatchObject({ wpPostId: null, wpLink: null, wpStatus: null, wpModificadoGmt: null, situacao: 'pronto' })
  })

  it('listarAgendados devolve só os agendados com post no WP', async () => {
    const a = await artigoRascunho({ revisado: true })
    expect(await listarAgendados(db)).toHaveLength(0)
    await registrarEnvio(a.id, envio('future'), AGORA, db)
    expect((await listarAgendados(db)).map((x) => x.id)).toEqual([a.id])
  })
})

describe('consultas', () => {
  it('obterArtigoDoTema e listarArtigos (com keyword, filtro por situação)', async () => {
    const { id, tema } = await artigoRascunho()
    expect((await obterArtigoDoTema(tema.id, db))?.id).toBe(id)
    expect(await obterArtigoDoTema(9999, db)).toBeNull()
    const todos = await listarArtigos(undefined, db)
    expect(todos[0]).toMatchObject({ id, keyword: 'pericia contabil' })
    expect(await listarArtigos({ situacao: 'publicado' }, db)).toHaveLength(0)
    expect(await listarArtigos({ situacao: 'rascunho' }, db)).toHaveLength(1)
  })
})
