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

// Versão enviada ao modelo: a API estrita da OpenAI pode rejeitar minLength/maxLength,
// então os limites de texto ficam só em clustersSchema, aplicado depois da resposta.
const temaModelo = z.object({
  titulo: z.string().trim(),
  keyword: z.string().trim(),
  intencao: intencaoSchema,
  prioridade: prioridadeSchema,
})

export const clustersSchemaModelo = z.object({
  clusters: z
    .array(
      z.object({
        nome: z.string().trim(),
        keywordPilar: z.string().trim(),
        intencao: intencaoSchema,
        prioridade: prioridadeSchema,
        temas: z.array(temaModelo).min(1).max(12),
      }),
    )
    .min(1)
    .max(8),
})

export type ClustersModelo = z.infer<typeof clustersSchemaModelo>

export const temaEstritoSchema = temaSchema
export const clusterEstritoSchema = clusterSchema
