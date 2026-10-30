import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { contatos } from '@/lib/db/schema'
import { bancoPadrao, type BancoCrm } from '@/lib/crm/banco'
import { mudarStatus, registrarEvento } from '@/lib/crm/contatos'
import { sairDeTodosOsFunis } from '@/lib/crm/ganchos-funis'
import { lerCorpoLimitado, tokenConfere } from '@/lib/webhooks'
import { urlPublicaPainel } from './acesso-publico'

/**
 * Descadastro público (spec §2.5). Token: `base64url("<id>.<expiraEmUnix>")` + `.` + `base64url(HMAC-SHA256)`,
 * válido por 10 anos (email antigo continua com descadastro funcionando). O GET da página nunca descadastra (leitor de link de antivírus abre URLs): só o POST.
 * O segredo, o token e o email nunca vão para log nem para resposta.
 */

/** 10 anos, contando os bissextos. */
const VALIDADE_S = 3653 * 86_400
const MOTIVO = 'link de descadastro'
const MAX_CORPO = 4096
/** Maior valor de `integer` do Postgres: id maior nunca existe (e estouraria a consulta). */
const ID_MAX = 2_147_483_647

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
  if (!Number.isSafeInteger(contatoId) || contatoId <= 0 || contatoId > ID_MAX) return null
  if (Number(m[2]) * 1000 < agora.getTime()) return null
  return { contatoId }
}

export function urlDescadastro(contatoId: number, agora: Date): string {
  return `${urlPublicaPainel()}/descadastro?t=${encodeURIComponent(gerarTokenDescadastro(contatoId, agora))}`
}

/**
 * Descadastra o contato do token. Idempotente: quem já está descadastrado (inclusive com dados apagados)
 * volta `'ja'` (só reencerra inscrições de funil, sem evento novo). Não chama o Resend: `mudarStatus`
 * deixa o contato `pendente` e a fila de sincronização cuida do Resend.
 */
export async function descadastrarPorToken(
  token: string,
  agora: Date,
  opts: { db?: BancoCrm; segredo?: string } = {},
): Promise<ResultadoDescadastro> {
  const lido = lerTokenDescadastro(token, agora, opts.segredo ?? process.env.DESCADASTRO_SEGREDO)
  if (!lido) return 'invalido'
  const db = opts.db ?? bancoPadrao()

  return db.transaction(async (tx) => {
    const banco = tx as unknown as BancoCrm
    const [c] = await banco
      .select({ id: contatos.id, status: contatos.status, dadosApagadosEm: contatos.dadosApagadosEm })
      .from(contatos)
      .where(eq(contatos.id, lido.contatoId))
      .for('update')
    if (!c) return 'invalido' as const
    if (c.status === 'descadastrado') {
      // Defesa em profundidade: garante que nenhuma inscrição ativa sobrou. Sem evento nem dado novo.
      await sairDeTodosOsFunis(c.id, { db: banco, motivo: MOTIVO })
      return 'ja' as const
    }
    await mudarStatus(c.id, 'descadastrado', { db: banco, origem: 'descadastro', motivo: MOTIVO })
    await sairDeTodosOsFunis(c.id, { db: banco, motivo: MOTIVO })
    await registrarEvento(c.id, 'descadastrou', c.dadosApagadosEm ? null : { origem: 'descadastro' }, { db: banco })
    return 'ok' as const
  })
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
  opts: { db?: BancoCrm; segredo?: string; agora?: Date } = {},
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
