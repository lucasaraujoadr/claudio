import { ipDaRequisicao, lerCorpoLimitado, LimitadorPorIp, tokenConfere, tokenDaRequisicao } from '@/lib/webhooks'
import { bancoPadrao, type BancoCrm } from './banco'
import { semAcento } from './campos'
import { registrarEvento, upsertContato } from './contatos'
import { normalizarEmail } from './email'
import { inscreverBoasVindasDoSite } from './ganchos-funis'

/**
 * Webhook do formulário do site (`POST /api/webhooks/site?token=`), feito para a ação
 * "Webhook" do Elementor Forms.
 *
 * O Elementor (modules/forms/actions/webhook.php) envia com `wp_safe_remote_post` e o corpo
 * como array PHP, ou seja, **application/x-www-form-urlencoded**:
 * - simples: `Rótulo do campo=valor` para cada campo e cada metadado, mais `form_id` e
 *   `form_name`;
 * - "Dados avançados" ligado: `form[id]`, `form[name]`, `fields[<id>][id|type|title|value|
 *   raw_value|required]` e `meta[<chave>][title|value]`.
 * Também aceita os dois formatos em JSON (quem usar o filtro `request_args` para mandar
 * JSON, ou outro formulário). O Elementor só considera sucesso a resposta 200.
 */

export const MAX_CORPO_SITE = 64 * 1024
const limitadorPadrao = new LimitadorPorIp(20, 60_000)

type Campo = { chaves: string[]; valor: string; tipo?: string }
export type CampoSite = 'email' | 'nome' | 'telefone' | 'escritorio' | 'cidade' | 'uf' | 'mensagem'
export type FormularioSite = Partial<Record<CampoSite, string>>

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function comoTexto(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(comoTexto).filter((x): x is string => x !== null).join(', ')
  return null
}

/** `fields[nome][value]=x` → `{ fields: { nome: { value: 'x' } } }` (notação de colchetes do PHP). */
export function expandirColchetes(pares: Iterable<[string, string]>): Record<string, unknown> {
  const raiz: Record<string, unknown> = {}
  for (const [chave, valor] of pares) {
    const m = /^([^[\]]+)((?:\[[^\]]*\])*)$/.exec(chave)
    const partes = m && m[2] ? [m[1], ...[...m[2].matchAll(/\[([^\]]*)\]/g)].map((x) => x[1])] : [chave]
    let no: Record<string, unknown> = raiz
    for (let i = 0; i < partes.length - 1; i++) {
      const p = partes[i] || String(Object.keys(no).length)
      const prox = no[p]
      if (ehObjeto(prox)) no = prox
      else {
        const novo: Record<string, unknown> = {}
        no[p] = novo
        no = novo
      }
    }
    const ultima = partes[partes.length - 1] || String(Object.keys(no).length)
    if (!(ultima in no)) no[ultima] = valor
  }
  return raiz
}

const METADADOS = new Set(['form_id', 'form_name', 'form', 'meta', 'token'])

/** Lista de campos (chaves candidatas + valor) a partir do corpo já decodificado. */
export function camposDoCorpo(corpo: Record<string, unknown>): Campo[] {
  const campos: Campo[] = []
  const fields = corpo.fields
  if (ehObjeto(fields) || Array.isArray(fields)) {
    for (const [k, f] of Object.entries(fields)) {
      if (ehObjeto(f)) {
        const valor = comoTexto(f.value) ?? comoTexto(f.raw_value)
        if (valor === null) continue
        const chaves = [k, comoTexto(f.id), comoTexto(f.title)].filter((x): x is string => Boolean(x))
        campos.push({ chaves, valor, tipo: comoTexto(f.type) ?? undefined })
      } else {
        const valor = comoTexto(f)
        if (valor !== null) campos.push({ chaves: [k], valor })
      }
    }
    return campos
  }
  for (const [k, v] of Object.entries(corpo)) {
    if (METADADOS.has(k)) continue
    const valor = comoTexto(v)
    if (valor !== null) campos.push({ chaves: [k], valor })
  }
  return campos
}

function chaveNormalizada(s: string): string {
  return semAcento(s).toLowerCase().replace(/[^a-z0-9]/g, '')
}

const ALIASES: Record<CampoSite, string[]> = {
  email: ['email', 'emailaddress', 'seuemail', 'mail', 'correioeletronico'],
  nome: ['nome', 'name', 'nomecompleto', 'seunome', 'fullname', 'yourname', 'firstname'],
  telefone: ['telefone', 'phone', 'whatsapp', 'celular', 'tel', 'fone', 'telefonewhatsapp', 'whatsapptelefone', 'seutelefone', 'seuwhatsapp', 'telefonecelular'],
  escritorio: ['escritorio', 'empresa', 'company', 'organizacao', 'nomedoescritorio', 'escritorioempresa', 'empresaescritorio', 'razaosocial'],
  cidade: ['cidade', 'city', 'municipio'],
  uf: ['uf', 'estado', 'state'],
  mensagem: ['mensagem', 'message', 'msg', 'comentario', 'comentarios', 'duvida', 'suamensagem', 'observacoes', 'descricao'],
}
/** Se nenhum nome bateu exatamente, aceita um que contenha estes trechos. */
const CONTEM: Record<CampoSite, string[]> = {
  email: ['email'],
  nome: ['nome'],
  telefone: ['telefone', 'whatsapp', 'celular', 'phone'],
  escritorio: ['escritorio', 'empresa'],
  cidade: ['cidade'],
  uf: [],
  mensagem: ['mensagem', 'message'],
}
const TIPO: Partial<Record<CampoSite, string>> = { email: 'email', telefone: 'tel', mensagem: 'textarea' }

export function mapearFormulario(campos: Campo[]): FormularioSite {
  const r: FormularioSite = {}
  const usados = new Set<Campo>()
  const achar = (alvo: CampoSite, teste: (c: Campo, chaves: string[]) => boolean) => {
    if (r[alvo]) return
    for (const c of campos) {
      if (usados.has(c) || !c.valor.trim()) continue
      if (teste(c, c.chaves.map(chaveNormalizada))) {
        r[alvo] = c.valor.trim()
        usados.add(c)
        return
      }
    }
  }
  const alvos = Object.keys(ALIASES) as CampoSite[]
  for (const a of alvos) achar(a, (_c, ks) => ks.some((k) => ALIASES[a].includes(k)))
  for (const a of alvos) if (TIPO[a]) achar(a, (c) => c.tipo === TIPO[a])
  for (const a of alvos) achar(a, (_c, ks) => ks.some((k) => CONTEM[a].some((t) => k.includes(t))))
  return r
}

export function lerFormulario(texto: string, contentType: string | null): FormularioSite | null {
  const tipo = (contentType ?? '').toLowerCase()
  let corpo: unknown
  if (tipo.includes('json') || /^\s*[{[]/.test(texto)) {
    try {
      corpo = JSON.parse(texto)
    } catch {
      return null
    }
  } else {
    corpo = expandirColchetes(new URLSearchParams(texto).entries())
  }
  if (!ehObjeto(corpo)) return null
  return mapearFormulario(camposDoCorpo(corpo))
}

function json(status: number, corpo: Record<string, unknown>): Response {
  return Response.json(corpo, { status })
}

export type OpcoesWebhookSite = {
  db?: BancoCrm
  token?: string | null
  limitador?: LimitadorPorIp
  agora?: Date
}

export async function tratarWebhookSite(request: Request, opts: OpcoesWebhookSite = {}): Promise<Response> {
  const limitador = opts.limitador ?? limitadorPadrao
  if (!limitador.permitir(ipDaRequisicao(request))) {
    return Response.json({ erro: 'Muitas requisições; tente em um minuto' }, { status: 429, headers: { 'retry-after': '60' } })
  }
  const esperado = opts.token === undefined ? process.env.SITE_WEBHOOK_TOKEN : opts.token
  if (!tokenConfere(tokenDaRequisicao(request), esperado)) return json(401, { erro: 'Não autorizado' })

  const corpo = await lerCorpoLimitado(request, MAX_CORPO_SITE)
  if (!corpo.ok) {
    return corpo.motivo === 'grande' ? json(413, { erro: 'Corpo grande demais (máx. 64 KB)' }) : json(400, { erro: 'Corpo ilegível' })
  }
  const form = lerFormulario(corpo.texto, request.headers.get('content-type'))
  if (!form) return json(400, { erro: 'Formato inesperado' })
  const email = normalizarEmail(form.email ?? '')
  if (!email) return json(400, { erro: 'E-mail ausente ou inválido' })

  const db = opts.db ?? bancoPadrao()
  const agora = opts.agora ?? new Date()
  const r = await upsertContato(
    {
      email: form.email!,
      nome: form.nome?.slice(0, 200),
      telefone: form.telefone?.slice(0, 60),
      escritorio: form.escritorio?.slice(0, 200),
      cidade: form.cidade?.slice(0, 120),
      uf: form.uf,
      baseLegal: 'consentimento',
      consentimentoEm: agora,
    },
    'site',
    { db, agora },
  )
  if (r.acao === 'ignorado' && r.contatoId === undefined) return json(400, { erro: 'Contato não aceito' })
  const contatoId = r.contatoId!
  const mensagem = form.mensagem?.slice(0, 5000)
  await registrarEvento(contatoId, 'formulario', { origem: 'site', ...(mensagem ? { mensagem } : {}) }, { db, em: agora })
  // Funil de boas-vindas (E9). O gancho não faz nada hoje e precisa ignorar descadastrados.
  await inscreverBoasVindasDoSite(contatoId, { db })
  return json(200, { ok: true })
}
