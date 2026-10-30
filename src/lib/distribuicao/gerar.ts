import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import { bancoPadrao, type BancoCrm } from '@/lib/crm/banco'
import { artigos, topics } from '@/lib/db/schema'
import { gerarObjetoPadrao, modeloEmUso, type GerarObjeto } from '@/lib/ai/cliente'
import { contarVerificar, htmlParaTexto } from '@/lib/artigos/html'
import { siteUrl } from '@/lib/site'
import { montarPromptPeca } from './prompts'
import { concluirPeca, falharPeca, reivindicarPeca } from './repositorio'
import { repararPeca, SCHEMAS_MODELO, TIPOS_PECA, type TipoPeca } from './schemas'

const MENSAGEM_FALHA = 'falha ao gerar a peça; tente de novo'
const SITUACOES_OK = new Set(['pronto', 'agendado', 'publicado'])

export type OpcoesGerarPecas = {
  tipos?: TipoPeca[]
  gerar?: GerarObjeto
  db?: BancoCrm
  agora?: () => Date
}

export type ResultadoPeca = { resultado: 'ok' | 'erro' | 'em_andamento'; ajustes: string[] }

export type ResultadoGerarPecas =
  | { tipo: 'recusado'; motivo: 'nao_encontrado' | 'verificar' | 'situacao'; mensagem: string }
  | { tipo: 'processado'; pecas: Partial<Record<TipoPeca, ResultadoPeca>> }

/** Gera as peças do artigo em paralelo; cada uma tem a própria reivindicação e a própria situação. */
export async function gerarPecas(artigoId: number, opts: OpcoesGerarPecas = {}): Promise<ResultadoGerarPecas> {
  const db = opts.db ?? bancoPadrao()
  const gerar = opts.gerar ?? gerarObjetoPadrao
  const agora = opts.agora ?? (() => new Date())

  const [linha] = await db
    .select({ artigo: artigos, keyword: topics.keyword })
    .from(artigos)
    .innerJoin(topics, eq(topics.id, artigos.topicId))
    .where(eq(artigos.id, artigoId))
  if (!linha) return { tipo: 'recusado', motivo: 'nao_encontrado', mensagem: 'artigo não encontrado' }
  const { artigo, keyword } = linha
  if (!SITUACOES_OK.has(artigo.situacao) || !artigo.conteudoHtml?.trim()) {
    return { tipo: 'recusado', motivo: 'situacao', mensagem: 'o artigo precisa estar pronto, agendado ou publicado' }
  }
  const pendentes = contarVerificar(artigo.conteudoHtml)
  if (pendentes > 0) {
    return {
      tipo: 'recusado',
      motivo: 'verificar',
      mensagem: `há ${pendentes} trecho(s) marcado(s) como "verificar" no artigo; revise antes de gerar as peças`,
    }
  }

  const ctx = {
    titulo: artigo.titulo ?? keyword,
    keyword,
    texto: htmlParaTexto(artigo.conteudoHtml),
    link: artigo.wpLink ?? `${siteUrl()}/${artigo.slug ?? ''}/`,
  }
  const tipos = [...new Set(opts.tipos ?? TIPOS_PECA)]

  const gerarUma = async (tipo: TipoPeca): Promise<ResultadoPeca> => {
    const claim = await reivindicarPeca(artigoId, tipo, agora(), db)
    if (claim.tipo !== 'reivindicada') return { resultado: 'em_andamento', ajustes: [] }
    try {
      const bruto = await gerar({ schema: SCHEMAS_MODELO[tipo] as z.ZodType<unknown>, prompt: montarPromptPeca(tipo, ctx) })
      const { valor, ajustes } = repararPeca(tipo, bruto)
      await concluirPeca(
        claim.pecaId,
        { conteudo: valor, modelo: modeloEmUso(), variacao: tipo === 'carrossel' ? 'escura' : null },
        agora(),
        db,
      )
      return { resultado: 'ok', ajustes }
    } catch (e) {
      console.error(`geração da peça ${tipo} falhou:`, e instanceof Error ? e.name : 'erro')
      try {
        await falharPeca(claim.pecaId, MENSAGEM_FALHA, agora(), db)
      } catch (e2) {
        console.error('não foi possível registrar a falha da peça:', e2 instanceof Error ? e2.name : 'erro')
      }
      return { resultado: 'erro', ajustes: [] }
    }
  }

  const liquidadas = await Promise.allSettled(tipos.map(gerarUma))
  const pecas: Partial<Record<TipoPeca, ResultadoPeca>> = {}
  liquidadas.forEach((r, i) => {
    pecas[tipos[i]] = r.status === 'fulfilled' ? r.value : { resultado: 'erro', ajustes: [] }
  })
  return { tipo: 'processado', pecas }
}
