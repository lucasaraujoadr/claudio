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

// ---------------------------------------------------------------------------
// Briefing de conteúdo
// ---------------------------------------------------------------------------

export const TITLE_MIN = 30
export const TITLE_MAX = 60
export const META_MIN = 70
export const META_MAX = 160

const secaoSchema = z.object({
  h2: z.string().trim().min(1).max(160),
  h3: z.array(z.string().trim().min(1).max(160)).max(8),
})

const perguntaSchema = z.object({
  pergunta: z.string().trim().min(1).max(250),
  resposta: z.string().trim().min(1).max(1200),
})

const linkInternoSchema = z.object({
  ancora: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(500),
})

// Versão estrita, aplicada depois da resposta do modelo.
export const briefingSchema = z.object({
  title: z.string().trim().min(TITLE_MIN).max(TITLE_MAX),
  metaDescription: z.string().trim().min(META_MIN).max(META_MAX),
  outline: z.array(secaoSchema).min(1).max(15),
  faq: z.array(perguntaSchema).min(4).max(6),
  linksInternos: z.array(linkInternoSchema).max(10),
  keywordsSecundarias: z.array(z.string().trim().min(1).max(80)).max(15),
})

export type BriefingGerado = z.infer<typeof briefingSchema>

// Versão enviada ao modelo: sem minLength/maxLength (a API estrita da OpenAI pode rejeitar com 400).
// Os limites de texto ficam em briefingSchema; aqui só forma, campos obrigatórios e limites de array.
export const briefingSchemaModelo = z.object({
  title: z.string().trim(),
  metaDescription: z.string().trim(),
  outline: z
    .array(z.object({ h2: z.string().trim(), h3: z.array(z.string().trim()).max(8) }))
    .min(1)
    .max(15),
  faq: z
    .array(z.object({ pergunta: z.string().trim(), resposta: z.string().trim() }))
    .min(4)
    .max(6),
  linksInternos: z.array(z.object({ ancora: z.string().trim(), url: z.string().trim() })).max(10),
  keywordsSecundarias: z.array(z.string().trim()).max(15),
})

export type BriefingModelo = z.infer<typeof briefingSchemaModelo>
