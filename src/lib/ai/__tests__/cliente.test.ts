import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  ChaveOpenAIAusenteError,
  criarModelo,
  extrairJson,
  gerarJsonPorPrompt,
  gerarObjetoComBuscaEFontes,
  ChaveOpenRouterAusenteError,
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

describe('normalização do nome do modelo no OpenRouter', () => {
  it('gpt-4.1 e o1 viram openai/..., e nomes com fornecedor ficam como estão', () => {
    expect(resolverConfigIA({ OPENROUTER_API_KEY: 'k', OPENAI_MODEL: 'gpt-4.1' })?.modelo).toBe('openai/gpt-4.1')
    expect(resolverConfigIA({ OPENROUTER_API_KEY: 'k', OPENAI_MODEL: 'o3-mini' })?.modelo).toBe('openai/o3-mini')
    expect(resolverConfigIA({ OPENROUTER_API_KEY: 'k', OPENAI_MODEL: 'anthropic/claude-sonnet-4' })?.modelo).toBe('anthropic/claude-sonnet-4')
  })
  it('na OpenAI direta o nome não muda', () => {
    expect(resolverConfigIA({ OPENAI_API_KEY: 'k', OPENAI_MODEL: 'gpt-4.1' })?.modelo).toBe('gpt-4.1')
  })
})

describe('gerarObjetoComBuscaEFontes', () => {
  const schema = z.object({ titulo: z.string() })
  it('usa o modelo de busca e repassa as fontes (url) sem repetição', async () => {
    const gerar = vi.fn(async (_o: { model: { modelId: string } }) => ({
      text: '{"titulo":"x"}',
      sources: [
        { type: 'source', sourceType: 'url', id: '1', url: 'https://stj.jus.br/a' },
        { type: 'source', sourceType: 'url', id: '2', url: 'https://stj.jus.br/a' },
        { type: 'source', sourceType: 'document', id: '3', mediaType: 'x', title: 't' },
        { type: 'source', sourceType: 'url', id: '4', url: 'https://conjur.com.br/b' },
      ],
    }))
    const r = await gerarObjetoComBuscaEFontes(
      { schema, prompt: 'P' },
      { env: { OPENROUTER_API_KEY: 'k', OPENAI_MODEL_BUSCA: 'perplexity/sonar' }, gerar: gerar as never },
    )
    expect(r).toEqual({ valor: { titulo: 'x' }, fontes: ['https://stj.jus.br/a', 'https://conjur.com.br/b'] })
    expect(gerar.mock.calls[0][0].model.modelId).toBe('perplexity/sonar')
  })
  it('só com OPENAI_API_KEY lança erro claro citando OPENROUTER_API_KEY', async () => {
    const gerar = vi.fn()
    const p = gerarObjetoComBuscaEFontes({ schema, prompt: 'P' }, { env: { OPENAI_API_KEY: 'k' }, gerar: gerar as never })
    await expect(p).rejects.toThrow(/OPENROUTER_API_KEY/)
    await expect(p).rejects.toBeInstanceOf(ChaveOpenRouterAusenteError)
    expect(gerar).not.toHaveBeenCalled()
  })
})

describe('gerarJsonPorPrompt: falha na conversão do schema', () => {
  it('cai no caminho de nova tentativa e termina com erro, sem lançar cru', async () => {
    const quebrado = z.object({ a: z.string() }).transform((v) => v)
    const gerarTexto = vi.fn(async () => '{"a":"x"}')
    await expect(gerarJsonPorPrompt({ schema: quebrado, prompt: 'P', gerarTexto })).rejects.toThrow(/nova tentativa/)
    expect(gerarTexto).not.toHaveBeenCalled()
  })
})
