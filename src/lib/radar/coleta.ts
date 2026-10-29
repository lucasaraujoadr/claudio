import { z } from 'zod'
import { gerarObjetoComBuscaEFontes, type ResultadoBusca } from '@/lib/ai/cliente'
import { hashDeFonte, validarFonte, type MotivoFonte } from './fontes'

export const MAX_TENDENCIAS = 10
const DIAS_RECENTES = 7
// Janela de 7 dias com 2 de tolerância (o modelo erra a data por um ou dois dias).
const DIAS_MAX_IDADE = DIAS_RECENTES + 2
/** Itens sem data não provam que são recentes: entram só como contexto, poucos por execução. */
export const MAX_SEM_DATA = 3

// Versão enviada ao modelo de busca: sem minLength/maxLength nas strings (a API estrita rejeita).
// Os limites ficam em tendenciaEstritaSchema, aplicado item a item depois da resposta.
export const tendenciasSchemaModelo = z.object({
  tendencias: z.array(
    z.object({
      titulo: z.string().trim(),
      resumo: z.string().trim(),
      fonteUrl: z.string().trim(),
      publicadoEm: z.string().trim().nullable(),
      palavrasChave: z.array(z.string().trim()),
    }),
  ),
})
export type TendenciasModelo = z.infer<typeof tendenciasSchemaModelo>

export const tendenciaEstritaSchema = z.object({
  titulo: z.string().trim().min(1).max(200),
  resumo: z.string().trim().min(1).max(800),
  fonteUrl: z.string().trim().min(1).max(2000),
  publicadoEm: z.string().nullable(),
  palavrasChave: z.array(z.string().trim().min(1).max(60)).max(8),
})

export type TendenciaValida = {
  titulo: string
  resumo: string
  fonteUrl: string
  publicadoEm: string | null
  palavrasChave: string[]
  hash: string
}

export type MotivoRejeicao = MotivoFonte | 'invalida' | 'antiga' | 'repetida' | 'ja_coletada' | 'excedente' | 'sem_data_excedente'

export type RelatorioColeta = {
  retornadas: number
  aceitas: number
  /** Quantas das aceitas não têm data de publicação (válida) e valem só como contexto. */
  semData: number
  rejeitadas: Partial<Record<MotivoRejeicao, number>>
  /** URLs rejeitadas por não terem sido citadas pelo provedor, para auditoria. */
  urlsRejeitadas: { url: string; motivo: MotivoRejeicao }[]
}

export function montarPromptColeta(hoje: Date): string {
  const desde = new Date(hoje.getTime() - DIAS_RECENTES * 86_400_000).toISOString().slice(0, 10)
  return [
    'Você é analista jurídico-contábil de um escritório de perícia contábil forense que atende advogados em todo o Brasil.',
    `Pesquise na web fatos publicados entre ${desde} e ${hoje.toISOString().slice(0, 10)} (últimos ${DIAS_RECENTES} dias) que importem para cálculos judiciais e perícia contábil:`,
    '- decisões do STF, STJ, TST e dos TRFs e TRTs;',
    '- leis, medidas provisórias, resoluções e súmulas;',
    '- índices e taxas (Selic, IPCA-E, TR, INPC) e sua divulgação oficial;',
    '- teses e temas repetitivos sobre revisional bancária, PASEP, RMC/RCC (cartão consignado), cálculos trabalhistas, liquidação de sentença, correção monetária e juros.',
    `Devolva no máximo ${MAX_TENDENCIAS} itens, os mais relevantes, cada um com: titulo, resumo (2 a 3 frases objetivas, só o que a fonte diz), fonteUrl (a URL da página específica da notícia, decisão ou norma; nunca página de busca, listagem ou página inicial), publicadoEm (AAAA-MM-DD, ou null se a fonte não informar) e palavrasChave (até 5 termos que um advogado pesquisaria).`,
    'Use apenas fatos que você encontrou nas fontes. Não invente decisões, números de processo, leis, datas nem estatísticas. Se não achar nada confiável, devolva a lista vazia.',
    'Responda em português do Brasil.',
  ].join('\n\n')
}

function dataValida(s: string | null, hoje: Date): { data: string | null; antiga: boolean } {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return { data: null, antiga: false }
  const t = Date.parse(`${s}T00:00:00Z`)
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) return { data: null, antiga: false }
  if (t > hoje.getTime() + 86_400_000) return { data: null, antiga: false }
  // Em dias de calendário: 9 dias atrás passa, 10 não, a qualquer hora do dia.
  const hojeDia = Date.parse(`${hoje.toISOString().slice(0, 10)}T00:00:00Z`)
  return { data: s, antiga: hojeDia - t > DIAS_MAX_IDADE * 86_400_000 }
}

/**
 * Filtra a resposta do modelo de busca. `valor` é pista não verificada: só vira tendência o item
 * cuja URL é http(s), não é busca/listagem e foi citada de fato pelo provedor (`fontes`).
 */
export function validarTendencias(
  resultado: ResultadoBusca<TendenciasModelo>,
  hoje: Date,
  max = MAX_TENDENCIAS,
): { validas: TendenciaValida[]; relatorio: RelatorioColeta } {
  const relatorio: RelatorioColeta = { retornadas: resultado.valor.tendencias.length, aceitas: 0, semData: 0, rejeitadas: {}, urlsRejeitadas: [] }
  const rejeitar = (motivo: MotivoRejeicao, url?: string) => {
    relatorio.rejeitadas[motivo] = (relatorio.rejeitadas[motivo] ?? 0) + 1
    if (url) relatorio.urlsRejeitadas.push({ url: url.slice(0, 300), motivo })
  }
  const validas: TendenciaValida[] = []
  const vistos = new Set<string>()
  for (const bruto of resultado.valor.tendencias) {
    const r = tendenciaEstritaSchema.safeParse({ ...bruto, palavrasChave: bruto.palavrasChave.slice(0, 8).filter((k) => k.length > 0 && k.length <= 60) })
    if (!r.success) {
      rejeitar('invalida')
      continue
    }
    const t = r.data
    const fonte = validarFonte(t.fonteUrl, resultado.fontes)
    if (!fonte.ok) {
      rejeitar(fonte.motivo, t.fonteUrl)
      continue
    }
    const hash = hashDeFonte(fonte.chave)
    if (vistos.has(hash)) {
      rejeitar('repetida', t.fonteUrl)
      continue
    }
    const { data, antiga } = dataValida(t.publicadoEm, hoje)
    if (antiga) {
      rejeitar('antiga', t.fonteUrl)
      continue
    }
    if (data === null && relatorio.semData >= MAX_SEM_DATA) {
      rejeitar('sem_data_excedente', t.fonteUrl)
      continue
    }
    vistos.add(hash)
    if (validas.length >= max) {
      rejeitar('excedente')
      continue
    }
    if (data === null) relatorio.semData++
    // Grava a URL citada e normalizada (sem fragmento nem credenciais), não a string crua do modelo.
    validas.push({ titulo: t.titulo, resumo: t.resumo, fonteUrl: fonte.chave, publicadoEm: data, palavrasChave: t.palavrasChave, hash })
  }
  relatorio.aceitas = validas.length
  return { validas, relatorio }
}

export type BuscarComFontes = <T>(opts: { schema: z.ZodType<T>; prompt: string }) => Promise<ResultadoBusca<T>>

/** Uma chamada de busca (o cliente repete só se o JSON vier fora do formato). */
export async function coletarTendencias(hoje: Date, buscar: BuscarComFontes = gerarObjetoComBuscaEFontes) {
  const resultado = await buscar({ schema: tendenciasSchemaModelo, prompt: montarPromptColeta(hoje) })
  return validarTendencias(resultado, hoje)
}
