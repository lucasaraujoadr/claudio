import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  ChaveOpenAIAusenteError,
  criarModelo,
  extrairJson,
  gerarJsonPorPrompt,
  iaConfigurada,
  resolverConfigIA,
} from '../cliente'

describe('resolverConfigIA', () => {
  it('prefere o OpenRouter quando OPENROUTER_API_KEY existe', () => {
    const c = resolverConfigIA({ OPENROUTER_API_KEY: 'or-x', OPENAI_API_KEY: 'sk-y' })
    expect(c).toMatchObject({
      provedor: 'openrouter',
      apiKey: 'or-x',
      baseURL: 'https://openrouter.ai/api/v1',
      modelo: 'openai/gpt-4.1',
      modeloBusca: 'perplexity/sonar-pro',
      headers: { 'HTTP-Referer': 'https://ogpericiacontabil.com.br', 'X-Title': 'Painel SEO OG' },
    })
  })
  it('respeita OPENAI_MODEL e OPENAI_MODEL_BUSCA', () => {
    const c = resolverConfigIA({ OPENROUTER_API_KEY: 'k', OPENAI_MODEL: 'openai/gpt-4.1-mini', OPENAI_MODEL_BUSCA: 'perplexity/sonar' })
    expect(c?.modelo).toBe('openai/gpt-4.1-mini')
    expect(c?.modeloBusca).toBe('perplexity/sonar')
  })
  it('cai para a OpenAI direta com OPENAI_API_KEY', () => {
    const c = resolverConfigIA({ OPENAI_API_KEY: 'sk-y' })
    expect(c).toMatchObject({ provedor: 'openai', apiKey: 'sk-y', baseURL: 'https://api.openai.com/v1', modelo: 'gpt-4.1' })
    expect(c?.headers).toBeUndefined()
  })
  it('sem nenhuma chave devolve null', () => {
    expect(resolverConfigIA({})).toBeNull()
    expect(resolverConfigIA({ OPENROUTER_API_KEY: '', OPENAI_API_KEY: '' })).toBeNull()
  })
})

describe('iaConfigurada', () => {
  it('reflete a presença de alguma chave no ambiente', () => {
    const antes = { o: process.env.OPENROUTER_API_KEY, a: process.env.OPENAI_API_KEY }
    try {
      delete process.env.OPENROUTER_API_KEY
      delete process.env.OPENAI_API_KEY
      expect(iaConfigurada()).toBe(false)
      process.env.OPENROUTER_API_KEY = 'k'
      expect(iaConfigurada()).toBe(true)
    } finally {
      if (antes.o === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = antes.o
      if (antes.a === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = antes.a
    }
  })
  it('ChaveOpenAIAusenteError continua exportada', () => {
    expect(new ChaveOpenAIAusenteError().name).toBe('ChaveOpenAIAusenteError')
  })
})

describe('criarModelo', () => {
  it('usa chat completions (.chat), com base URL, chave e cabeçalhos do OpenRouter', () => {
    const chat = vi.fn(() => 'modelo-chat')
    const padrao = vi.fn(() => 'modelo-responses')
    const fabrica = vi.fn(() => Object.assign(padrao, { chat }))
    const config = resolverConfigIA({ OPENROUTER_API_KEY: 'or-x' })!
    const m = criarModelo(config, 'openai/gpt-4.1', fabrica as never)
    expect(m).toBe('modelo-chat')
    expect(padrao).not.toHaveBeenCalled()
    expect(chat).toHaveBeenCalledWith('openai/gpt-4.1')
    expect(fabrica).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'or-x',
        baseURL: 'https://openrouter.ai/api/v1',
        headers: { 'HTTP-Referer': 'https://ogpericiacontabil.com.br', 'X-Title': 'Painel SEO OG' },
      }),
    )
  })
})

describe('extrairJson', () => {
  it('lê JSON puro, cercado por markdown ou com texto em volta', () => {
    expect(extrairJson('{"a":1}')).toEqual({ a: 1 })
    expect(extrairJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extrairJson('Segue:\n{"a":{"b":"}"}} fim')).toEqual({ a: { b: '}' } })
  })
  it('lança quando não há JSON', () => {
    expect(() => extrairJson('sem json')).toThrow()
  })
})

describe('gerarJsonPorPrompt', () => {
  const schema = z.object({ decisao: z.string(), fonte: z.string() })
  it('valida com o schema e devolve o objeto', async () => {
    const gerarTexto = vi.fn(async (_p: string) => '```json\n{"decisao":"x","fonte":"https://stj.jus.br/y"}\n```')
    expect(await gerarJsonPorPrompt({ schema, prompt: 'P', gerarTexto })).toEqual({ decisao: 'x', fonte: 'https://stj.jus.br/y' })
    expect(gerarTexto.mock.calls[0][0]).toContain('P')
    expect(gerarTexto.mock.calls[0][0]).toContain('"decisao"')
  })
  it('tenta uma segunda vez, com o erro no prompt, quando a primeira falha', async () => {
    const gerarTexto = vi
      .fn<(p: string) => Promise<string>>()
      .mockResolvedValueOnce('{"decisao":1}')
      .mockResolvedValueOnce('{"decisao":"x","fonte":"u"}')
    expect(await gerarJsonPorPrompt({ schema, prompt: 'P', gerarTexto })).toEqual({ decisao: 'x', fonte: 'u' })
    expect(gerarTexto).toHaveBeenCalledTimes(2)
    expect(gerarTexto.mock.calls[1][0]).toContain('não atendeu')
  })
  it('desiste após uma nova tentativa', async () => {
    const gerarTexto = vi.fn(async () => 'nada')
    await expect(gerarJsonPorPrompt({ schema, prompt: 'P', gerarTexto })).rejects.toThrow()
    expect(gerarTexto).toHaveBeenCalledTimes(2)
  })
})
