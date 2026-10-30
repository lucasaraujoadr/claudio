import { createHmac, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { contatos, enviosFunil, funilInscricoes, webhookEventosRecebidos } from '@/lib/db/schema'
import { urlPublicaPainel } from '@/lib/acesso-publico'
import { lerCorpoLimitado } from '@/lib/webhooks'
import { bancoPadrao, type BancoCrm } from './banco'
import { mudarStatus, registrarEvento, type TipoEvento } from './contatos'
import { normalizarEmail } from './email'
import { sairDeTodosOsFunis } from './ganchos-funis'

/**
 * Webhook de eventos do Resend (`POST /api/webhooks/resend`), assinado com Svix.
 *
 * Campos usados (https://resend.com/docs/webhooks/event-types e as páginas por evento): `type`,
 * `created_at` (ISO 8601), `data.email_id`, `data.to` (lista), `data.click.link`,
 * `data.bounce.type` ('Permanent' | 'Temporary'); em `contact.updated`: `data.email` e
 * `data.unsubscribed`. Tudo que faltar ou vier em outro formato → `ignorado`, nunca erro.
 *
 * - `email.opened` e `email.clicked` só entram na linha do tempo: não são consentimento e
 *   nunca reativam ninguém;
 * - `email.bounced` permanente, `email.complained` e `contact.updated` com `unsubscribed: true`
 *   descadastram (status → `descadastrado`, `syncStatus='pendente'`) e tiram dos funis;
 * - bounce permanente só tira dos funis (não é opt-out; o Resend já suprime o endereço);
 * - contato com dados apagados: evento sem dados, nunca PII.
 */

export const MAX_CORPO_RESEND = 1024 * 1024
export const TOLERANCIA_SEGUNDOS = 300

export type CabecalhosSvix = { id: string; timestamp: string; assinatura: string }

/** Confere a assinatura Svix: HMAC-SHA256 base64 de `${id}.${timestamp}.${corpo}`, em tempo constante. */
export function verificarAssinaturaSvix(corpo: string, cab: CabecalhosSvix, segredo: string, agora: Date): boolean {
  if (!cab.id || !cab.timestamp || !cab.assinatura || !segredo) return false
  if (!/^\d{1,12}$/.test(cab.timestamp)) return false
  const diferenca = Math.abs(Math.floor(agora.getTime() / 1000) - Number(cab.timestamp))
  if (diferenca > TOLERANCIA_SEGUNDOS) return false
  const chave = Buffer.from(segredo.startsWith('whsec_') ? segredo.slice(6) : segredo, 'base64')
  if (chave.length === 0) return false
  const esperado = createHmac('sha256', chave).update(`${cab.id}.${cab.timestamp}.${corpo}`).digest()
  // Percorre todas as assinaturas sem parar na primeira que confere.
  let ok = false
  for (const parte of cab.assinatura.split(' ')) {
    const [versao, valor] = parte.split(',')
    if (versao !== 'v1' || !valor) continue
    const recebido = Buffer.from(valor, 'base64')
    if (recebido.length === esperado.length && timingSafeEqual(recebido, esperado)) ok = true
  }
  return ok
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function texto(v: unknown, max = 1000): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

export type EventoResend = { svixId: string; corpo: unknown }
export type DesfechoResend = 'processado' | 'repetido' | 'ignorado' | 'contato_desconhecido'

/**
 * Links do painel (descadastro) carregam token: guarda só origem + caminho. Nos demais, tira o
 * parâmetro `t` e mantém o resto (UTM).
 */
function limparLink(link: string | null): string | null {
  if (!link) return null
  try {
    const u = new URL(link)
    if (u.origin === new URL(urlPublicaPainel()).origin) return `${u.origin}${u.pathname}`
    u.searchParams.delete('t')
    return u.toString().slice(0, 1000)
  } catch {
    return null
  }
}

type Plano = { tipo: TipoEvento; descadastra: boolean; saiDosFunis: boolean; motivo: string; dados: Record<string, unknown> }

function planejar(tipo: string, data: Record<string, unknown>): Plano | null {
  switch (tipo) {
    case 'email.opened':
      return { tipo: 'aberto', descadastra: false, saiDosFunis: false, motivo: '', dados: { evento: tipo, origem: 'resend' } }
    case 'email.clicked': {
      const click = ehObjeto(data.click) ? data.click : {}
      const link = limparLink(texto(click.link))
      return { tipo: 'clicado', descadastra: false, saiDosFunis: false, motivo: '', dados: link ? { link } : {} }
    }
    case 'email.bounced': {
      const bounce = ehObjeto(data.bounce) ? data.bounce : {}
      const tipoBounce = texto(bounce.type, 40)
      return {
        tipo: 'bounce',
        // Bounce permanente não é opt-out (spec §2.7): sai dos funis, o status não muda.
        descadastra: false,
        saiDosFunis: tipoBounce?.toLowerCase() === 'permanent',
        motivo: 'Hard bounce no Resend',
        dados: { evento: tipo, origem: 'resend', ...(tipoBounce ? { bounce: tipoBounce } : {}) },
      }
    }
    case 'email.complained':
      return { tipo: 'spam', descadastra: true, saiDosFunis: true, motivo: 'Marcado como spam no Resend', dados: { evento: tipo, origem: 'resend' } }
    case 'contact.updated':
      if (data.unsubscribed !== true) return null
      return { tipo: 'descadastrou', descadastra: true, saiDosFunis: true, motivo: 'Descadastro pelo Resend', dados: { evento: tipo, origem: 'resend' } }
    default:
      return null
  }
}

/** Aplica um evento numa transação: dedupe pelo `svix-id`, linha do tempo e, se for o caso, descadastro. */
export async function aplicarEventoResend(ev: EventoResend, opts: { db?: BancoCrm } = {}): Promise<DesfechoResend> {
  if (!ev.svixId || !ehObjeto(ev.corpo)) return 'ignorado'
  const tipo = texto(ev.corpo.type, 80)
  const data = ev.corpo.data
  if (!tipo || !ehObjeto(data)) return 'ignorado'
  const plano = planejar(tipo, data)
  if (!plano) return 'ignorado'
  const emails: string[] = []
  if (tipo === 'contact.updated') {
    const e = normalizarEmail(typeof data.email === 'string' ? data.email : '')
    if (e) emails.push(e)
  } else if (Array.isArray(data.to)) {
    for (const t of data.to.slice(0, 50)) {
      const e = normalizarEmail(typeof t === 'string' ? t : '')
      if (e) emails.push(e)
    }
  }
  const emailId = tipo === 'contact.updated' ? null : texto(data.email_id, 200)
  if (!emailId && emails.length === 0) return 'ignorado'
  const criadoEm = typeof ev.corpo.created_at === 'string' ? new Date(ev.corpo.created_at) : null
  const em = criadoEm && !Number.isNaN(criadoEm.getTime()) && criadoEm.getUTCFullYear() >= 2000 ? criadoEm : null

  const db = opts.db ?? bancoPadrao()
  return db.transaction(async (tx) => {
    const banco = tx as unknown as BancoCrm
    let contatoId: number | null = null
    if (emailId) {
      const [r] = await banco
        .select({ id: funilInscricoes.contatoId })
        .from(enviosFunil)
        .innerJoin(funilInscricoes, eq(funilInscricoes.id, enviosFunil.inscricaoId))
        .where(eq(enviosFunil.resendEmailId, emailId))
        .limit(1)
      contatoId = r?.id ?? null
    }
    if (contatoId === null) {
      for (const email of emails) {
        const [r] = await banco.select({ id: contatos.id }).from(contatos).where(eq(contatos.emailNormalizado, email)).limit(1)
        if (r) {
          contatoId = r.id
          break
        }
      }
    }
    if (contatoId === null) return 'contato_desconhecido' as const
    const [c] = await banco
      .select({ id: contatos.id, status: contatos.status, dadosApagadosEm: contatos.dadosApagadosEm })
      .from(contatos)
      .where(eq(contatos.id, contatoId))
      .for('update')
    if (!c) return 'contato_desconhecido' as const
    // O eco da nossa própria sincronização (já descadastrado): nada a gravar, chave não consumida.
    if (tipo === 'contact.updated' && c.status === 'descadastrado') return 'ignorado' as const
    const novo = await banco
      .insert(webhookEventosRecebidos)
      .values({ id: ev.svixId })
      .onConflictDoNothing({ target: webhookEventosRecebidos.id })
      .returning({ id: webhookEventosRecebidos.id })
    if (novo.length === 0) return 'repetido' as const
    // Dados apagados a pedido: o evento entra (prova do que houve), sem dados.
    await registrarEvento(c.id, plano.tipo, c.dadosApagadosEm ? null : plano.dados, { db: banco, ...(em ? { em } : {}) })
    if (plano.descadastra && c.status !== 'descadastrado') {
      await mudarStatus(c.id, 'descadastrado', { db: banco, origem: 'resend', motivo: plano.motivo })
    }
    if (plano.saiDosFunis) {
      await sairDeTodosOsFunis(c.id, { db: banco, motivo: plano.motivo })
    }
    return 'processado' as const
  })
}

function json(status: number, corpo: Record<string, unknown>): Response {
  return Response.json(corpo, { status })
}

export async function tratarWebhookResend(
  request: Request,
  opts: { db?: BancoCrm; segredo?: string | null; agora?: Date } = {},
): Promise<Response> {
  const segredo = (opts.segredo === undefined ? process.env.RESEND_WEBHOOK_SECRET : opts.segredo)?.trim()
  if (!segredo) return json(503, { erro: 'Webhook não configurado' })

  const corpo = await lerCorpoLimitado(request, MAX_CORPO_RESEND)
  if (!corpo.ok) {
    return corpo.motivo === 'grande' ? json(413, { erro: 'Corpo grande demais' }) : json(400, { erro: 'Corpo ilegível' })
  }
  const cab: CabecalhosSvix = {
    id: request.headers.get('svix-id') ?? '',
    timestamp: request.headers.get('svix-timestamp') ?? '',
    assinatura: request.headers.get('svix-signature') ?? '',
  }
  if (!verificarAssinaturaSvix(corpo.texto, cab, segredo, opts.agora ?? new Date())) {
    return json(401, { erro: 'Assinatura inválida' })
  }
  let dados: unknown
  try {
    dados = JSON.parse(corpo.texto)
  } catch {
    return json(400, { erro: 'JSON inválido' })
  }
  const desfecho = await aplicarEventoResend({ svixId: cab.id, corpo: dados }, { db: opts.db })
  return json(200, { ok: true, desfecho })
}
