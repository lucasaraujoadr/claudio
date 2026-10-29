import { and, eq, ne } from 'drizzle-orm'
import { bancoPadrao, type BancoCrm } from '@/lib/crm/banco'
import { briefings, topics, type Briefing } from '@/lib/db/schema'
import {
  gerarObjetoComBuscaEFontes,
  gerarObjetoPadrao,
  modeloEmUso,
  type GerarObjeto,
} from '@/lib/ai/cliente'
import { gerarBriefing, repararMeta, repararTitle } from '@/lib/ai/briefing'
import { carregarUrlsDoSite } from '@/lib/ai/contexto'
import { META_MAX, META_MIN, TITLE_MAX, TITLE_MIN } from '@/lib/ai/schemas'
import { artigoSchemaModelo, normalizarSlug, paraHtml } from './formato'
import { sanitizarHtml, textoPuro } from './html'
import {
  montarPromptArtigo,
  montarPromptPesquisa,
  montarPromptReescrita,
  pesquisaSchemaModelo,
  reescritaSchemaModelo,
  urlsParaArtigo,
  type Fato,
} from './prompts'
import { concluirGeracao, falharGeracao } from './repositorio'

export { montarPromptArtigo, montarPromptPesquisa, pesquisaSchemaModelo } from './prompts'

const MENSAGEM_FALHA = 'falha ao gerar o artigo; tente de novo'
const TRECHO_MAX = 4000
const INSTRUCAO_MAX = 500

export type DepsGeracao = {
  gerar?: GerarObjeto
  buscar?: typeof gerarObjetoComBuscaEFontes
  db?: BancoCrm
  agora?: () => Date
  /** URLs do site para links internos; padrão: última auditoria concluída. */
  urlsDoSite?: () => Promise<string[]>
}

// Ruling A: gera o briefing para tema em qualquer status ≠ 'briefado'. Grava com o db injetado.
async function obterOuGerarBriefing(
  topico: typeof topics.$inferSelect,
  urlsDoSite: string[],
  gerar: GerarObjeto,
  db: BancoCrm,
): Promise<Briefing> {
  const [existente] = await db.select().from(briefings).where(eq(briefings.topicId, topico.id))
  if (existente) return existente
  const b = await gerarBriefing({ topico, urlsDoSite }, gerar)
  return db.transaction(async (tx) => {
    const [novo] = await tx
      .insert(briefings)
      .values({
        topicId: topico.id,
        title: b.title,
        metaDescription: b.metaDescription,
        outline: b.outline,
        faq: b.faq,
        linksInternos: b.linksInternos,
        keywordsSecundarias: b.keywordsSecundarias,
        modelo: modeloEmUso(),
        ajustes: b.ajustes.length > 0 ? b.ajustes : null,
      })
      .returning()
    // Tema já publicado não volta a 'briefado'.
    await tx.update(topics).set({ status: 'briefado' }).where(and(eq(topics.id, topico.id), ne(topics.status, 'publicado')))
    return novo
  })
}

function tituloFinal(titulo: string, keyword: string, briefing: Briefing): string {
  const t = textoPuro(titulo)
  if (t.length >= TITLE_MIN && t.length <= TITLE_MAX) return t
  return repararTitle(t, keyword) ?? briefing.title
}

function metaFinal(meta: string, keyword: string, briefing: Briefing): string {
  const m = textoPuro(meta)
  if (m.length >= META_MIN && m.length <= META_MAX) return m
  return repararMeta(m, keyword) ?? briefing.metaDescription
}

export async function executarGeracao(
  artigoId: number,
  topicId: number,
  deps: DepsGeracao = {},
): Promise<'ok' | 'erro'> {
  const db = deps.db ?? bancoPadrao()
  const gerar = deps.gerar ?? gerarObjetoPadrao
  const buscar = deps.buscar ?? gerarObjetoComBuscaEFontes
  const agora = deps.agora ?? (() => new Date())
  try {
    const [topico] = await db.select().from(topics).where(eq(topics.id, topicId))
    if (!topico) throw new Error('tema não encontrado')
    const urlsDoSite = urlsParaArtigo(await (deps.urlsDoSite ?? carregarUrlsDoSite)())
    const briefing = await obterOuGerarBriefing(topico, urlsDoSite, gerar, db)

    // A pesquisa é opcional: se falhar, o artigo sai sem notas e sem fontes.
    let fatos: Fato[] = []
    let fontes: { url: string }[] = []
    try {
      const r = await buscar({
        schema: pesquisaSchemaModelo,
        prompt: montarPromptPesquisa({ keyword: topico.keyword, titulo: topico.titulo }),
      })
      fatos = r.valor.fatos
      fontes = r.fontes.map((url) => ({ url }))
    } catch (e) {
      console.error('pesquisa do artigo falhou:', e instanceof Error ? e.name : 'erro')
    }

    const bruto = await gerar({
      schema: artigoSchemaModelo,
      prompt: montarPromptArtigo({ topico, briefing, fatos, urlsDoSite }),
    })
    const artigo = artigoSchemaModelo.parse(bruto)
    const slug = normalizarSlug(artigo.slug) || normalizarSlug(topico.keyword)
    const conteudoHtml = sanitizarHtml(paraHtml(artigo, urlsDoSite))
    if (!conteudoHtml.trim()) throw new Error('artigo vazio')

    await concluirGeracao(
      artigoId,
      {
        titulo: tituloFinal(artigo.titulo, topico.keyword, briefing),
        slug,
        metaDescription: metaFinal(artigo.metaDescription, topico.keyword, briefing),
        conteudoHtml,
        fontes,
        modelo: modeloEmUso(),
      },
      agora(),
      db,
    )
    return 'ok'
  } catch (e) {
    console.error('geração do artigo falhou:', e instanceof Error ? e.name : 'erro')
    try {
      await falharGeracao(artigoId, MENSAGEM_FALHA, agora(), db)
    } catch (e2) {
      console.error('não foi possível registrar a falha:', e2 instanceof Error ? e2.name : 'erro')
    }
    return 'erro'
  }
}

export async function reescreverTrecho(
  t: { trecho: string; instrucao: string; keyword: string },
  gerar: GerarObjeto = gerarObjetoPadrao,
): Promise<string> {
  if (t.trecho.length > TRECHO_MAX || t.instrucao.length > INSTRUCAO_MAX) throw new Error('trecho longo demais')
  const r = await gerar({ schema: reescritaSchemaModelo, prompt: montarPromptReescrita(t) })
  const texto = r.texto
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
  if (!texto) throw new Error('resposta vazia')
  return texto
}

