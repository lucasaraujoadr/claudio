import { describe, expect, it } from 'vitest'
import { configResend, criarClienteResend, ErroResend } from '@/lib/resend'

type Chamada = { url: string; metodo: string; headers: Record<string, string>; corpo: unknown }
type Resp = { status: number; json?: unknown; headers?: Record<string, string> } | Error

function fetchFalso(respostas: Resp[]) {
  const chamadas: Chamada[] = []
  let i = 0
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({
      url: String(url),
      metodo: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      corpo: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    })
    const r = respostas[Math.min(i++, respostas.length - 1)]
    if (r instanceof Error) throw r
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status, headers: r.headers })
  }) as typeof fetch
  return { f, chamadas }
}

const cfg = { chave: 're_CHAVE_SECRETA_123', remetente: 'Dupim <contato@dupim.com.br>', responderPara: 'resp@dupim.com.br' }

describe('configResend', () => {
  it('null sem chave ou sem remetente', () => {
    expect(configResend({ RESEND_REMETENTE: 'a@b.com' } as never)).toBeNull()
    expect(configResend({ RESEND_API_KEY: 're_x' } as never)).toBeNull()
    expect(configResend({ RESEND_API_KEY: ' re_x ', RESEND_REMETENTE: 'a@b.com' } as never)).toEqual({
      chave: 're_x',
      remetente: 'a@b.com',
      responderPara: null,
    })
    expect(configResend({ RESEND_API_KEY: 're_x', RESEND_REMETENTE: 'a@b.com', RESEND_RESPONDER_PARA: 'r@b.com' } as never)?.responderPara).toBe('r@b.com')
  })
})

describe('enviarEmail', () => {
  it('manda Bearer, Idempotency-Key, from, reply_to, headers', async () => {
    const { f, chamadas } = fetchFalso([{ status: 200, json: { id: 'em-1' } }])
    const r = await criarClienteResend(cfg, f).enviarEmail({
      para: 'a@b.com',
      assunto: 'Oi',
      html: '<p>oi</p>',
      texto: 'oi',
      cabecalhos: { 'List-Unsubscribe': '<https://x/d>' },
      chaveIdempotencia: 'chave-1',
      tags: [{ name: 'tipo', value: 'boas_vindas' }],
    })
    expect(r).toEqual({ id: 'em-1' })
    const c = chamadas[0]
    expect(c.url).toBe('https://api.resend.com/emails')
    expect(c.metodo).toBe('POST')
    expect(c.headers.Authorization).toBe('Bearer re_CHAVE_SECRETA_123')
    expect(c.headers['Idempotency-Key']).toBe('chave-1')
    expect(c.corpo).toEqual({
      from: cfg.remetente,
      to: ['a@b.com'],
      subject: 'Oi',
      html: '<p>oi</p>',
      text: 'oi',
      reply_to: 'resp@dupim.com.br',
      headers: { 'List-Unsubscribe': '<https://x/d>' },
      tags: [{ name: 'tipo', value: 'boas_vindas' }],
    })
  })

  it('sem responderPara não manda reply_to', async () => {
    const { f, chamadas } = fetchFalso([{ status: 200, json: { id: 'x' } }])
    await criarClienteResend({ ...cfg, responderPara: null }, f).enviarEmail({
      para: 'a@b.com', assunto: 's', html: 'h', texto: 't', chaveIdempotencia: 'k',
    })
    expect(chamadas[0].corpo).not.toHaveProperty('reply_to')
  })
})

describe('erros', () => {
  it('401 → credencial e a mensagem não contém a chave', async () => {
    const { f } = fetchFalso([{ status: 401, json: { message: 'API key re_CHAVE_SECRETA_123 invalid' } }])
    const e = await criarClienteResend(cfg, f)
      .garantirSegmento('x')
      .catch((x) => x)
    expect(e).toBeInstanceOf(ErroResend)
    expect(e.tipo).toBe('credencial')
    expect(e.message).toBe('chave do Resend inválida ou sem permissão')
    expect(e.message).not.toContain('re_CHAVE')
  })

  it('429 com retry-after repete uma vez e depois lança limite', async () => {
    const { f, chamadas } = fetchFalso([{ status: 429, headers: { 'retry-after': '0' } }])
    const e = await criarClienteResend(cfg, f)
      .lerBroadcast('b1')
      .catch((x) => x)
    expect(e.tipo).toBe('limite')
    expect(chamadas).toHaveLength(2)
  })

  it('429 e depois sucesso devolve o resultado', async () => {
    const { f, chamadas } = fetchFalso([
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200, json: { id: 'b1', status: 'sent' } },
    ])
    expect(await criarClienteResend(cfg, f).lerBroadcast('b1')).toEqual({ id: 'b1', status: 'sent' })
    expect(chamadas).toHaveLength(2)
  })

  it('404, 422, 400 e 5xx mapeiam os tipos', async () => {
    const tipo = async (status: number) =>
      (await criarClienteResend(cfg, fetchFalso([{ status }]).f).lerBroadcast('b').catch((x) => x)).tipo
    expect(await tipo(404)).toBe('nao_encontrado')
    expect(await tipo(422)).toBe('invalido')
    expect(await tipo(400)).toBe('invalido')
    expect(await tipo(503)).toBe('servidor')
  })

  it('exceção de fetch → rede', async () => {
    const { f } = fetchFalso([new TypeError('fetch failed re_CHAVE_SECRETA_123')])
    const e = await criarClienteResend(cfg, f).lerBroadcast('b').catch((x) => x)
    expect(e.tipo).toBe('rede')
    expect(e.message).not.toContain('re_CHAVE')
  })
})

describe('contatos', () => {
  const contato = { email: 'a@b.com', nome: 'Ana Silva', escritorio: 'Silva Adv', descadastrado: false }

  it('salvarContato cria quando não existe', async () => {
    const { f, chamadas } = fetchFalso([{ status: 404 }, { status: 201, json: { object: 'contact', id: 'c1' } }])
    expect(await criarClienteResend(cfg, f).salvarContato(contato)).toEqual({ id: 'c1' })
    expect(chamadas[0].metodo).toBe('PATCH')
    expect(chamadas[0].url).toBe('https://api.resend.com/contacts/a%40b.com')
    expect(chamadas[1].metodo).toBe('POST')
    expect(chamadas[1].url).toBe('https://api.resend.com/contacts')
    expect(chamadas[1].corpo).toEqual({
      email: 'a@b.com',
      first_name: 'Ana Silva',
      unsubscribed: false,
      properties: { escritorio: 'Silva Adv' },
    })
  })

  it('salvarContato em contato existente atualiza', async () => {
    const { f, chamadas } = fetchFalso([{ status: 200, json: { object: 'contact', id: 'c9' } }])
    expect(await criarClienteResend(cfg, f).salvarContato({ ...contato, descadastrado: true })).toEqual({ id: 'c9' })
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0].metodo).toBe('PATCH')
    expect(chamadas[0].corpo).toMatchObject({ unsubscribed: true, first_name: 'Ana Silva' })
  })
})

describe('segmentos', () => {
  it('garantirSegmento reaproveita segmento de mesmo nome', async () => {
    const { f, chamadas } = fetchFalso([
      { status: 200, json: { object: 'list', has_more: false, data: [{ id: 's1', name: 'Newsletter' }] } },
    ])
    expect(await criarClienteResend(cfg, f).garantirSegmento('Newsletter')).toEqual({ id: 's1' })
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0].url).toContain('https://api.resend.com/segments')
  })

  it('garantirSegmento cria quando não existe, paginando', async () => {
    const { f, chamadas } = fetchFalso([
      { status: 200, json: { has_more: true, data: [{ id: 's1', name: 'Outro' }] } },
      { status: 200, json: { has_more: false, data: [] } },
      { status: 201, json: { object: 'segment', id: 's2', name: 'Novo' } },
    ])
    expect(await criarClienteResend(cfg, f).garantirSegmento('Novo')).toEqual({ id: 's2' })
    expect(chamadas[1].url).toContain('after=s1')
    expect(chamadas[2].metodo).toBe('POST')
    expect(chamadas[2].corpo).toEqual({ name: 'Novo' })
  })

  it('adicionar e remover usam POST/DELETE em /contacts/{email}/segments/{id}', async () => {
    const { f, chamadas } = fetchFalso([{ status: 200, json: { id: 's1' } }])
    const c = criarClienteResend(cfg, f)
    await c.adicionarAoSegmento('a@b.com', 's1')
    await c.removerDoSegmento('a@b.com', 's1')
    expect(chamadas.map((x) => [x.metodo, x.url])).toEqual([
      ['POST', 'https://api.resend.com/contacts/a%40b.com/segments/s1'],
      ['DELETE', 'https://api.resend.com/contacts/a%40b.com/segments/s1'],
    ])
  })
})

describe('broadcasts', () => {
  it('criarBroadcast inclui segment e html', async () => {
    const { f, chamadas } = fetchFalso([{ status: 201, json: { object: 'broadcast', id: 'b1' } }])
    const r = await criarClienteResend(cfg, f).criarBroadcast({
      segmentoId: 's1', nome: 'Newsletter 10', assunto: 'Assunto', preCabecalho: 'Prévia', html: '<p>x</p>', texto: 'x',
    })
    expect(r).toEqual({ id: 'b1' })
    expect(chamadas[0].url).toBe('https://api.resend.com/broadcasts')
    expect(chamadas[0].corpo).toEqual({
      segment_id: 's1',
      name: 'Newsletter 10',
      from: cfg.remetente,
      reply_to: 'resp@dupim.com.br',
      subject: 'Assunto',
      preview_text: 'Prévia',
      html: '<p>x</p>',
      text: 'x',
    })
  })

  it('enviarBroadcast com e sem agendamento', async () => {
    const { f, chamadas } = fetchFalso([{ status: 200, json: { id: 'b1' } }])
    const c = criarClienteResend(cfg, f)
    await c.enviarBroadcast('b1')
    await c.enviarBroadcast('b1', new Date('2026-11-01T12:00:00.000Z'))
    expect(chamadas[0].url).toBe('https://api.resend.com/broadcasts/b1/send')
    expect(chamadas[0].corpo).toEqual({})
    expect(chamadas[1].corpo).toEqual({ scheduled_at: '2026-11-01T12:00:00.000Z' })
  })
})
