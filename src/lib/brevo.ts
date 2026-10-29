/**
 * Cliente da API v3 do Brevo (https://developers.brevo.com/reference).
 *
 * Endpoints usados (conferidos na referência oficial em 29/10/2026):
 * - `POST /v3/contacts` (`updateEnabled: true`): cria ou atualiza; 201 `{id}` ao criar, 204 ao atualizar.
 * - `GET /v3/contacts/{email}`: id, `emailBlacklisted`, `listIds`.
 * - `PUT /v3/contacts/{email}`: `unlinkListIds` (tirar de listas), `emailBlacklisted`; 204.
 * - `GET /v3/contacts?limit&offset`: lista paginada (limite até 1000).
 * - `POST /v3/contacts/lists/{id}/contacts/add` e `/remove` com `{emails}`.
 * - `POST /v3/emailCampaigns`: cria a campanha como **rascunho** (sem `scheduledAt` ela não é
 *   agendada; este cliente nunca chama `sendNow`).
 *
 * Autenticação pelo cabeçalho `api-key`. Sem `BREVO_API_KEY`, toda operação devolve
 * `{ ok: false, motivo: 'nao_conectado' }` — nunca lança, para que nenhuma rota vire 500.
 * As mensagens de erro são em pt-BR e nunca repetem a mensagem do Brevo (que pode trazer o
 * email do contato): só o status HTTP e o código de erro.
 */

export const BREVO_URL_BASE = 'https://api.brevo.com/v3'
export const MENSAGEM_NAO_CONECTADO = 'Brevo não conectado'
const TIMEOUT_PADRAO_MS = 15_000
/** A referência não fixa um máximo por chamada de lista; 150 é conservador. */
export const MAX_EMAILS_POR_CHAMADA_LISTA = 150
export const MAX_LIMITE_LISTAGEM = 1000

/**
 * Atributos que o painel grava no Brevo. Nomes em maiúsculas (exigência da API); precisam
 * existir na conta (Contatos → Configurações → Atributos de contato, tipo Texto).
 * O telefone vai num atributo de texto, não no `SMS` do Brevo, que rejeita o contato
 * inteiro se o número não estiver no formato internacional.
 */
export const ATRIBUTOS_BREVO = ['NOME', 'TELEFONE', 'ESCRITORIO', 'CIDADE', 'UF'] as const
export type AtributoBrevo = (typeof ATRIBUTOS_BREVO)[number]
export type AtributosBrevo = Partial<Record<AtributoBrevo, string>>

export type ErroBrevo = {
  ok: false
  motivo: 'nao_conectado' | 'http' | 'timeout' | 'rede' | 'resposta_invalida'
  mensagem: string
  status?: number
  codigo?: string
}
export type ResultadoBrevo<T> = { ok: true; dados: T } | ErroBrevo

export type ContatoBrevo = {
  id: number
  email: string | null
  emailBlacklisted: boolean
  listIds: number[]
  atributos: Record<string, unknown>
}

export type EntradaContatoBrevo = {
  email: string
  atributos: AtributosBrevo
  /** Só `true` é enviado: o painel nunca tira um contato da lista de bloqueio do Brevo. */
  emailBlacklisted?: true
  listIds?: number[]
}

export type RascunhoCampanha = {
  nome: string
  assunto: string
  remetente: { nome?: string; email: string } | { nome?: string; id: number }
  html: string
  previewText?: string
  listIds: number[]
}

export type OpcoesClienteBrevo = {
  /** Padrão: `process.env.BREVO_API_KEY`. */
  apiKey?: string | null
  fetch?: typeof fetch
  timeoutMs?: number
  urlBase?: string
}

export type ClienteBrevo = {
  conectado: boolean
  upsertContato(c: EntradaContatoBrevo): Promise<ResultadoBrevo<{ id: number | null; criado: boolean }>>
  obterContato(email: string): Promise<ResultadoBrevo<ContatoBrevo | null>>
  atualizarContato(
    email: string,
    dados: { unlinkListIds?: number[]; emailBlacklisted?: true; atributos?: AtributosBrevo },
  ): Promise<ResultadoBrevo<null>>
  adicionarALista(listaId: number, emails: string[]): Promise<ResultadoBrevo<{ sucesso: string[]; falha: string[] }>>
  removerDaLista(listaId: number, emails: string[]): Promise<ResultadoBrevo<{ sucesso: string[]; falha: string[] }>>
  listarContatos(p?: { limite?: number; offset?: number }): Promise<ResultadoBrevo<{ contatos: ContatoBrevo[]; total: number | null }>>
  criarRascunhoCampanha(c: RascunhoCampanha): Promise<ResultadoBrevo<{ id: number }>>
}

export function brevoConfigurado(): boolean {
  return Boolean(process.env.BREVO_API_KEY?.trim())
}

function mensagemHttp(status: number, codigo?: string): string {
  const cod = codigo ? ` (código ${codigo})` : ''
  if (status === 401) return 'O Brevo recusou a chave de API (401). Confira BREVO_API_KEY.'
  if (status === 403) return 'A chave do Brevo não tem permissão para esta operação (403).'
  if (status === 404) return `Recurso não encontrado no Brevo (404)${cod}.`
  if (status === 429) return 'Limite de requisições do Brevo atingido (429). Tente de novo mais tarde.'
  if (status === 425) return 'O Brevo ainda está processando a conta (425). Tente de novo mais tarde.'
  if (status >= 500) return `O Brevo está indisponível (${status}). Tente de novo mais tarde.`
  return `O Brevo recusou os dados (${status})${cod}.`
}

function naoConectado(): ErroBrevo {
  return { ok: false, motivo: 'nao_conectado', mensagem: MENSAGEM_NAO_CONECTADO }
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function lerContato(v: unknown): ContatoBrevo | null {
  if (!ehObjeto(v) || typeof v.id !== 'number') return null
  return {
    id: v.id,
    email: typeof v.email === 'string' ? v.email : null,
    emailBlacklisted: v.emailBlacklisted === true,
    listIds: Array.isArray(v.listIds) ? v.listIds.filter((n): n is number => typeof n === 'number') : [],
    atributos: ehObjeto(v.attributes) ? v.attributes : {},
  }
}

function lerIdentificadores(v: unknown): { sucesso: string[]; falha: string[] } {
  // A referência mostra `success`/`failure` ora dentro de `contacts`, ora no topo.
  const base = ehObjeto(v) && ehObjeto(v.contacts) ? v.contacts : ehObjeto(v) ? v : {}
  const lista = (x: unknown) => (Array.isArray(x) ? x.map((i) => String(i)) : [])
  return { sucesso: lista(base.success), falha: lista(base.failure) }
}

export function criarClienteBrevo(opts: OpcoesClienteBrevo = {}): ClienteBrevo {
  const chave = (opts.apiKey === undefined ? process.env.BREVO_API_KEY : opts.apiKey)?.trim() || null
  const f = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_PADRAO_MS
  const urlBase = opts.urlBase ?? BREVO_URL_BASE

  async function chamar(
    metodo: 'GET' | 'POST' | 'PUT',
    caminho: string,
    corpo?: unknown,
    aceitar404 = false,
  ): Promise<ResultadoBrevo<{ status: number; json: unknown }>> {
    if (!chave) return naoConectado()
    let resp: Response
    try {
      resp = await f(`${urlBase}${caminho}`, {
        method: metodo,
        headers: {
          'api-key': chave,
          accept: 'application/json',
          ...(corpo === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      const nome = e instanceof Error ? e.name : ''
      if (nome === 'TimeoutError' || nome === 'AbortError') {
        return { ok: false, motivo: 'timeout', mensagem: `O Brevo não respondeu em ${Math.round(timeoutMs / 1000)} s.` }
      }
      return { ok: false, motivo: 'rede', mensagem: 'Falha de rede ao falar com o Brevo.' }
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
    if (resp.ok || (aceitar404 && resp.status === 404)) return { ok: true, dados: { status: resp.status, json } }
    const codigo = ehObjeto(json) && typeof json.code === 'string' ? json.code.slice(0, 60) : undefined
    return { ok: false, motivo: 'http', status: resp.status, codigo, mensagem: mensagemHttp(resp.status, codigo) }
  }

  const caminhoContato = (email: string) => `/contacts/${encodeURIComponent(email)}`

  async function operacaoLista(acao: 'add' | 'remove', listaId: number, emails: string[]) {
    const sucesso: string[] = []
    const falha: string[] = []
    for (let i = 0; i < emails.length; i += MAX_EMAILS_POR_CHAMADA_LISTA) {
      const r = await chamar('POST', `/contacts/lists/${listaId}/contacts/${acao}`, {
        emails: emails.slice(i, i + MAX_EMAILS_POR_CHAMADA_LISTA),
      })
      if (!r.ok) return r
      const ids = lerIdentificadores(r.dados.json)
      sucesso.push(...ids.sucesso)
      falha.push(...ids.falha)
    }
    return { ok: true as const, dados: { sucesso, falha } }
  }

  return {
    conectado: chave !== null,

    async upsertContato(c) {
      const r = await chamar('POST', '/contacts', {
        email: c.email,
        attributes: c.atributos,
        updateEnabled: true,
        ...(c.emailBlacklisted ? { emailBlacklisted: true } : {}),
        ...(c.listIds && c.listIds.length > 0 ? { listIds: c.listIds } : {}),
      })
      if (!r.ok) return r
      const id = ehObjeto(r.dados.json) && typeof r.dados.json.id === 'number' ? r.dados.json.id : null
      return { ok: true, dados: { id, criado: r.dados.status === 201 } }
    },

    async obterContato(email) {
      const r = await chamar('GET', caminhoContato(email), undefined, true)
      if (!r.ok) return r
      if (r.dados.status === 404) return { ok: true, dados: null }
      const c = lerContato(r.dados.json)
      if (!c) return { ok: false, motivo: 'resposta_invalida', mensagem: 'Resposta inesperada do Brevo ao ler um contato.' }
      return { ok: true, dados: c }
    },

    async atualizarContato(email, dados) {
      const r = await chamar('PUT', caminhoContato(email), {
        ...(dados.unlinkListIds && dados.unlinkListIds.length > 0 ? { unlinkListIds: dados.unlinkListIds } : {}),
        ...(dados.emailBlacklisted ? { emailBlacklisted: true } : {}),
        ...(dados.atributos ? { attributes: dados.atributos } : {}),
      })
      if (!r.ok) return r
      return { ok: true, dados: null }
    },

    adicionarALista: (listaId, emails) => operacaoLista('add', listaId, emails),
    removerDaLista: (listaId, emails) => operacaoLista('remove', listaId, emails),

    async listarContatos(p = {}) {
      const limite = Math.min(Math.max(1, Math.trunc(p.limite ?? 500)), MAX_LIMITE_LISTAGEM)
      const offset = Math.max(0, Math.trunc(p.offset ?? 0))
      const r = await chamar('GET', `/contacts?limit=${limite}&offset=${offset}&sort=asc`)
      if (!r.ok) return r
      const j = r.dados.json
      if (!ehObjeto(j) || !Array.isArray(j.contacts)) {
        return { ok: false, motivo: 'resposta_invalida', mensagem: 'Resposta inesperada do Brevo ao listar contatos.' }
      }
      const contatos = j.contacts.map(lerContato).filter((c): c is ContatoBrevo => c !== null)
      return { ok: true, dados: { contatos, total: typeof j.count === 'number' ? j.count : null } }
    },

    async criarRascunhoCampanha(c) {
      const remetente = 'id' in c.remetente
        ? { id: c.remetente.id, ...(c.remetente.nome ? { name: c.remetente.nome } : {}) }
        : { email: c.remetente.email, ...(c.remetente.nome ? { name: c.remetente.nome } : {}) }
      // Sem `scheduledAt`: o Brevo cria em rascunho. Nunca chamar /sendNow daqui.
      const r = await chamar('POST', '/emailCampaigns', {
        name: c.nome,
        subject: c.assunto,
        sender: remetente,
        htmlContent: c.html,
        ...(c.previewText ? { previewText: c.previewText } : {}),
        recipients: { listIds: c.listIds },
      })
      if (!r.ok) return r
      const j = r.dados.json
      if (!ehObjeto(j) || typeof j.id !== 'number') {
        return { ok: false, motivo: 'resposta_invalida', mensagem: 'Resposta inesperada do Brevo ao criar a campanha.' }
      }
      return { ok: true, dados: { id: j.id } }
    },
  }
}
