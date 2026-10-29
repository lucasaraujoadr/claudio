import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { contatos } from '@/lib/db/schema'
import { bancoPadrao, type BancoCrm } from '@/lib/crm/banco'
import { mudarStatus, registrarEvento } from '@/lib/crm/contatos'
import { sairDeTodosOsFunis } from '@/lib/crm/ganchos-funis'
import { configResend, criarClienteResend, type ClienteResend } from '@/lib/resend'
import { lerCorpoLimitado, tokenConfere } from '@/lib/webhooks'
import { urlPublicaPainel } from './acesso-publico'

/**
 * Descadastro público (spec §2.5). Token: `base64url("<id>.<expiraEmUnix>")` + `.` + `base64url(HMAC-SHA256)`,
 * válido por 365 dias. O GET da página nunca descadastra (leitor de link de antivírus abre URLs): só o POST.
 * O segredo, o token e o email nunca vão para log nem para resposta.
 */

const VALIDADE_S = 365 * 86_400
const MOTIVO = 'link de descadastro'
const MAX_CORPO = 4096

export type ResultadoDescadastro = 'ok' | 'ja' | 'invalido'

function assinar(corpo: string, segredo: string): string {
  return createHmac('sha256', segredo).update(corpo).digest('base64url')
}

export function gerarTokenDescadastro(contatoId: number, agora: Date, segredo: string | undefined = process.env.DESCADASTRO_SEGREDO): string {
  if (!segredo?.trim()) throw new Error('DESCADASTRO_SEGREDO não configurado')
  const expira = Math.floor(agora.getTime() / 1000) + VALIDADE_S
  const corpo = Buffer.from(`${contatoId}.${expira}`).toString('base64url')
  return `${corpo}.${assinar(corpo, segredo.trim())}`
}

export function lerTokenDescadastro(
  token: string,
  agora: Date,
  segredo: string | undefined = process.env.DESCADASTRO_SEGREDO,
): { contatoId: number } | null {
  const chave = segredo?.trim()
  if (!chave || typeof token !== 'string' || token.length > 512) return null
  const partes = token.split('.')
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null
  // Comparação em tempo constante (hash dos dois lados, em `tokenConfere`).
  if (!tokenConfere(partes[1], assinar(partes[0], chave))) return null
  const m = /^(\d{1,15})\.(\d{1,15})$/.exec(Buffer.from(partes[0], 'base64url').toString('utf8'))
  if (!m) return null
  const contatoId = Number(m[1])
  if (!Number.isSafeInteger(contatoId) || contatoId <= 0) return null
  if (Number(m[2]) * 1000 < agora.getTime()) return null
  return { contatoId }
}

export function urlDescadastro(contatoId: number, agora: Date): string {
  return `${urlPublicaPainel()}/descadastro?t=${encodeURIComponent(gerarTokenDescadastro(contatoId, agora))}`
}

/**
 * Descadastra o contato do token. Idempotente: quem já está descadastrado (inclusive com dados apagados)
 * volta `'ja'`. O Resend é best-effort: sem cliente ou com falha, o descadastro local vale e o contato
 * fica `pendente` para a fila de sincronização repetir.
 */
export async function descadastrarPorToken(
  token: string,
  agora: Date,
  opts: { db?: BancoCrm; cliente?: ClienteResend | null; segredo?: string } = {},
): Promise<ResultadoDescadastro> {
  const lido = lerTokenDescadastro(token, agora, opts.segredo ?? process.env.DESCADASTRO_SEGREDO)
  if (!lido) return 'invalido'
  const db = opts.db ?? bancoPadrao()

  const feito = await db.transaction(async (tx) => {
    const banco = tx as unknown as BancoCrm
    const [c] = await banco
      .select({ id: contatos.id, email: contatos.email, nome: contatos.nome, status: contatos.status, dadosApagadosEm: contatos.dadosApagadosEm })
      .from(contatos)
      .where(eq(contatos.id, lido.contatoId))
      .for('update')
    if (!c) return 'invalido' as const
    if (c.status === 'descadastrado') return 'ja' as const
    await mudarStatus(c.id, 'descadastrado', { db: banco, origem: 'descadastro', motivo: MOTIVO })
    await sairDeTodosOsFunis(c.id, { db: banco, motivo: MOTIVO })
    await registrarEvento(c.id, 'descadastrou', c.dadosApagadosEm ? null : { origem: 'descadastro' }, { db: banco })
    return { email: c.email, nome: c.nome, apagado: c.dadosApagadosEm !== null }
  })
  if (feito === 'invalido' || feito === 'ja') return feito

  // Fora da transação: uma chamada de rede nunca segura trava de linha.
  const cliente = opts.cliente === undefined ? clientePadrao() : opts.cliente
  if (cliente && !feito.apagado && feito.email) {
    try {
      await cliente.salvarContato({ email: feito.email, nome: feito.nome, descadastrado: true })
      await db.update(contatos).set({ syncStatus: 'sincronizado' }).where(eq(contatos.id, lido.contatoId))
    } catch {
      // Segue 'pendente' (mudarStatus já marcou): a fila de sincronização tenta de novo.
    }
  }
  return 'ok'
}

function clientePadrao(): ClienteResend | null {
  const cfg = configResend()
  return cfg ? criarClienteResend(cfg) : null
}

const ESTILO =
  'font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a'

function pagina(titulo: string, texto: string, status: number): Response {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${titulo}</title></head><body style="${ESTILO}"><h1>${titulo}</h1><p>${texto}</p></body></html>`
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  })
}

/**
 * Lógica do `POST /api/publico/descadastro`. Aceita corpo de formulário (a página) e corpo vazio
 * (one-click, RFC 8058); o token vem da query `t` ou, na falta, do campo `t` do formulário.
 */
export async function responderDescadastro(
  request: Request,
  opts: { db?: BancoCrm; cliente?: ClienteResend | null; segredo?: string; agora?: Date } = {},
): Promise<Response> {
  if (request.method !== 'POST') return pagina('Método não permitido', 'Use o botão da página de descadastro.', 405)
  let token = new URL(request.url).searchParams.get('t')
  if (!token) {
    const corpo = await lerCorpoLimitado(request, MAX_CORPO)
    if (!corpo.ok) return pagina('Pedido inválido', 'Não foi possível ler o pedido.', 400)
    token = new URLSearchParams(corpo.texto).get('t')
  }
  const resultado = token
    ? await descadastrarPorToken(token, opts.agora ?? new Date(), opts)
    : 'invalido'
  if (resultado === 'invalido') return pagina('Link inválido ou expirado', 'Este link de descadastro não é válido ou já expirou.', 400)
  return pagina('Descadastro confirmado', 'Pronto: você não receberá mais emails nossos.', 200)
}
