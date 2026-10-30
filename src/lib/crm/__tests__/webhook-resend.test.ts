import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { contatos, enviosFunil, eventosContato, funilInscricoes, webhookEventosRecebidos } from '@/lib/db/schema'
import type { BancoCrm } from '../banco'
import { upsertContato } from '../contatos'
import { inscrever } from '../funis'
import { aplicarEventoResend, tratarWebhookResend, verificarAssinaturaSvix } from '../webhook-resend'
import { criarBancoTesteFunis } from './banco-teste-funis'

const SEGREDO = `whsec_${Buffer.from('segredo-de-teste-resend-0123456789').toString('base64')}`
const AGORA = new Date('2026-10-29T15:00:00Z')
const TS = String(Math.floor(AGORA.getTime() / 1000))

function assinar(id: string, ts: string, corpo: string, segredo = SEGREDO) {
  return 'v1,' + createHmac('sha256', Buffer.from(segredo.slice(6), 'base64')).update(`${id}.${ts}.${corpo}`).digest('base64')
}

let db: BancoCrm
let fechar: () => Promise<void>
beforeEach(async () => {
  ;({ db, fechar } = await criarBancoTesteFunis())
})
afterEach(async () => {
  await fechar()
})

describe('verificarAssinaturaSvix', () => {
  const corpo = '{"type":"email.opened"}'
  const cab = (o: Partial<{ id: string; timestamp: string; assinatura: string }> = {}) => ({
    id: 'msg_1',
    timestamp: TS,
    assinatura: assinar('msg_1', TS, corpo),
    ...o,
  })
  it('assinatura válida (vetor calculado no teste com segredo conhecido)', () => {
    expect(verificarAssinaturaSvix(corpo, cab(), SEGREDO, AGORA)).toBe(true)
  })
  it('assinatura errada → false', () => {
    expect(verificarAssinaturaSvix(corpo, cab({ assinatura: assinar('msg_1', TS, 'outro corpo') }), SEGREDO, AGORA)).toBe(false)
    expect(verificarAssinaturaSvix(corpo + ' ', cab(), SEGREDO, AGORA)).toBe(false)
    expect(verificarAssinaturaSvix(corpo, cab({ assinatura: 'lixo' }), SEGREDO, AGORA)).toBe(false)
  })
  it('timestamp de 6 min atrás → false (e 4 min → true)', () => {
    const velho = String(Math.floor(AGORA.getTime() / 1000) - 360)
    expect(verificarAssinaturaSvix(corpo, cab({ timestamp: velho, assinatura: assinar('msg_1', velho, corpo) }), SEGREDO, AGORA)).toBe(false)
    const ok = String(Math.floor(AGORA.getTime() / 1000) - 240)
    expect(verificarAssinaturaSvix(corpo, cab({ timestamp: ok, assinatura: assinar('msg_1', ok, corpo) }), SEGREDO, AGORA)).toBe(true)
  })
  it('múltiplas assinaturas, uma válida → true', () => {
    const a = `v1,${Buffer.from('x'.repeat(32)).toString('base64')} v2,abc ${assinar('msg_1', TS, corpo)}`
    expect(verificarAssinaturaSvix(corpo, cab({ assinatura: a }), SEGREDO, AGORA)).toBe(true)
  })
})

async function criar(email = 'ana@example.com') {
  const r = await upsertContato({ email, nome: 'Fulano', baseLegal: 'consentimento' }, 'manual', { db })
  if (r.acao !== 'criado') throw new Error('não criou')
  await db.update(contatos).set({ syncStatus: 'sincronizado' }).where(eq(contatos.id, r.contatoId))
  return r.contatoId
}
const linha = async (id: number) => (await db.select().from(contatos).where(eq(contatos.id, id)))[0]
const eventos = (id: number) => db.select().from(eventosContato).where(eq(eventosContato.contatoId, id)).orderBy(asc(eventosContato.id))
const email = (type: string, extra: Record<string, unknown> = {}, to = ['Ana@Example.com']) => ({
  type,
  created_at: '2026-10-29T14:59:00.000Z',
  data: { email_id: 'em_1', to, subject: 'Olá', ...extra },
})
const aplicar = (svixId: string, corpo: unknown) => aplicarEventoResend({ svixId, corpo }, { db })

describe('aplicarEventoResend', () => {
  it('mesmo svix-id duas vezes → repetido', async () => {
    const id = await criar()
    expect(await aplicar('msg_a', email('email.opened'))).toBe('processado')
    expect(await aplicar('msg_a', email('email.opened'))).toBe('repetido')
    expect((await eventos(id)).filter((e) => e.tipo === 'aberto')).toHaveLength(1)
    expect(await db.select().from(webhookEventosRecebidos)).toHaveLength(1)
  })

  it('aberto e clicado só registram (clique guarda só a URL) e não reativam nem mudam status', async () => {
    const id = await criar()
    await aplicar('m1', email('email.opened'))
    await aplicar('m2', email('email.clicked', { click: { link: 'https://x.com.br/a', ipAddress: '1.2.3.4', userAgent: 'UA' } }))
    const evs = await eventos(id)
    expect(evs.at(-1)).toMatchObject({ tipo: 'clicado', dados: { link: 'https://x.com.br/a' } })
    expect(JSON.stringify(evs.map((e) => e.dados))).not.toContain('1.2.3.4')
    const c = await linha(id)
    expect(c.status).toBe('lead')
    expect(c.syncStatus).toBe('sincronizado')
    expect(evs.some((e) => e.tipo === 'mudou_status')).toBe(false)
  })

  it('aberto/clicado de descadastrado não reativa', async () => {
    const id = await criar()
    await aplicar('m1', { type: 'contact.updated', data: { email: 'ana@example.com', unsubscribed: true } })
    await aplicar('m2', email('email.opened'))
    await aplicar('m3', email('email.clicked', { click: { link: 'https://x.com' } }))
    expect((await linha(id)).status).toBe('descadastrado')
  })

  it('complained descadastra e tira dos funis', async () => {
    const id = await criar()
    await inscrever('boas-vindas', [id], { db, caminho: 'site' })
    expect(await aplicar('m1', email('email.complained'))).toBe('processado')
    const c = await linha(id)
    expect(c.status).toBe('descadastrado')
    expect(c.syncStatus).toBe('pendente')
    const evs = await eventos(id)
    expect(evs.some((e) => e.tipo === 'spam')).toBe(true)
    expect(evs.some((e) => e.tipo === 'mudou_status' && e.dados?.origem === 'resend' && e.dados?.para === 'descadastrado')).toBe(true)
    const ins = await db.select().from(funilInscricoes).where(eq(funilInscricoes.contatoId, id))
    expect(ins.length).toBeGreaterThan(0)
    expect(ins.every((i) => i.status === 'saiu')).toBe(true)
  })

  it('hard bounce tira dos funis; bounce temporário só registra', async () => {
    const t = await criar('t@example.com')
    expect(await aplicar('m0', email('email.bounced', { bounce: { type: 'Temporary', subType: 'MailboxFull', message: 'x' } }, ['t@example.com']))).toBe('processado')
    expect((await linha(t)).status).toBe('lead')
    expect((await eventos(t)).at(-1)).toMatchObject({ tipo: 'bounce' })

    const id = await criar()
    await inscrever('boas-vindas', [id], { db, caminho: 'site' })
    await aplicar('m1', email('email.bounced', { bounce: { type: 'Permanent', subType: 'Suppressed', message: 'x' } }))
    expect((await linha(id)).status).toBe('descadastrado')
    expect((await eventos(id)).some((e) => e.tipo === 'bounce')).toBe(true)
    const ins = await db.select().from(funilInscricoes).where(eq(funilInscricoes.contatoId, id))
    expect(ins.length).toBeGreaterThan(0)
    expect(ins.every((i) => i.status === 'saiu')).toBe(true)
  })

  it('contact.updated unsubscribed descadastra; unsubscribed false é ignorado', async () => {
    const id = await criar()
    expect(await aplicar('m0', { type: 'contact.updated', data: { email: 'ana@example.com', unsubscribed: false } })).toBe('ignorado')
    expect((await linha(id)).status).toBe('lead')
    expect(await aplicar('m1', { type: 'contact.updated', data: { id: 'c1', email: 'Ana@Example.com', unsubscribed: true } })).toBe('processado')
    const c = await linha(id)
    expect(c.status).toBe('descadastrado')
    expect(c.syncStatus).toBe('pendente')
    expect((await eventos(id)).some((e) => e.tipo === 'descadastrou')).toBe(true)
  })

  it('acha o contato pelo resend_email_id mesmo com outro destinatário', async () => {
    const id = await criar()
    await inscrever('boas-vindas', [id], { db, caminho: 'site' })
    const [ins] = await db.select().from(funilInscricoes).where(eq(funilInscricoes.contatoId, id))
    await db.insert(enviosFunil).values({ inscricaoId: ins.id, rodada: ins.entrouEm, etapa: 0, status: 'enviado', resendEmailId: 'em_xyz' })
    expect(await aplicar('m1', email('email.opened', { email_id: 'em_xyz' }, ['alias@outro.com']))).toBe('processado')
    expect((await eventos(id)).at(-1)?.tipo).toBe('aberto')
  })

  it('desconhecido, evento não usado e payload torto → sem erro', async () => {
    await criar()
    expect(await aplicar('m1', email('email.opened', {}, ['ninguem@example.com']))).toBe('contato_desconhecido')
    expect(await aplicar('m2', email('email.delivered'))).toBe('ignorado')
    expect(await aplicar('m3', email('email.sent'))).toBe('ignorado')
    expect(await aplicar('m4', { type: 'email.opened' })).toBe('ignorado')
    expect(await aplicar('m5', { type: 'email.opened', data: { to: 'ana@example.com' } })).toBe('ignorado')
    expect(await aplicar('m6', 'texto')).toBe('ignorado')
    expect(await aplicar('m7', null)).toBe('ignorado')
    expect(await aplicar('m8', email('email.clicked', { click: 5 }))).toBe('processado')
  })

  it('contato com dados apagados não recebe dados no evento, mas complaint continua valendo', async () => {
    const id = await criar()
    await db.update(contatos).set({ dadosApagadosEm: AGORA, status: 'descadastrado' }).where(eq(contatos.id, id))
    await aplicar('m1', email('email.clicked', { click: { link: 'https://x.example/?nome=Ana' } }))
    expect((await eventos(id)).at(-1)).toMatchObject({ tipo: 'clicado', dados: null })
    await aplicar('m2', email('email.complained'))
    const ultimo = (await eventos(id)).at(-1)
    expect(ultimo).toMatchObject({ tipo: 'spam', dados: null })
    expect((await linha(id)).status).toBe('descadastrado')
  })
})

describe('rota: tratarWebhookResend', () => {
  const corpo = JSON.stringify(email('email.opened'))
  const req = (c: string, h: Record<string, string>) => new Request('http://localhost/api/webhooks/resend', { method: 'POST', body: c, headers: h })
  const bons = (c = corpo, id = 'msg_r1') => ({ 'svix-id': id, 'svix-timestamp': TS, 'svix-signature': assinar(id, TS, c) })

  it('sem segredo → 503 (nada gravado)', async () => {
    const id = await criar()
    const r2 = await tratarWebhookResend(req(corpo, bons()), { db, segredo: null, agora: AGORA })
    expect(r2.status).toBe(503)
    expect(await eventos(id)).toHaveLength(1) // só o "criado"
  })
  it('assinatura ruim, sem cabeçalhos ou timestamp velho → 401', async () => {
    await criar()
    const ruim = { ...bons(), 'svix-signature': assinar('msg_r1', TS, 'outro') }
    expect((await tratarWebhookResend(req(corpo, ruim), { db, segredo: SEGREDO, agora: AGORA })).status).toBe(401)
    expect((await tratarWebhookResend(req(corpo, {}), { db, segredo: SEGREDO, agora: AGORA })).status).toBe(401)
    const depois = new Date(AGORA.getTime() + 6 * 60_000)
    expect((await tratarWebhookResend(req(corpo, bons()), { db, segredo: SEGREDO, agora: depois })).status).toBe(401)
  })
  it('assinatura boa → 200, aplica; repetido → 200 sem duplicar; JSON inválido assinado → 400', async () => {
    const id = await criar()
    const r = await tratarWebhookResend(req(corpo, bons()), { db, segredo: SEGREDO, agora: AGORA })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, desfecho: 'processado' })
    const r2 = await tratarWebhookResend(req(corpo, bons()), { db, segredo: SEGREDO, agora: AGORA })
    expect(await r2.json()).toEqual({ ok: true, desfecho: 'repetido' })
    expect((await eventos(id)).filter((e) => e.tipo === 'aberto')).toHaveLength(1)
    const lixo = '{nao json'
    expect((await tratarWebhookResend(req(lixo, bons(lixo, 'msg_r2')), { db, segredo: SEGREDO, agora: AGORA })).status).toBe(400)
  })
  it('corpo acima de 1 MB → 413', async () => {
    const grande = 'x'.repeat(1024 * 1024 + 1)
    expect((await tratarWebhookResend(req(grande, bons(grande)), { db, segredo: SEGREDO, agora: AGORA })).status).toBe(413)
  })
})
