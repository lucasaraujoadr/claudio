import { generateText, Output } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'

export type GerarObjeto = <T>(opts: { schema: z.ZodType<T>; prompt: string }) => Promise<T>

// Nomes na forma da OpenAI direta; no OpenRouter o padrão vira "openai/gpt-4.1".
export const MODELO_PADRAO = 'gpt-4.1'
export const MODELO_PADRAO_OPENROUTER = 'openai/gpt-4.1'
export const MODELO_BUSCA_PADRAO = 'perplexity/sonar-pro'

const URL_OPENROUTER = 'https://openrouter.ai/api/v1'
const URL_OPENAI = 'https://api.openai.com/v1'
const TIMEOUT_MS = 100_000

export class ChaveOpenAIAusenteError extends Error {
  constructor() {
    super('Nenhuma chave de IA configurada (OPENROUTER_API_KEY ou OPENAI_API_KEY)')
    this.name = 'ChaveOpenAIAusenteError'
  }
}

export type ConfigIA = {
  provedor: 'openrouter' | 'openai'
  apiKey: string
  baseURL: string
  headers?: Record<string, string>
  modelo: string
  modeloBusca: string
}

type Env = Record<string, string | undefined>

/** OPENROUTER_API_KEY tem preferência; OPENAI_API_KEY usa o endpoint direto da OpenAI. */
export function resolverConfigIA(env: Env = process.env): ConfigIA | null {
  const modeloBusca = env.OPENAI_MODEL_BUSCA || MODELO_BUSCA_PADRAO
  if (env.OPENROUTER_API_KEY) {
    return {
      provedor: 'openrouter',
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: URL_OPENROUTER,
      headers: { 'HTTP-Referer': 'https://ogpericiacontabil.com.br', 'X-Title': 'Painel SEO OG' },
      modelo: env.OPENAI_MODEL || MODELO_PADRAO_OPENROUTER,
      modeloBusca,
    }
  }
  if (env.OPENAI_API_KEY) {
    return {
      provedor: 'openai',
      apiKey: env.OPENAI_API_KEY,
      baseURL: URL_OPENAI,
      modelo: env.OPENAI_MODEL || MODELO_PADRAO,
      modeloBusca,
    }
  }
  return null
}

export function iaConfigurada(): boolean {
  return resolverConfigIA() !== null
}

/** Compatibilidade com as rotas, que já usam este nome. */
export const openaiConfigurada = iaConfigurada

/** Modelo gravado no briefing (o mesmo que as chamadas usam). */
export function modeloEmUso(): string {
  return resolverConfigIA()?.modelo ?? MODELO_PADRAO
}

type Fabrica = typeof createOpenAI

/**
 * `.chat()` (Chat Completions), não `openai(modelo)`: este vai para /responses, que o OpenRouter
 * não oferece como API principal. O json_schema estrito do SDK é mantido (strictJsonSchema=true).
 */
export function criarModelo(config: ConfigIA, modelId: string, fabrica: Fabrica = createOpenAI) {
  const provider = fabrica({
    name: config.provedor,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    headers: config.headers,
  })
  return provider.chat(modelId)
}

function exigirConfig(): ConfigIA {
  const config = resolverConfigIA()
  if (!config) throw new ChaveOpenAIAusenteError()
  return config
}

// AI SDK v7: generateObject está obsoleto; saída estruturada vem de generateText + Output.object.
export const gerarObjetoPadrao: GerarObjeto = async ({ schema, prompt }) => {
  const config = exigirConfig()
  const { output } = await generateText({
    model: criarModelo(config, config.modelo),
    output: Output.object({ schema }),
    prompt,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  })
  return output
}

/** Extrai o primeiro objeto/array JSON de um texto (aceita cercas de markdown e texto em volta). */
export function extrairJson(texto: string): unknown {
  const inicio = texto.search(/[{[]/)
  if (inicio < 0) throw new Error('A resposta não contém JSON')
  const abre = texto[inicio]
  const fecha = abre === '{' ? '}' : ']'
  let profundidade = 0
  let emString = false
  let escape = false
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i]
    if (emString) {
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === '"') emString = false
      continue
    }
    if (c === '"') emString = true
    else if (c === abre) profundidade++
    else if (c === fecha && --profundidade === 0) return JSON.parse(texto.slice(inicio, i + 1))
  }
  throw new Error('JSON incompleto na resposta')
}

/**
 * Modelos de busca (Perplexity) não são confiáveis com json_schema estrito: pede-se JSON no prompt,
 * valida-se com o Zod e tenta-se mais uma vez, citando o erro, se a validação falhar.
 */
export async function gerarJsonPorPrompt<T>(opts: {
  schema: z.ZodType<T>
  prompt: string
  gerarTexto: (prompt: string) => Promise<string>
}): Promise<T> {
  const molde = JSON.stringify(z.toJSONSchema(opts.schema))
  const base = [
    opts.prompt,
    `Responda SOMENTE com um objeto JSON válido, sem texto fora dele, que siga este JSON Schema: ${molde}`,
  ].join('\n\n')

  const tentar = async (prompt: string): Promise<{ ok: true; valor: T } | { ok: false; motivo: string }> => {
    try {
      const r = opts.schema.safeParse(extrairJson(await opts.gerarTexto(prompt)))
      return r.success ? { ok: true, valor: r.data } : { ok: false, motivo: z.prettifyError(r.error) }
    } catch (erro) {
      return { ok: false, motivo: erro instanceof Error ? erro.message : String(erro) }
    }
  }

  const primeira = await tentar(base)
  if (primeira.ok) return primeira.valor
  const segunda = await tentar(
    `${base}\n\nATENÇÃO: a resposta anterior não atendeu ao formato exigido (${primeira.motivo}). Corrija e responda de novo apenas com o JSON.`,
  )
  if (segunda.ok) return segunda.valor
  throw new Error(`A resposta do modelo de busca não atendeu ao formato após uma nova tentativa: ${segunda.motivo}`)
}

export const gerarObjetoComBusca: GerarObjeto = async ({ schema, prompt }) => {
  const config = exigirConfig()
  return gerarJsonPorPrompt({
    schema,
    prompt,
    gerarTexto: async (p) => {
      const { text } = await generateText({
        model: criarModelo(config, config.modeloBusca),
        prompt: p,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      })
      return text
    },
  })
}
