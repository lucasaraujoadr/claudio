import { z } from 'zod'
import { gerarObjetoPadrao, type GerarObjeto } from '@/lib/ai/cliente'
import { SERVICOS } from '@/lib/ai/temas'
import { intencaoSchema } from '@/lib/ai/schemas'
import { normalizarKeyword } from '@/lib/keyword'
import type { TermoEmAlta } from './termos-em-alta'

export const MAX_TESES = 8
const MAX_EXISTENTES_NO_PROMPT = 300

export const potencialSchema = z.enum(['alto', 'medio', 'baixo'])

// Versão enviada ao modelo: sem minLength/maxLength (strict rejeita). Limites em teseEstritaSchema.
export const tesesSchemaModelo = z.object({
  teses: z
    .array(
      z.object({
        titulo: z.string().trim(),
        keyword: z.string().trim(),
        intencao: intencaoSchema,
        justificativa: z.string().trim(),
        potencial: potencialSchema,
        tendenciaId: z.number().int().nullable(),
        termosEmAlta: z.array(z.string().trim()),
      }),
    )
    .max(MAX_TESES),
})
export type TesesModelo = z.infer<typeof tesesSchemaModelo>

export const teseEstritaSchema = z.object({
  titulo: z.string().trim().min(1).max(160),
  keyword: z.string().trim().min(1).max(80),
  intencao: intencaoSchema,
  justificativa: z.string().trim().min(20).max(900),
  potencial: potencialSchema,
  tendenciaId: z.number().int().nullable(),
  termosEmAlta: z.array(z.string().trim().min(1).max(200)).max(10),
})

export type TendenciaParaPrompt = { id: number; titulo: string; resumo: string; publicadoEm: string | null; palavrasChave: string[] }

export type ContextoTeses = {
  tendencias: TendenciaParaPrompt[]
  termosEmAlta: TermoEmAlta[]
  /** Keywords de temas e de teses já existentes (qualquer status), as mais recentes por último. */
  existentes: string[]
}

export type TeseValida = {
  titulo: string
  keyword: string
  keywordNormalizada: string
  intencao: z.infer<typeof intencaoSchema>
  justificativa: string
  potencial: z.infer<typeof potencialSchema>
  tendenciaId: number | null
  sinais: string[]
}

function limpar(s: string, n = 200): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, n)
}
const lista = (itens: string[]) => itens.map((i) => `- ${i}`).join('\n')

export function montarPromptTeses(ctx: ContextoTeses): string {
  const trends = ctx.tendencias.map(
    (t) => `[${t.id}] ${limpar(t.titulo)}${t.publicadoEm ? ` (${t.publicadoEm})` : ''}: ${limpar(t.resumo, 300)}`,
  )
  const termos = ctx.termosEmAlta.map((t) => `${limpar(t.query)}: de ${t.anterior} para ${t.atual} impressões (+${t.aumento})`)
  const existentes = ctx.existentes.slice(-MAX_EXISTENTES_NO_PROMPT).reverse().map((k) => limpar(k, 120))
  return [
    'Você é estrategista de conteúdo SEO de um escritório de perícia contábil forense (ogpericiacontabil.com.br).',
    'Público: advogados em todo o Brasil que decidem se devem contratar um perito contábil (atendimento 100% remoto).',
    `Serviços do escritório:\n${lista(SERVICOS)}`,
    trends.length > 0 ? `Fatos recentes (id entre colchetes):\n${lista(trends)}` : 'Não há fatos recentes coletados.',
    termos.length > 0
      ? `Termos em alta no Search Console (impressões dos últimos 28 dias contra os 28 anteriores):\n${lista(termos)}`
      : 'Não há dados do Search Console ainda. Não invente termos de busca nem métricas.',
    existentes.length > 0 ? `Keywords que já existem como tema ou tese (não repita nem proponha variações triviais):\n${lista(existentes)}` : 'Ainda não há temas cadastrados.',
    `Proponha até ${MAX_TESES} teses/artigos que um advogado buscaria e que mostrem por que contratar um perito contábil. Cada tese deve ser motivada por pelo menos um fato recente (informe seu id em tendenciaId) ou um termo em alta (copie o termo exato em termosEmAlta); sem um deles, não proponha a tese.`,
    'A keyword deve ser um termo perene que um advogado digitaria no Google (sem mês nem ano do fato). Varie os ângulos: não faça mais de duas teses sobre o mesmo fato.',
    'Para cada uma: titulo (até 160 caracteres), keyword (até 80 caracteres), intencao de busca, justificativa (diga qual fato ou termo motiva a tese e por que interessa a um advogado) e potencial (alto, medio ou baixo).',
    'O potencial é uma ESTIMATIVA QUALITATIVA: explique na justificativa o porquê (atualidade do fato, aderência aos serviços, concorrência provável). Não invente volumes de busca, estatísticas, números de processo, leis nem datas; use apenas o que está nos fatos acima.',
    'Responda em português do Brasil.',
  ].join('\n\n')
}

/** Valida item a item, confere as referências ao contexto e deduplica por keyword_normalizada. */
export function validarTeses(bruto: TesesModelo, ctx: ContextoTeses): { validas: TeseValida[]; rejeitadas: number } {
  const vistos = new Set(ctx.existentes.map(normalizarKeyword))
  const porId = new Map(ctx.tendencias.map((t) => [t.id, t]))
  const termosPorChave = new Map(ctx.termosEmAlta.map((t) => [normalizarKeyword(t.query), t.query]))
  const validas: TeseValida[] = []
  let rejeitadas = 0
  for (const b of bruto.teses) {
    const r = teseEstritaSchema.safeParse(b)
    if (!r.success) {
      rejeitadas++
      continue
    }
    const t = r.data
    // Só vale a referência que existe no contexto enviado.
    const tendencia = t.tendenciaId !== null ? porId.get(t.tendenciaId) : undefined
    const termos = [...new Set(t.termosEmAlta.map((x) => termosPorChave.get(normalizarKeyword(x))).filter((x): x is string => Boolean(x)))]
    const sinais = [...(tendencia ? [`Fato recente: ${tendencia.titulo}`] : []), ...termos.map((x) => `Termo em alta: ${x}`)]
    const chave = normalizarKeyword(t.keyword)
    if (sinais.length === 0 || !chave || vistos.has(chave)) {
      rejeitadas++
      continue
    }
    vistos.add(chave)
    validas.push({
      titulo: t.titulo,
      keyword: t.keyword,
      keywordNormalizada: chave,
      intencao: t.intencao,
      justificativa: t.justificativa,
      potencial: t.potencial,
      tendenciaId: tendencia ? tendencia.id : null,
      sinais,
    })
    if (validas.length >= MAX_TESES) break
  }
  return { validas, rejeitadas }
}

/** Sem fato recente nem termo em alta não há o que justificar: nenhuma chamada é gasta. */
export async function gerarTeses(ctx: ContextoTeses, gerar: GerarObjeto = gerarObjetoPadrao) {
  if (ctx.tendencias.length === 0 && ctx.termosEmAlta.length === 0) return { validas: [], rejeitadas: 0, chamou: false }
  const bruto = await gerar({ schema: tesesSchemaModelo, prompt: montarPromptTeses(ctx) })
  return { ...validarTeses(bruto, ctx), chamou: true }
}
