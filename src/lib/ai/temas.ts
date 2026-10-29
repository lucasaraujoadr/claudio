import { gerarObjetoPadrao, type GerarObjeto } from './cliente'
import { clusterEstritoSchema, clustersSchemaModelo, temaEstritoSchema, type ClustersGerados } from './schemas'

export const SERVICOS = [
  'Perícia Contábil Judicial',
  'Assistência Técnica Contábil',
  'Liquidação de Sentença',
  'Parecer Técnico Contábil',
  'Cálculos Judiciais',
  'Impugnação de Cálculos',
  'Cálculos Trabalhistas',
  'Cálculos Bancários',
  'Cálculos Cíveis',
  'Cálculos Federais',
]

export type ContextoTemas = {
  servicos: string[]
  termosGsc: string[]
  temasExistentes: string[]
  lacunasAuditoria: string[]
}

const MAX_EXISTENTES_NO_PROMPT = 300

function limpar(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 200)
}

function lista(itens: string[]): string {
  return itens.map((i) => `- ${limpar(i)}`).join('\n')
}

export function montarPrompt(ctx: ContextoTemas): string {
  // temasExistentes cresce sem parar: no prompt entram só os mais recentes (o fim da lista, por id).
  const recentes = ctx.temasExistentes.slice(-MAX_EXISTENTES_NO_PROMPT).reverse()
  const gsc =
    ctx.termosGsc.length > 0
      ? `Termos que já geram impressões no Search Console (por impressões, do maior para o menor):\n${lista(ctx.termosGsc)}`
      : 'Ainda não há dados do Search Console. Não invente termos de busca nem métricas; proponha temas apenas a partir dos serviços e do público.'
  const existentes =
    recentes.length > 0
      ? `Temas que já existem (não repita nem proponha variações triviais):\n${lista(recentes)}`
      : 'Ainda não há temas cadastrados.'
  const lacunas =
    ctx.lacunasAuditoria.length > 0
      ? `Páginas do site com problemas na última auditoria (conteúdo raso ou schema ausente). Se fizer sentido, sugira temas que as reforcem:\n${lista(ctx.lacunasAuditoria)}`
      : 'A última auditoria não apontou páginas com conteúdo raso ou schema ausente.'

  return [
    'Você é estrategista de conteúdo SEO de um escritório de perícia contábil forense (ogpericiacontabil.com.br).',
    'Público: advogados em todo o Brasil (B2B), com atendimento 100% remoto.',
    'Nicho: perícia e contabilidade forense aplicada a processos judiciais.',
    'Os temas precisam ser realmente úteis para um advogado que decide se deve contratar um perito contábil. Evite conteúdo genérico de contabilidade.',
    `Serviços do escritório:\n${lista(ctx.servicos)}`,
    gsc,
    existentes,
    lacunas,
    'Proponha de 3 a 5 clusters de conteúdo. Cada cluster tem uma keyword pilar e de 3 a 8 temas satélites.',
    'Para cada tema informe título (até 120 caracteres), keyword (até 80 caracteres), intenção de busca e prioridade.',
    'Não invente volumes de busca, estatísticas, números de processos nem dados de concorrentes.',
    'Responda em português do Brasil.',
  ].join('\n\n')
}

export async function pesquisarTemas(
  ctx: ContextoTemas,
  gerar: GerarObjeto = gerarObjetoPadrao,
): Promise<ClustersGerados> {
  const bruto = await gerar({ schema: clustersSchemaModelo, prompt: montarPrompt(ctx) })
  // Descarta tema a tema o que viola os limites estritos, em vez de perder a chamada inteira.
  const clusters: ClustersGerados['clusters'] = []
  for (const c of bruto.clusters) {
    const temas = c.temas.flatMap((t) => {
      const r = temaEstritoSchema.safeParse(t)
      return r.success ? [r.data] : []
    })
    const r = clusterEstritoSchema.safeParse({ ...c, temas: temas.length > 0 ? temas : [] })
    if (r.success) clusters.push(r.data)
  }
  if (clusters.length === 0) throw new Error('A resposta do modelo não trouxe nenhum tema válido')
  return { clusters }
}

export function normalizarKeyword(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').toLowerCase().trim()
}

export function dedupTemas(gerados: ClustersGerados, existentes: string[]): ClustersGerados {
  const vistos = new Set(existentes.map(normalizarKeyword))
  const clusters = gerados.clusters
    .map((cluster) => ({
      ...cluster,
      temas: cluster.temas.filter((tema) => {
        const chave = normalizarKeyword(tema.keyword)
        if (vistos.has(chave)) return false
        vistos.add(chave)
        return true
      }),
    }))
    .filter((cluster) => cluster.temas.length > 0)
  return { clusters }
}
