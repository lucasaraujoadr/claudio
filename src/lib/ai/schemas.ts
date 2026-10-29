import { z } from 'zod'

export const intencaoSchema = z.enum(['informacional', 'comercial', 'transacional', 'navegacional'])
export const prioridadeSchema = z.enum(['alta', 'media', 'baixa'])

const temaSchema = z.object({
  titulo: z.string().trim().min(1).max(120),
  keyword: z.string().trim().min(1).max(80),
  intencao: intencaoSchema,
  prioridade: prioridadeSchema,
})

const clusterSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  keywordPilar: z.string().trim().min(1).max(80),
  intencao: intencaoSchema,
  prioridade: prioridadeSchema,
  temas: z.array(temaSchema).min(1).max(12),
})

export const clustersSchema = z.object({
  clusters: z.array(clusterSchema).min(1).max(8),
})

export type ClustersGerados = z.infer<typeof clustersSchema>
