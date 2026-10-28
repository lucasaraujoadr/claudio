import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const COOKIE_SESSAO = 'og_seo_sessao'
export const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000

function sha256(valor: string): Buffer {
  return createHash('sha256').update(valor).digest()
}

function assinar(payload: string, segredo: string): string {
  return createHmac('sha256', segredo).update(payload).digest('hex')
}

function iguais(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b))
}

/** Lido em tempo de chamada. Ausente ou vazio => null (falha fechada). */
function segredoSessao(): string | null {
  const segredo = process.env.AUTH_SECRET
  return segredo ? segredo : null
}

export function isCorrectPassword(entrada: string): boolean {
  const senha = process.env.DASHBOARD_PASSWORD
  // Guarda antes de qualquer comparação: sem senha configurada, nada passa.
  if (!senha) return false
  return iguais(entrada, senha)
}

export function criarTokenSessao(agora: Date = new Date()): string {
  const segredo = segredoSessao()
  if (!segredo) throw new Error('AUTH_SECRET não está definido')
  const exp = String(agora.getTime() + DURACAO_SESSAO_MS)
  return `${exp}.${assinar(exp, segredo)}`
}

export function tokenSessaoValido(
  token: string | null | undefined,
  agora: Date = new Date(),
): boolean {
  const segredo = segredoSessao()
  if (!segredo || !token) return false
  const partes = token.split('.')
  if (partes.length !== 2) return false
  const [exp, assinatura] = partes
  // Assinatura primeiro: só então a expiração é confiável.
  if (!iguais(assinatura, assinar(exp, segredo))) return false
  const expMs = Number(exp)
  return Number.isFinite(expMs) && expMs > agora.getTime()
}
