import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Peças comuns dos webhooks públicos (`/api/webhooks/*`). O proxy deixa essas rotas
 * passarem sem cookie, então o token é a única barreira: comparação em tempo constante e
 * falha fechada quando a variável de ambiente não existe.
 */

function sha256(v: string): Buffer {
  return createHash('sha256').update(v).digest()
}

/** `false` se o esperado estiver vazio/ausente (falha fechada) ou se não bater. */
export function tokenConfere(recebido: string | null | undefined, esperado: string | null | undefined): boolean {
  const e = esperado?.trim()
  if (!e) return false
  // Hash dos dois lados: mesmo tamanho para o timingSafeEqual, sem vazar o comprimento.
  return timingSafeEqual(sha256(recebido ?? ''), sha256(e))
}

/**
 * Token da chamada: `?token=` (o Brevo e o Elementor só deixam configurar a URL) ou
 * `Authorization: Bearer` (webhooks do Brevo criados pela API aceitam cabeçalho).
 */
export function tokenDaRequisicao(request: Request): string | null {
  const daUrl = new URL(request.url).searchParams.get('token')
  if (daUrl) return daUrl
  const auth = request.headers.get('authorization') ?? ''
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null
}

export type CorpoLido = { ok: true; texto: string } | { ok: false; motivo: 'grande' | 'ilegivel' }

/** Lê o corpo como texto UTF-8, parando assim que passar de `max` bytes. */
export async function lerCorpoLimitado(request: Request, max: number): Promise<CorpoLido> {
  const declarado = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declarado) && declarado > max) return { ok: false, motivo: 'grande' }
  if (!request.body) return { ok: true, texto: '' }
  const leitor = request.body.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) break
      total += value.byteLength
      if (total > max) {
        await leitor.cancel().catch(() => undefined)
        return { ok: false, motivo: 'grande' }
      }
      partes.push(value)
    }
  } catch {
    return { ok: false, motivo: 'ilegivel' }
  }
  const tudo = new Uint8Array(total)
  let pos = 0
  for (const p of partes) {
    tudo.set(p, pos)
    pos += p.byteLength
  }
  return { ok: true, texto: new TextDecoder('utf-8').decode(tudo) }
}

/** IP de quem chama, pelo cabeçalho que a Vercel preenche. */
export function ipDaRequisicao(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim() || 'desconhecido'
  return request.headers.get('x-real-ip')?.trim() || 'desconhecido'
}

/**
 * Limite ingênuo por IP, em memória (janela fixa). Cada instância da função tem o seu, então
 * é só um freio contra enxurrada de spam, não uma garantia. Com o mapa cheio, saem primeiro
 * as janelas vencidas e depois as mais antigas (o Map guarda a ordem de inserção).
 */
export class LimitadorPorIp {
  private janelas = new Map<string, { inicio: number; n: number }>()
  constructor(
    private readonly maximo: number,
    private readonly janelaMs: number,
    private readonly maxChaves = 10_000,
  ) {}

  permitir(ip: string, agora = Date.now()): boolean {
    const j = this.janelas.get(ip)
    if (!j || agora - j.inicio >= this.janelaMs) {
      this.janelas.delete(ip) // reinserir: a janela nova vai para o fim da ordem
      if (this.janelas.size >= this.maxChaves) this.despejar(agora)
      this.janelas.set(ip, { inicio: agora, n: 1 })
      return true
    }
    j.n++
    return j.n <= this.maximo
  }

  get tamanho(): number {
    return this.janelas.size
  }

  private despejar(agora: number) {
    for (const [k, j] of this.janelas) if (agora - j.inicio >= this.janelaMs) this.janelas.delete(k)
    for (const k of this.janelas.keys()) {
      if (this.janelas.size < this.maxChaves) break
      this.janelas.delete(k)
    }
  }
}
