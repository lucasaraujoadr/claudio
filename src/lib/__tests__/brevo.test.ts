import { afterEach, describe, expect, it } from 'vitest'
import { brevoConfigurado, criarClienteBrevo, MENSAGEM_NAO_CONECTADO } from '@/lib/brevo'

type Chamada = { url: string; metodo: string; headers: Record<string, string>; corpo: unknown }

function fetchFalso(respostas: Array<{ status: number; json?: unknown } | Error>) {
  const chamadas: Chamada[] = []
  let i = 0
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    chamadas.push({
      url: String(url),
      metodo: init?.method ?? 'GET',
      headers,
      corpo: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    const r = respostas[Math.min(i++, respostas.length - 1)]
    if (r instanceof Error) throw r
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status })
  }) as typeof fetch
  return { f, chamadas }
}

const ORIGINAL = { ...process.env }
afterEach(() => {
  process.env = { ...ORIGINAL }
})

describe('cliente Brevo: sem chave', () => {
  it('toda operação devolve "não conectado" sem chamar a rede', async () => {
    const { f, chamadas } = fetchFalso([{ status: 200 }])
    const c = criarClienteBrevo({ apiKey: null, fetch: f })
    expect(c.conectado).toBe(false)
    const rs = await Promise.all([
      c.upsertContato({ email: 'a@example.com', atributos: {} }),
      c.obterContato('a@example.com'),
      c.atualizarContato('a@example.com', { emailBlacklisted: true }),
      c.adicionarALista(1, ['a@example.com']),
      c.removerDaLista(1, ['a@example.com']),
      c.listarContatos(),
      c.criarRascunhoCampanha({ nome: 'n', assunto: 's', remetente: { email: 'r@example.com' }, html: '<p>olá mundo</p>', listIds: [1] }),
    ])
    for (const r of rs) expect(r).toEqual({ ok: false, motivo: 'nao_conectado', mensagem: MENSAGEM_NAO_CONECTADO })
    expect(chamadas).toHaveLength(0)
  })

  it('lê BREVO_API_KEY do ambiente; espaços em branco = sem chave', () => {
    process.env.BREVO_API_KEY = '   '
    expect(brevoConfigurado()).toBe(false)
    expect(criarClienteBrevo().conectado).toBe(false)
    process.env.BREVO_API_KEY = 'chave-falsa'
    expect(brevoConfigurado()).toBe(true)
    expect(criarClienteBrevo().conectado).toBe(true)
  })
})

describe('cliente Brevo: operações', () => {
  it('upsert: POST /contacts com api-key, updateEnabled e atributos; 201 devolve id', async () => {
    const { f, chamadas } = fetchFalso([{ status: 201, json: { id: 21 } }])
    const c = criarClienteBrevo({ apiKey: 'k-teste', fetch: f })
    const r = await c.upsertContato({ email: 'a@example.com', atributos: { NOME: 'Ana', UF: 'SP' } })
    expect(r).toEqual({ ok: true, dados: { id: 21, criado: true } })
    expect(chamadas[0].url).toBe('https://api.brevo.com/v3/contacts')
    expect(chamadas[0].metodo).toBe('POST')
    expect(chamadas[0].headers['api-key']).toBe('k-teste')
    expect(chamadas[0].corpo).toEqual({ email: 'a@example.com', attributes: { NOME: 'Ana', UF: 'SP' }, updateEnabled: true })
  })

  it('upsert de contato existente: 204 sem corpo → id nulo, não criado', async () => {
    const { f } = fetchFalso([{ status: 204 }])
    const r = await criarClienteBrevo({ apiKey: 'k', fetch: f }).upsertContato({ email: 'a@example.com', atributos: {} })
    expect(r).toEqual({ ok: true, dados: { id: null, criado: false } })
  })

  it('upsert com bloqueio manda emailBlacklisted e nunca manda listIds vazio', async () => {
    const { f, chamadas } = fetchFalso([{ status: 204 }])
    await criarClienteBrevo({ apiKey: 'k', fetch: f }).upsertContato({ email: 'a@example.com', atributos: {}, emailBlacklisted: true, listIds: [] })
    expect(chamadas[0].corpo).toEqual({ email: 'a@example.com', attributes: {}, updateEnabled: true, emailBlacklisted: true })
  })

  it('obterContato: email codificado na URL; 404 → null', async () => {
    const { f, chamadas } = fetchFalso([
      { status: 200, json: { id: 7, email: 'a+b@example.com', emailBlacklisted: true, listIds: [3, 4], attributes: { NOME: 'A' } } },
      { status: 404, json: { code: 'document_not_found', message: 'Contact does not exist' } },
    ])
    const c = criarClienteBrevo({ apiKey: 'k', fetch: f })
    expect(await c.obterContato('a+b@example.com')).toEqual({
      ok: true,
      dados: { id: 7, email: 'a+b@example.com', emailBlacklisted: true, listIds: [3, 4], atributos: { NOME: 'A' } },
    })
    expect(chamadas[0].url).toBe('https://api.brevo.com/v3/contacts/a%2Bb%40example.com')
    expect(await c.obterContato('x@example.com')).toEqual({ ok: true, dados: null })
  })

  it('atualizarContato: PUT com unlinkListIds', async () => {
    const { f, chamadas } = fetchFalso([{ status: 204 }])
    const r = await criarClienteBrevo({ apiKey: 'k', fetch: f }).atualizarContato('a@example.com', { unlinkListIds: [3], emailBlacklisted: true })
    expect(r).toEqual({ ok: true, dados: null })
    expect(chamadas[0].metodo).toBe('PUT')
    expect(chamadas[0].corpo).toEqual({ unlinkListIds: [3], emailBlacklisted: true })
  })

  it('adicionar/remover de lista: endpoints certos e lotes de 150', async () => {
    const { f, chamadas } = fetchFalso([{ status: 201, json: { contacts: { success: ['x'], failure: [] } } }])
    const c = criarClienteBrevo({ apiKey: 'k', fetch: f })
    const emails = Array.from({ length: 151 }, (_, i) => `c${i}@example.com`)
    const r = await c.adicionarALista(9, emails)
    expect(chamadas.map((x) => x.url)).toEqual([
      'https://api.brevo.com/v3/contacts/lists/9/contacts/add',
      'https://api.brevo.com/v3/contacts/lists/9/contacts/add',
    ])
    expect((chamadas[0].corpo as { emails: string[] }).emails).toHaveLength(150)
    expect((chamadas[1].corpo as { emails: string[] }).emails).toEqual(['c150@example.com'])
    expect(r.ok && r.dados.sucesso).toEqual(['x', 'x'])
    await c.removerDaLista(9, ['a@example.com'])
    expect(chamadas[2].url).toBe('https://api.brevo.com/v3/contacts/lists/9/contacts/remove')
  })

  it('aceita success/failure no topo da resposta', async () => {
    const { f } = fetchFalso([{ status: 201, json: { success: ['a@example.com'], failure: ['b@example.com'] } }])
    const r = await criarClienteBrevo({ apiKey: 'k', fetch: f }).removerDaLista(1, ['a@example.com', 'b@example.com'])
    expect(r).toEqual({ ok: true, dados: { sucesso: ['a@example.com'], falha: ['b@example.com'] } })
  })

  it('listarContatos: paginação por limit/offset, limite máximo 1000', async () => {
    const { f, chamadas } = fetchFalso([{ status: 200, json: { contacts: [{ id: 1, email: 'a@example.com', emailBlacklisted: false, listIds: [] }], count: 1 } }])
    const r = await criarClienteBrevo({ apiKey: 'k', fetch: f }).listarContatos({ limite: 5000, offset: 2000 })
    expect(chamadas[0].url).toBe('https://api.brevo.com/v3/contacts?limit=1000&offset=2000&sort=asc')
    expect(r.ok && r.dados.total).toBe(1)
    expect(r.ok && r.dados.contatos[0].email).toBe('a@example.com')
  })

  it('rascunho de campanha: sem scheduledAt, com listIds e sender', async () => {
    const { f, chamadas } = fetchFalso([{ status: 201, json: { id: 5 } }])
    const r = await criarClienteBrevo({ apiKey: 'k', fetch: f }).criarRascunhoCampanha({
      nome: 'Blog: tema X',
      assunto: 'Novo artigo',
      remetente: { nome: 'OG', email: 'contato@example.com' },
      html: '<p>Conteúdo do artigo</p>',
      previewText: 'Resumo',
      listIds: [4],
    })
    expect(r).toEqual({ ok: true, dados: { id: 5 } })
    expect(chamadas[0].url).toBe('https://api.brevo.com/v3/emailCampaigns')
    expect(chamadas[0].corpo).toEqual({
      name: 'Blog: tema X',
      subject: 'Novo artigo',
      sender: { email: 'contato@example.com', name: 'OG' },
      htmlContent: '<p>Conteúdo do artigo</p>',
      previewText: 'Resumo',
      recipients: { listIds: [4] },
    })
    expect(chamadas[0].corpo).not.toHaveProperty('scheduledAt')
    expect(chamadas.some((c) => c.url.includes('sendNow'))).toBe(false)
  })
})

describe('cliente Brevo: erros em pt-BR, sem repetir a mensagem do Brevo', () => {
  it.each([
    [401, /recusou a chave/],
    [403, /permissão/],
    [429, /Limite de requisições/],
    [503, /indisponível \(503\)/],
  ])('HTTP %i', async (status, re) => {
    const { f } = fetchFalso([{ status, json: { code: 'unauthorized', message: 'contato a@example.com recusado' } }])
    const r = await criarClienteBrevo({ apiKey: 'k', fetch: f }).upsertContato({ email: 'a@example.com', atributos: {} })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.motivo).toBe('http')
      expect(r.status).toBe(status)
      expect(r.mensagem).toMatch(re)
      expect(r.mensagem).not.toContain('example.com')
    }
  })

  it('400 traz o código, não a mensagem', async () => {
    const { f } = fetchFalso([{ status: 400, json: { code: 'invalid_parameter', message: 'Invalid email a@example.com' } }])
    const r = await criarClienteBrevo({ apiKey: 'k', fetch: f }).upsertContato({ email: 'a@example.com', atributos: {} })
    expect(r).toEqual({
      ok: false,
      motivo: 'http',
      status: 400,
      codigo: 'invalid_parameter',
      mensagem: 'O Brevo recusou os dados (400) (código invalid_parameter).',
    })
  })

  it('timeout vira erro tipado', async () => {
    const f = ((_u: string, init?: RequestInit) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(init.signal?.reason))
      })) as unknown as typeof fetch
    const r = await criarClienteBrevo({ apiKey: 'k', fetch: f, timeoutMs: 20 }).listarContatos()
    expect(r).toMatchObject({ ok: false, motivo: 'timeout' })
  })

  it('falha de rede vira erro tipado', async () => {
    const { f } = fetchFalso([new TypeError('fetch failed')])
    const r = await criarClienteBrevo({ apiKey: 'k', fetch: f }).listarContatos()
    expect(r).toEqual({ ok: false, motivo: 'rede', mensagem: 'Falha de rede ao falar com o Brevo.' })
  })

  it('resposta 200 com formato inesperado', async () => {
    const { f } = fetchFalso([{ status: 200, json: { nada: true } }])
    const r = await criarClienteBrevo({ apiKey: 'k', fetch: f }).listarContatos()
    expect(r).toMatchObject({ ok: false, motivo: 'resposta_invalida' })
  })
})
