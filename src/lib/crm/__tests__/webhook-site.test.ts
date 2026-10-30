import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { contatos, eventosContato } from '@/lib/db/schema'
import { LimitadorPorIp } from '@/lib/webhooks'
import type { BancoCrm } from '../banco'
import { mudarStatus, upsertContato } from '../contatos'
import { expandirColchetes, lerFormulario, tratarWebhookSite } from '../webhook-site'
import { criarBancoTesteFunis } from './banco-teste-funis'

const TOKEN = 'token-de-teste-site'
let db: BancoCrm
let fechar: () => Promise<void>
beforeEach(async () => {
  ;({ db, fechar } = await criarBancoTesteFunis())
})
afterEach(async () => {
  await fechar()
})

const FORM = 'application/x-www-form-urlencoded'
function req(corpo: string, tipo = FORM, token: string | null = TOKEN, ip = '203.0.113.1') {
  return new Request(`http://localhost/api/webhooks/site${token === null ? '' : `?token=${encodeURIComponent(token)}`}`, {
    method: 'POST',
    headers: { 'content-type': tipo, 'x-forwarded-for': `${ip}, 10.0.0.1` },
    body: corpo,
  })
}
const chamar = (r: Request, extra: { token?: string | null; limitador?: LimitadorPorIp } = {}) =>
  tratarWebhookSite(r, { db, token: TOKEN, limitador: new LimitadorPorIp(1000, 60_000), ...extra })

/** Como o PHP (`http_build_query`) codifica: espaço vira `+`. */
const qs = (o: Record<string, string>) => new URLSearchParams(o).toString()

const SIMPLES = qs({
  Nome: 'Maria Souza',
  'E-mail': 'Maria.Souza@Example.com',
  'WhatsApp': '(11) 98888-7777',
  'Escritório': 'Souza Advocacia',
  Mensagem: 'Preciso de um cálculo trabalhista.\nUrgente.',
  Date: '29 de outubro de 2026',
  'Page URL': 'https://ogpericiacontabil.com.br/contato/',
  'Remote IP': '203.0.113.1',
  form_id: 'abc123',
  form_name: 'Contato',
})

const AVANCADO = new URLSearchParams([
  ['form[id]', 'abc123'],
  ['form[name]', 'Contato'],
  ['fields[name][id]', 'name'],
  ['fields[name][type]', 'text'],
  ['fields[name][title]', 'Seu nome'],
  ['fields[name][value]', 'João Lima'],
  ['fields[name][raw_value]', 'João Lima'],
  ['fields[field_e1][id]', 'field_e1'],
  ['fields[field_e1][type]', 'email'],
  ['fields[field_e1][title]', 'Seu melhor endereço'],
  ['fields[field_e1][value]', 'joao@example.com'],
  ['fields[tel][id]', 'tel'],
  ['fields[tel][type]', 'tel'],
  ['fields[tel][title]', 'Contato'],
  ['fields[tel][value]', '11 3333-4444'],
  ['fields[message][id]', 'message'],
  ['fields[message][type]', 'textarea'],
  ['fields[message][title]', 'Conte o caso'],
  ['fields[message][value]', 'Perícia contábil em inventário'],
  ['meta[date][title]', 'Date'],
  ['meta[date][value]', '29/10/2026'],
  ['meta[remote_ip][title]', 'Remote IP'],
  ['meta[remote_ip][value]', '203.0.113.1'],
]).toString()

async function contato(email: string) {
  const [c] = await db.select().from(contatos).where(eq(contatos.emailNormalizado, email))
  return c
}
/** Eventos do contato, sem os de funil (o gancho da E9 pode inscrever no boas-vindas). */
async function eventos(id: number) {
  const todos = await db.select().from(eventosContato).where(eq(eventosContato.contatoId, id)).orderBy(asc(eventosContato.id))
  return todos.filter((e) => e.tipo !== 'entrou_funil' && e.tipo !== 'saiu_funil')
}

describe('leitura do payload do Elementor', () => {
  it('colchetes do PHP viram objetos', () => {
    expect(expandirColchetes([['fields[a][value]', '1'], ['fields[a][raw_value][]', 'x'], ['fields[a][raw_value][]', 'y'], ['b', '2']])).toEqual({
      fields: { a: { value: '1', raw_value: { '0': 'x', '1': 'y' } } },
      b: '2',
    })
  })

  it('formato simples (rótulos)', () => {
    expect(lerFormulario(SIMPLES, FORM)).toEqual({
      nome: 'Maria Souza',
      email: 'Maria.Souza@Example.com',
      telefone: '(11) 98888-7777',
      escritorio: 'Souza Advocacia',
      mensagem: 'Preciso de um cálculo trabalhista.\nUrgente.',
    })
  })

  it('dados avançados: id do campo, tipo e rótulo', () => {
    expect(lerFormulario(AVANCADO, FORM)).toEqual({
      nome: 'João Lima',
      email: 'joao@example.com',
      telefone: '11 3333-4444',
      mensagem: 'Perícia contábil em inventário',
    })
  })

  it('JSON simples e JSON avançado', () => {
    expect(lerFormulario(JSON.stringify({ name: 'Ana', email: 'ana@example.com', phone: '1', empresa: 'X', message: 'oi' }), 'application/json')).toEqual({
      nome: 'Ana', email: 'ana@example.com', telefone: '1', escritorio: 'X', mensagem: 'oi',
    })
    const avancado = { form: { id: 'f', name: 'n' }, fields: { email: { id: 'email', type: 'email', title: 'E-mail', value: 'b@example.com' }, nome: { id: 'nome', title: 'Nome', value: 'Bia' } } }
    expect(lerFormulario(JSON.stringify(avancado), 'application/json')).toEqual({ email: 'b@example.com', nome: 'Bia' })
  })

  it('JSON quebrado → null', () => {
    expect(lerFormulario('{"a":', 'application/json')).toBeNull()
  })
})

describe('webhook do site', () => {
  it('formato simples: cria contato origem site, consentimento agora e a mensagem só no evento', async () => {
    const agora = new Date('2026-10-29T12:00:00Z')
    const r = await tratarWebhookSite(req(SIMPLES), { db, token: TOKEN, limitador: new LimitadorPorIp(10, 60_000), agora })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
    const c = await contato('maria.souza@example.com')
    expect(c).toMatchObject({
      nome: 'Maria Souza',
      telefone: '(11) 98888-7777',
      escritorio: 'Souza Advocacia',
      origem: 'site',
      baseLegal: 'consentimento',
      status: 'lead',
    })
    expect(c.consentimentoEm?.toISOString()).toBe(agora.toISOString())
    expect(JSON.stringify(c)).not.toContain('cálculo trabalhista')
    const evs = await eventos(c.id)
    expect(evs.map((e) => e.tipo)).toEqual(['criado', 'formulario'])
    expect(evs[1].dados).toEqual({ origem: 'site', mensagem: 'Preciso de um cálculo trabalhista.\nUrgente.' })
  })

  it('dados avançados: cria contato', async () => {
    expect((await chamar(req(AVANCADO))).status).toBe(200)
    expect(await contato('joao@example.com')).toMatchObject({ nome: 'João Lima', telefone: '11 3333-4444' })
  })

  it('JSON: cria contato', async () => {
    const r = await chamar(req(JSON.stringify({ nome: 'Ana', email: 'ana@example.com' }), 'application/json'))
    expect(r.status).toBe(200)
    expect(await contato('ana@example.com')).toMatchObject({ origem: 'site' })
  })

  it('contato existente: fortalece a base para consentimento e registra a mensagem', async () => {
    await upsertContato({ email: 'maria.souza@example.com', nome: 'Maria', baseLegal: 'legitimo_interesse' }, 'planilha', { db })
    expect((await chamar(req(SIMPLES))).status).toBe(200)
    const c = await contato('maria.souza@example.com')
    expect(c.baseLegal).toBe('consentimento')
    expect(c.origem).toBe('planilha')
    expect((await eventos(c.id)).at(-1)?.tipo).toBe('formulario')
  })

  it('descadastrado que preenche o formulário continua descadastrado', async () => {
    const r0 = await upsertContato({ email: 'maria.souza@example.com', baseLegal: 'consentimento' }, 'manual', { db })
    await mudarStatus(r0.acao === 'criado' ? r0.contatoId : 0, 'descadastrado', { db })
    expect((await chamar(req(SIMPLES))).status).toBe(200)
    expect((await contato('maria.souza@example.com')).status).toBe('descadastrado')
  })

  it.each([
    ['sem email', qs({ Nome: 'X', Mensagem: 'oi' })],
    ['email inválido', qs({ Nome: 'X', Email: 'x@' })],
  ])('%s → 200 ignorado (o Elementor trata outro status como erro) e nada gravado', async (_n, corpo) => {
    const r = await chamar(req(corpo))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: false, ignorado: 'email_invalido' })
    expect(await db.select().from(contatos)).toHaveLength(0)
    expect(await db.select().from(eventosContato)).toHaveLength(0)
  })

  it('JSON quebrado → 400', async () => {
    expect((await chamar(req('{"email":', 'application/json'))).status).toBe(400)
  })

  it('corpo acima de 64 KB → 413, nada gravado', async () => {
    const corpo = qs({ Email: 'a@example.com', Mensagem: 'x'.repeat(64 * 1024) })
    expect((await chamar(req(corpo))).status).toBe(413)
    expect(await db.select().from(contatos)).toHaveLength(0)
  })

  it('sem token, token errado ou SITE_WEBHOOK_TOKEN ausente → 401, nada gravado', async () => {
    expect((await chamar(req(SIMPLES, FORM, null))).status).toBe(401)
    expect((await chamar(req(SIMPLES, FORM, 'errado'))).status).toBe(401)
    expect((await chamar(req(SIMPLES, FORM, ''), { token: null })).status).toBe(401)
    expect((await chamar(req(SIMPLES), { token: '' })).status).toBe(401)
    expect(await db.select().from(contatos)).toHaveLength(0)
  })

  it('limite por IP: o excedente recebe 200 ignorado sem gravar; outro IP passa', async () => {
    const limitador = new LimitadorPorIp(3, 60_000)
    for (let i = 0; i < 3; i++) {
      expect(await (await chamar(req(qs({ Email: `c${i}@example.com` })), { limitador })).json()).toEqual({ ok: true })
    }
    const r = await chamar(req(qs({ Email: 'c4@example.com' })), { limitador })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: false, ignorado: 'limite' })
    expect(await contato('c4@example.com')).toBeUndefined()
    expect((await chamar(req(qs({ Email: 'outro@example.com' }), FORM, TOKEN, '198.51.100.7'), { limitador })).status).toBe(200)
    expect(await contato('outro@example.com')).toBeDefined()
  })

  it('o limite padrão é 60 por minuto', async () => {
    const { LIMITE_POR_MINUTO } = await import('../webhook-site')
    expect(LIMITE_POR_MINUTO).toBe(60)
  })
})

describe('poluição de protótipo (form-urlencoded com colchetes)', () => {
  afterEach(() => {
    for (const k of ['x', 'poluido', 'value']) delete (Object.prototype as Record<string, unknown>)[k]
  })

  it.each([
    ['__proto__[x]=sim'],
    ['constructor[prototype][x]=sim'],
    ['fields[__proto__][value]=sim'],
    ['fields[a][__proto__][x]=sim'],
    ['__proto__=sim'],
    ['fields[a][constructor][prototype][x]=sim'],
  ])('%s não alcança Object.prototype', (corpo) => {
    const r = expandirColchetes(new URLSearchParams(corpo).entries())
    expect(({} as Record<string, unknown>).x).toBeUndefined()
    expect(({} as Record<string, unknown>).value).toBeUndefined()
    expect(Object.keys(r).filter((k) => ['__proto__', 'constructor'].includes(k))).toEqual([])
  })

  it('os nós não têm protótipo', () => {
    const r = expandirColchetes([['fields[a][value]', '1']])
    expect(Object.getPrototypeOf(r)).toBeNull()
    expect(Object.getPrototypeOf(r.fields)).toBeNull()
  })

  it('requisição com campos maliciosos é tratada normalmente e cria o contato', async () => {
    const corpo = [
      '__proto__[x]=sim',
      'constructor[prototype][x]=sim',
      'fields[__proto__][value]=sim',
      'fields[email][type]=email',
      'fields[email][value]=ok@example.com',
      'fields[nome][title]=Nome',
      'fields[nome][value]=Ok',
    ].join('&')
    const r = await chamar(req(corpo))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
    expect(({} as Record<string, unknown>).x).toBeUndefined()
    expect(({} as Record<string, unknown>).value).toBeUndefined()
    expect(await contato('ok@example.com')).toMatchObject({ nome: 'Ok' })
  })

  it('JSON com chave __proto__ também não polui', async () => {
    const r = await chamar(req('{"__proto__":{"x":"sim"},"fields":{"__proto__":{"value":"sim"},"e":{"type":"email","value":"j@example.com"}}}', 'application/json'))
    expect(r.status).toBe(200)
    expect(({} as Record<string, unknown>).x).toBeUndefined()
    expect(await contato('j@example.com')).toBeDefined()
  })
})

describe('LimitadorPorIp', () => {
  it('a janela recomeça depois de um minuto', () => {
    const l = new LimitadorPorIp(2, 60_000)
    expect([l.permitir('a', 0), l.permitir('a', 1), l.permitir('a', 2)]).toEqual([true, true, false])
    expect(l.permitir('a', 60_001)).toBe(true)
  })
  it('não cresce sem limite e despeja as janelas mais antigas, não todas', () => {
    const l = new LimitadorPorIp(1, 60_000, 3)
    for (let i = 0; i < 10; i++) l.permitir(`ip${i}`, i)
    expect(l.tamanho).toBe(3)
    // ip9 continua limitado (não foi zerado pelo despejo); ip0 saiu e recomeça.
    expect(l.permitir('ip9', 10)).toBe(false)
    expect(l.permitir('ip8', 10)).toBe(false)
    expect(l.permitir('ip0', 10)).toBe(true)
  })

  it('despeja primeiro as janelas vencidas', () => {
    const l = new LimitadorPorIp(1, 100, 2)
    l.permitir('velho', 0)
    l.permitir('novo', 150)
    l.permitir('terceiro', 160) // 'velho' venceu e sai; 'novo' fica
    expect(l.permitir('novo', 170)).toBe(false)
  })
})
