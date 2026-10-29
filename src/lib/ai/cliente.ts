import { generateText, Output } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { z } from 'zod'

export type GerarObjeto = <T>(opts: { schema: z.ZodType<T>; prompt: string }) => Promise<T>

export const MODELO_PADRAO = 'gpt-4.1'

export class ChaveOpenAIAusenteError extends Error {
  constructor() {
    super('OPENAI_API_KEY não configurada')
    this.name = 'ChaveOpenAIAusenteError'
  }
}

export function openaiConfigurada(): boolean {
  return Boolean(process.env.OPENAI_API_KEY)
}

// AI SDK v7: generateObject está obsoleto; saída estruturada vem de generateText + Output.object.
export const gerarObjetoPadrao: GerarObjeto = async ({ schema, prompt }) => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new ChaveOpenAIAusenteError()
  const openai = createOpenAI({ apiKey })
  const { output } = await generateText({
    model: openai(process.env.OPENAI_MODEL || MODELO_PADRAO),
    output: Output.object({ schema }),
    prompt,
    abortSignal: AbortSignal.timeout(100_000),
  })
  return output
}
