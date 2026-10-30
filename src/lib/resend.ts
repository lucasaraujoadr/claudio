/**
 * Cliente da REST API do Resend (https://resend.com/docs/api-reference, conferido em 29/10/2026).
 *
 * Endpoints usados:
 * - `POST /emails` (cabeçalho `Idempotency-Key`; corpo `from`, `to[]`, `subject`, `html`, `text`,
 *   `reply_to`, `headers`, `tags[{name,value}]`) → `{id}`.
 * - `PATCH /contacts/{id ou email}` (`first_name`, `unsubscribed`) → `{id}`; 404 se não existe.
 * - `POST /contacts` (`email`, `first_name`, `unsubscribed`) → `{id}`. Sem propriedades personalizadas.
 * - `GET /segments?limit&after` → `{has_more, data:[{id,name}]}`; `POST /segments {name}` → `{id}`.
 *   (Segments substitui a API Audiences, descontinuada.)
 * - `POST /contacts/{email}/segments/{segmentId}` e `DELETE` no mesmo caminho.
 * - `POST /broadcasts` (`segment_id`, `name`, `from`, `reply_to`, `subject`, `html`, `text`;
 *   `send` fica falso: nasce como rascunho) → `{id}`. `preview_text` não é documentado na criação, então
 *   não é enviado: o pré-cabeçalho vai no HTML (div oculto), montado por quem chama.
 * - `PATCH /broadcasts/{id}` (mesmos campos; só rascunho) → `{id}`; 404 se não existe mais.
 * - `POST /broadcasts/{id}/send` (`scheduled_at` ISO 8601, opcional) → `{id}`.
 * - `GET /broadcasts/{id}` → `{id, status, ...}`.
 *
 * `fetch` é injetado para os testes. A chave nunca entra em mensagem de erro, log ou retorno; as
 * mensagens são fixas e nunca repetem o corpo da resposta (que pode trazer o email do contato).
 */

export type ConfigResend = { chave: string; remetente: string; responderPara: string | null }

export type TipoErroResend = 'credencial' | 'limite' | 'invalido' | 'nao_encontrado' | 'rede' | 'servidor'

const MENSAGENS: Record<TipoErroResend, string> = {
  credencial: 'chave do Resend inválida ou sem permissão',
  limite: 'limite de requisições do Resend atingido; tente de novo mais tarde',
  invalido: 'o Resend recusou os dados enviados',
  nao_encontrado: 'recurso não encontrado no Resend',
  rede: 'o Resend não respondeu; tente de novo',
  servidor: 'o Resend está indisponível; tente de novo',
}

export class ErroResend extends Error {
  tipo: TipoErroResend
  constructor(tipo: TipoErroResend) {
    super(MENSAGENS[tipo])
    this.name = 'ErroResend'
    this.tipo = tipo
  }
}

const BASE = 'https://api.resend.com'
const TIMEOUT_MS = 20_000
const ESPERA_MAX_429_MS = 2_000

export function configResend(env: NodeJS.ProcessEnv = process.env): ConfigResend | null {
  const chave = env.RESEND_API_KEY?.trim()
  const remetente = env.RESEND_REMETENTE?.trim()
  if (!chave || !remetente) return null
  return { chave, remetente, responderPara: env.RESEND_RESPONDER_PARA?.trim() || null }
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function espera429(resp: Response): number {
  const segundos = Number(resp.headers.get('retry-after'))
  const ms = Number.isFinite(segundos) && segundos >= 0 ? segundos * 1000 : ESPERA_MAX_429_MS
  return Math.min(ms, ESPERA_MAX_429_MS)
}

export function criarClienteResend(cfg: ConfigResend, f: typeof fetch = fetch) {
  async function chamar(
    metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    caminho: string,
    opts: { json?: unknown; idempotencia?: string; aceitar404?: boolean } = {},
  ): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = { Authorization: `Bearer ${cfg.chave}`, Accept: 'application/json' }
    if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.idempotencia) headers['Idempotency-Key'] = opts.idempotencia
    const body = opts.json === undefined ? undefined : JSON.stringify(opts.json)

    for (let tentativa = 0; ; tentativa++) {
      let resp: Response
      try {
        resp = await f(`${BASE}${caminho}`, { method: metodo, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) })
      } catch {
        throw new ErroResend('rede')
      }
      if (resp.status === 429) {
        if (tentativa === 0) {
          await new Promise((r) => setTimeout(r, espera429(resp)))
          continue
        }
        throw new ErroResend('limite')
      }
      let json: unknown = null
      const texto = await resp.text().catch(() => '')
      if (texto) {
        try {
          json = JSON.parse(texto)
        } catch {
          json = null
        }
      }
      if (resp.ok) return { status: resp.status, json }
      if (resp.status === 404 && opts.aceitar404) return { status: 404, json: null }
      if (resp.status === 401 || resp.status === 403) throw new ErroResend('credencial')
      if (resp.status === 404) throw new ErroResend('nao_encontrado')
      if (resp.status >= 500) throw new ErroResend('servidor')
      throw new ErroResend('invalido')
    }
  }

  function lerId(json: unknown): string {
    if (!ehObjeto(json) || typeof json.id !== 'string' || !json.id) throw new ErroResend('servidor')
    return json.id
  }

  const caminhoMembro = (email: string, segmentoId: string) =>
    `/contacts/${encodeURIComponent(email)}/segments/${encodeURIComponent(segmentoId)}`

  return {
    async enviarEmail(e: {
      para: string
      assunto: string
      html: string
      texto: string
      cabecalhos?: Record<string, string>
      chaveIdempotencia: string
      tags?: { name: string; value: string }[]
    }): Promise<{ id: string }> {
      const { json } = await chamar('POST', '/emails', {
        idempotencia: e.chaveIdempotencia,
        json: {
          from: cfg.remetente,
          to: [e.para],
          subject: e.assunto,
          html: e.html,
          text: e.texto,
          ...(cfg.responderPara ? { reply_to: cfg.responderPara } : {}),
          ...(e.cabecalhos ? { headers: e.cabecalhos } : {}),
          ...(e.tags && e.tags.length > 0 ? { tags: e.tags } : {}),
        },
      })
      return { id: lerId(json) }
    },

    /** Atualiza o contato se existir (PATCH por email); senão cria. Nunca falha por "já existe". */
    async salvarContato(c: {
      email: string
      nome: string | null
      descadastrado: boolean
    }): Promise<{ id: string }> {
      const dados = { first_name: c.nome, unsubscribed: c.descadastrado }
      const atualizado = await chamar('PATCH', `/contacts/${encodeURIComponent(c.email)}`, { json: dados, aceitar404: true })
      if (atualizado.status !== 404) return { id: lerId(atualizado.json) }
      const criado = await chamar('POST', '/contacts', {
        json: {
          email: c.email,
          ...dados,
        },
      })
      return { id: lerId(criado.json) }
    },

    async garantirSegmento(nome: string): Promise<{ id: string }> {
      let depois: string | null = null
      for (let pagina = 0; pagina < 50; pagina++) {
        const { json } = await chamar('GET', `/segments?limit=100${depois ? `&after=${encodeURIComponent(depois)}` : ''}`)
        if (!ehObjeto(json) || !Array.isArray(json.data)) throw new ErroResend('servidor')
        let ultimo: string | null = null
        for (const s of json.data) {
          if (!ehObjeto(s) || typeof s.id !== 'string') continue
          if (s.name === nome) return { id: s.id }
          ultimo = s.id
        }
        if (json.has_more !== true || !ultimo) break
        depois = ultimo
      }
      const { json } = await chamar('POST', '/segments', { json: { name: nome } })
      return { id: lerId(json) }
    },

    async adicionarAoSegmento(contatoEmail: string, segmentoId: string): Promise<void> {
      await chamar('POST', caminhoMembro(contatoEmail, segmentoId))
    },

    async removerDoSegmento(contatoEmail: string, segmentoId: string): Promise<void> {
      await chamar('DELETE', caminhoMembro(contatoEmail, segmentoId))
    },

    /** Cria o broadcast como rascunho (sem `send`). O disparo é `enviarBroadcast`. */
    async criarBroadcast(b: {
      segmentoId: string
      nome: string
      assunto: string
      html: string
      texto: string
    }): Promise<{ id: string }> {
      const { json } = await chamar('POST', '/broadcasts', {
        json: {
          segment_id: b.segmentoId,
          name: b.nome,
          from: cfg.remetente,
          ...(cfg.responderPara ? { reply_to: cfg.responderPara } : {}),
          subject: b.assunto,
          html: b.html,
          text: b.texto,
        },
      })
      return { id: lerId(json) }
    },

    /** Reescreve o conteúdo de um broadcast ainda em rascunho. */
    async atualizarBroadcast(
      id: string,
      b: { nome: string; assunto: string; html: string; texto: string },
    ): Promise<void> {
      await chamar('PATCH', `/broadcasts/${encodeURIComponent(id)}`, {
        json: { name: b.nome, from: cfg.remetente, ...(cfg.responderPara ? { reply_to: cfg.responderPara } : {}), subject: b.assunto, html: b.html, text: b.texto },
      })
    },

    async enviarBroadcast(id: string, agendarPara?: Date): Promise<void> {
      await chamar('POST', `/broadcasts/${encodeURIComponent(id)}/send`, {
        json: agendarPara ? { scheduled_at: agendarPara.toISOString() } : {},
      })
    },

    async lerBroadcast(id: string): Promise<{ id: string; status: string }> {
      const { json } = await chamar('GET', `/broadcasts/${encodeURIComponent(id)}`)
      if (!ehObjeto(json) || typeof json.id !== 'string') throw new ErroResend('servidor')
      return { id: json.id, status: typeof json.status === 'string' ? json.status : '' }
    },
  }
}

export type ClienteResend = ReturnType<typeof criarClienteResend>
