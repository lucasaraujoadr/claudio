import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { brevoEventosRecebidos, contatos } from '@/lib/db/schema'
import { lerCorpoLimitado, tokenConfere, tokenDaRequisicao } from '@/lib/webhooks'
import { bancoPadrao, type BancoCrm } from './banco'
import { mudarStatus, registrarEvento, type TipoEvento } from './contatos'
import { normalizarEmail } from './email'
import { sairDeTodosOsFunis } from './ganchos-funis'

/**
 * Webhook de eventos do Brevo (`POST /api/webhooks/brevo?token=`).
 *
 * Formato (https://developers.brevo.com/docs/marketing-webhooks e
 * https://developers.brevo.com/docs/transactional-webhooks): um objeto JSON por evento, ou
 * uma lista quando o webhook é "batched". Campos usados: `event`, `email`, `message-id`
 * (transacional) ou `camp_id`/`campaign_name` (marketing), `ts_event`/`ts` (epoch em
 * segundos, UTC), `URL`/`link` (clique), `reason` (bounce/spam).
 *
 * - descadastro (`unsubscribe` no marketing, `unsubscribed` no transacional), hard bounce e
 *   spam → status `descadastrado`, saída de todos os funis e evento na linha do tempo;
 * - `opened`, `click`, `delivered` → só o evento na linha do tempo;
 * - qualquer outro evento → aceito (200) e ignorado;
 * - email que não está no CRM → aceito e ignorado (o Brevo nunca cria contato aqui);
 * - o mesmo evento entregue de novo → nada novo é gravado (chave em `brevo_eventos_recebidos`).
 */

export const MAX_CORPO_BREVO = 1024 * 1024
const MAX_EVENTOS_POR_CHAMADA = 1000

type Mapeado = { tipo: TipoEvento; descadastra: boolean }

const EVENTOS: Record<string, Mapeado> = {
  unsubscribe: { tipo: 'descadastrou', descadastra: true },
  unsubscribed: { tipo: 'descadastrou', descadastra: true },
  hard_bounce: { tipo: 'bounce', descadastra: true },
  hardbounce: { tipo: 'bounce', descadastra: true },
  spam: { tipo: 'spam', descadastra: true },
  opened: { tipo: 'aberto', descadastra: false },
  click: { tipo: 'clicado', descadastra: false },
  delivered: { tipo: 'enviado', descadastra: false },
}

const MOTIVO_DESCADASTRO: Partial<Record<TipoEvento, string>> = {
  descadastrou: 'Descadastro pelo Brevo',
  bounce: 'Hard bounce no Brevo',
  spam: 'Marcado como spam no Brevo',
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function texto(v: unknown, max = 500): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim().slice(0, max)
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

/** Epoch em segundos (ou ms) → Date plausível; senão `null`. */
function instante(v: unknown): Date | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  const ms = n > 1e12 ? n : n * 1000
  const d = new Date(ms)
  return d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100 ? d : null
}

/** JSON com as chaves ordenadas em todos os níveis (mesmo payload → mesmo texto). */
export function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`
  if (ehObjeto(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

export type EventoBrevo = {
  tipo: TipoEvento
  descadastra: boolean
  email: string
  chave: string
  em: Date | null
  dados: Record<string, unknown>
}

/** Interpreta um item do corpo. `null` = evento que o painel não usa (ou sem email). */
export function interpretarEventoBrevo(item: unknown): EventoBrevo | null {
  if (!ehObjeto(item)) return null
  const bruto = texto(item.event, 60)
  if (!bruto) return null
  const m = EVENTOS[bruto.toLowerCase()]
  if (!m) return null
  const email = normalizarEmail(typeof item.email === 'string' ? item.email : '')
  if (!email) return null
  const mensagem = texto(item['message-id']) ?? texto(item.camp_id) ?? ''
  const quando = item.ts_event ?? item.ts ?? item.ts_epoch ?? item.date ?? ''
  const link = texto(item.URL ?? item.link, 1000)
  // Sem id de mensagem/campanha nem instante, evento + email juntaria eventos diferentes:
  // aí entra o hash do payload inteiro (chaves ordenadas).
  const semIdentidade = !mensagem && String(quando) === ''
  const chave = createHash('sha256')
    .update(JSON.stringify([bruto.toLowerCase(), email, mensagem, String(quando), link ?? '', semIdentidade ? canonico(item) : '']))
    .digest('hex')
  const campanha = texto(item.campaign_name, 200) ?? (texto(item.camp_id) ? `#${texto(item.camp_id)}` : null) ?? texto(item.subject, 200)
  const dados: Record<string, unknown> = { evento: bruto, origem: 'brevo' }
  if (campanha) dados.campanha = campanha
  if (link) dados.link = link
  const motivo = texto(item.reason, 300)
  if (motivo) dados.motivo = motivo
  return { tipo: m.tipo, descadastra: m.descadastra, email, chave, em: instante(item.ts_event) ?? instante(item.ts_epoch) ?? instante(item.ts), dados }
}

export type DesfechoEvento = 'processado' | 'repetido' | 'contato_desconhecido'

/** Aplica um evento numa transação: dedupe, linha do tempo e, se for o caso, descadastro. */
export async function aplicarEventoBrevo(ev: EventoBrevo, opts: { db?: BancoCrm } = {}): Promise<DesfechoEvento> {
  const db = opts.db ?? bancoPadrao()
  return db.transaction(async (tx) => {
    const banco = tx as unknown as BancoCrm
    const [c] = await banco
      .select({ id: contatos.id, status: contatos.status, dadosApagadosEm: contatos.dadosApagadosEm })
      .from(contatos)
      .where(eq(contatos.emailNormalizado, ev.email))
      .for('update')
    if (!c) return 'contato_desconhecido' as const
    const novo = await banco
      .insert(brevoEventosRecebidos)
      .values({ chave: ev.chave, contatoId: c.id })
      .onConflictDoNothing({ target: brevoEventosRecebidos.chave })
      .returning({ chave: brevoEventosRecebidos.chave })
    if (novo.length === 0) return 'repetido' as const
    // Dados apagados a pedido: o evento entra (é a prova de que o envio foi barrado), sem dados.
    await registrarEvento(c.id, ev.tipo, c.dadosApagadosEm ? null : ev.dados, { db: banco, ...(ev.em ? { em: ev.em } : {}) })
    if (ev.descadastra) {
      const motivo = MOTIVO_DESCADASTRO[ev.tipo] ?? 'Brevo'
      if (c.status !== 'descadastrado') await mudarStatus(c.id, 'descadastrado', { db: banco, origem: 'brevo', motivo })
      await sairDeTodosOsFunis(c.id, { db: banco, motivo })
    }
    return 'processado' as const
  })
}

function json(status: number, corpo: Record<string, unknown>): Response {
  return Response.json(corpo, { status })
}

export async function tratarWebhookBrevo(
  request: Request,
  opts: { db?: BancoCrm; token?: string | null } = {},
): Promise<Response> {
  const esperado = opts.token === undefined ? process.env.BREVO_WEBHOOK_TOKEN : opts.token
  if (!tokenConfere(tokenDaRequisicao(request), esperado)) return json(401, { erro: 'Não autorizado' })

  const corpo = await lerCorpoLimitado(request, MAX_CORPO_BREVO)
  if (!corpo.ok) {
    return corpo.motivo === 'grande' ? json(413, { erro: 'Corpo grande demais' }) : json(400, { erro: 'Corpo ilegível' })
  }
  let dados: unknown
  try {
    dados = JSON.parse(corpo.texto)
  } catch {
    return json(400, { erro: 'JSON inválido' })
  }
  const itens = Array.isArray(dados) ? dados : ehObjeto(dados) ? [dados] : null
  if (!itens || itens.length > MAX_EVENTOS_POR_CHAMADA) return json(400, { erro: 'Formato inesperado' })

  let processados = 0
  let repetidos = 0
  let ignorados = 0
  for (const item of itens) {
    const ev = interpretarEventoBrevo(item)
    if (!ev) {
      ignorados++
      continue
    }
    const d = await aplicarEventoBrevo(ev, { db: opts.db })
    if (d === 'processado') processados++
    else if (d === 'repetido') repetidos++
    else ignorados++
  }
  return json(200, { ok: true, processados, repetidos, ignorados })
}
