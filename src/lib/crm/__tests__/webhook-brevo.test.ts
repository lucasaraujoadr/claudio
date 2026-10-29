import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { brevoEventosRecebidos, contatos, eventosContato } from '@/lib/db/schema'
import type { BancoCrm } from '../banco'
import { upsertContato } from '../contatos'
import { tratarWebhookBrevo } from '../webhook-brevo'
import { criarBancoTesteBrevo } from './banco-teste-brevo'

const TOKEN = 'token-de-teste-brevo'
let db: BancoCrm
let fechar: () => Promise<void>
beforeEach(async () => {
  ;({ db, fechar } = await criarBancoTesteBrevo())
})
afterEach(async () => {
  await fechar()
})

function req(corpo: unknown, token: string | null = TOKEN, extra: RequestInit = {}) {
  const url = `http://localhost/api/webhooks/brevo${token === null ? '' : `?token=${encodeURIComponent(token)}`}`
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    ...extra,
  })
}
const chamar = (r: Request, token: string | null | undefined = TOKEN) => tratarWebhookBrevo(r, { db, token })

async function criar(email: string) {
  const r = await upsertContato({ email, nome: 'Fulano', baseLegal: 'consentimento' }, 'manual', { db })
  if (r.acao !== 'criado') throw new Error('não criou')
  await db.update(contatos).set({ syncStatus: 'sincronizado' }).where(eq(contatos.id, r.contatoId))
  return r.contatoId
}
async function linha(id: number) {
  const [c] = await db.select().from(contatos).where(eq(contatos.id, id))
  return c
}
async function eventos(id: number) {
  return db.select().from(eventosContato).where(eq(eventosContato.contatoId, id)).orderBy(asc(eventosContato.id))
}

const marketing = (event: string, extra: Record<string, unknown> = {}) => ({
  id: 1234,
  event,
  email: 'Ana@Example.com',
  camp_id: 12,
  campaign_name: 'Boas-vindas 1',
  tag: '',
  ts_sent: 1793000000,
  ts_event: 1793000100,
  ts: 1793003700,
  ...extra,
})

describe('webhook do Brevo: token (Review Focus 1)', () => {
  it('sem token → 401, nada gravado', async () => {
    const id = await criar('ana@example.com')
    const r = await chamar(req(marketing('unsubscribe'), null))
    expect(r.status).toBe(401)
    expect((await linha(id)).status).toBe('lead')
  })
  it('token errado → 401', async () => {
    expect((await chamar(req(marketing('opened'), 'errado'))).status).toBe(401)
  })
  it('BREVO_WEBHOOK_TOKEN ausente → 401 mesmo com token vazio (falha fechada)', async () => {
    expect((await chamar(req(marketing('opened'), ''), null)).status).toBe(401)
    expect((await chamar(req(marketing('opened'), ''), '')).status).toBe(401)
    expect((await chamar(req(marketing('opened'), 'qualquer'), '   ')).status).toBe(401)
  })
  it('lê BREVO_WEBHOOK_TOKEN do ambiente quando não injetado', async () => {
    const antes = process.env.BREVO_WEBHOOK_TOKEN
    delete process.env.BREVO_WEBHOOK_TOKEN
    expect((await tratarWebhookBrevo(req(marketing('opened')), { db })).status).toBe(401)
    process.env.BREVO_WEBHOOK_TOKEN = TOKEN
    expect((await tratarWebhookBrevo(req(marketing('opened')), { db })).status).toBe(200)
    if (antes === undefined) delete process.env.BREVO_WEBHOOK_TOKEN
    else process.env.BREVO_WEBHOOK_TOKEN = antes
  })
  it('aceita também Authorization: Bearer', async () => {
    const r = new Request('http://localhost/api/webhooks/brevo', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(marketing('opened')),
    })
    expect((await chamar(r)).status).toBe(200)
  })
})

describe('webhook do Brevo: eventos', () => {
  it.each([
    ['unsubscribe', 'descadastrou'],
    ['unsubscribed', 'descadastrou'],
    ['hard_bounce', 'bounce'],
    ['spam', 'spam'],
  ] as const)('%s → descadastrado + evento %s + mudou_status', async (evento, tipo) => {
    const id = await criar('ana@example.com')
    const r = await chamar(req(marketing(evento, { reason: 'motivo x' })))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, processados: 1, repetidos: 0, ignorados: 0 })
    const c = await linha(id)
    expect(c.status).toBe('descadastrado')
    expect(c.syncStatus).toBe('pendente') // a próxima sincronização bloqueia e tira das listas
    const evs = await eventos(id)
    const ev = evs.find((e) => e.tipo === tipo)!
    expect(ev.dados).toMatchObject({ evento, origem: 'brevo', campanha: 'Boas-vindas 1', motivo: 'motivo x' })
    expect(ev.em.toISOString()).toBe(new Date(1793000100 * 1000).toISOString())
    expect(evs.some((e) => e.tipo === 'mudou_status' && e.dados?.para === 'descadastrado' && e.dados?.origem === 'brevo')).toBe(true)
    expect(JSON.stringify(evs.map((e) => e.dados))).not.toContain('example.com')
  })

  it.each([
    ['opened', 'aberto'],
    ['click', 'clicado'],
    ['delivered', 'enviado'],
  ] as const)('%s → só evento %s, status intacto', async (evento, tipo) => {
    const id = await criar('ana@example.com')
    const r = await chamar(req(marketing(evento, { URL: 'https://ogpericiacontabil.com.br/blog/x' })))
    expect(r.status).toBe(200)
    const c = await linha(id)
    expect(c.status).toBe('lead')
    expect(c.syncStatus).toBe('sincronizado')
    const evs = await eventos(id)
    expect(evs.at(-1)?.tipo).toBe(tipo)
    expect(evs.some((e) => e.tipo === 'mudou_status')).toBe(false)
  })

  it('formato transacional (message-id, unsubscribed, link)', async () => {
    const id = await criar('ana@example.com')
    await chamar(req({ event: 'click', email: 'ana@example.com', id: 1, 'message-id': '<abc@smtp-relay>', ts_event: 1793000000, link: 'https://x.com.br', subject: 'Olá' }))
    expect((await eventos(id)).at(-1)).toMatchObject({ tipo: 'clicado', dados: { link: 'https://x.com.br', campanha: 'Olá' } })
  })

  it('descadastro de quem já é descadastrado: evento sim, sem mudou_status de novo', async () => {
    const id = await criar('ana@example.com')
    await chamar(req(marketing('unsubscribe')))
    await chamar(req(marketing('hard_bounce')))
    const evs = await eventos(id)
    expect(evs.filter((e) => e.tipo === 'mudou_status')).toHaveLength(1)
    expect(evs.filter((e) => e.tipo === 'bounce')).toHaveLength(1)
  })

  it('evento desconhecido → 200 e ignorado', async () => {
    const id = await criar('ana@example.com')
    const r = await chamar(req(marketing('list_addition')))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ processados: 0, ignorados: 1 })
    expect((await eventos(id)).filter((e) => e.tipo !== 'criado')).toHaveLength(0)
  })

  it('email que não está no CRM → 200, ignorado, nenhum contato criado', async () => {
    const r = await chamar(req(marketing('unsubscribe', { email: 'estranho@example.com' })))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ processados: 0, ignorados: 1 })
    expect(await db.select().from(contatos)).toHaveLength(0)
  })

  it('lote (lista de eventos)', async () => {
    const id = await criar('ana@example.com')
    const r = await chamar(req([marketing('delivered'), marketing('opened'), marketing('click', { ts_event: 1793000200 }), { foo: 1 }]))
    expect(await r.json()).toEqual({ ok: true, processados: 3, repetidos: 0, ignorados: 1 })
    expect((await eventos(id)).map((e) => e.tipo)).toEqual(['criado', 'enviado', 'aberto', 'clicado'])
  })
})

describe('webhook do Brevo: replay é idempotente (Review Focus 1)', () => {
  it('o mesmo evento duas vezes grava uma vez só', async () => {
    const id = await criar('ana@example.com')
    const corpo = marketing('unsubscribe')
    await chamar(req(corpo))
    const antes = await eventos(id)
    const r = await chamar(req(corpo))
    expect(await r.json()).toEqual({ ok: true, processados: 0, repetidos: 1, ignorados: 0 })
    expect(await eventos(id)).toEqual(antes)
    expect(await db.select().from(brevoEventosRecebidos)).toHaveLength(1)
  })

  it('o mesmo evento repetido dentro do mesmo lote também', async () => {
    const id = await criar('ana@example.com')
    await chamar(req([marketing('opened'), marketing('opened')]))
    expect((await eventos(id)).filter((e) => e.tipo === 'aberto')).toHaveLength(1)
  })

  it('outra abertura (outro instante) conta', async () => {
    const id = await criar('ana@example.com')
    await chamar(req(marketing('opened')))
    await chamar(req(marketing('opened', { ts_event: 1793009999 })))
    expect((await eventos(id)).filter((e) => e.tipo === 'aberto')).toHaveLength(2)
  })
})

describe('webhook do Brevo: entrada ruim nunca vira 500', () => {
  it.each(['{', 'null', '"texto"', '42'])('corpo %s → 400', async (corpo) => {
    expect((await chamar(req(corpo))).status).toBe(400)
  })
  it('corpo acima de 1 MB → 413', async () => {
    expect((await chamar(req('x'.repeat(1024 * 1024 + 1)))).status).toBe(413)
  })
  it('item sem email ou com email inválido → ignorado', async () => {
    const r = await chamar(req([{ event: 'opened' }, { event: 'opened', email: 'não-é-email' }]))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ignorados: 2 })
  })
})
