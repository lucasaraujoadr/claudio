import { and, asc, eq, gt, inArray, ne, or, sql } from 'drizzle-orm'
import {
  criarClienteBrevo,
  MENSAGEM_NAO_CONECTADO,
  type AtributosBrevo,
  type ClienteBrevo,
  type ContatoBrevo,
  type ErroBrevo,
} from '@/lib/brevo'
import { contatos, sincronizacoes, type Contato } from '@/lib/db/schema'
import { bancoPadrao, type BancoCrm } from './banco'
import type { BaseLegal, DadosContato } from './campos'
import { upsertContatos } from './contatos'

/**
 * Sincronização CRM → Brevo. O CRM é a fonte da verdade; o Brevo só envia.
 *
 * Regra de LGPD (Review Focus 3): contato `descadastrado` nunca é adicionado a lista do
 * Brevo. Na sincronização ele vai com `emailBlacklisted: true`, sem `listIds`, e é tirado de
 * toda lista em que estiver. Para pôr contatos numa lista, o único caminho é
 * `adicionarContatosALista`, que filtra os descadastrados no próprio SELECT.
 *
 * Nada aqui registra dado de contato em log; `sync_erro` guarda só a mensagem do cliente
 * (status HTTP e código do Brevo, sem email).
 */

export const FONTE_SINCRONIZACAO = 'brevo'
export const FONTE_IMPORTACAO_BREVO = 'brevo-importacao'

export type ResultadoSincronizacao =
  | { conectado: false; mensagem: typeof MENSAGEM_NAO_CONECTADO }
  | {
      conectado: true
      enviados: number
      erros: number
      /** Ainda pendentes ou com erro depois desta execução. */
      restantes: number
      /** Mensagem do erro que parou a execução (chave recusada, Brevo fora do ar…). */
      interrompido: string | null
    }

export type OpcoesSincronizacao = {
  db?: BancoCrm
  cliente?: ClienteBrevo
  /** Máximo de contatos por execução (cabe no tempo de uma função da Vercel). */
  limite?: number
  /** Contatos lidos do banco por vez. */
  tamanhoLote?: number
  /** Chamadas simultâneas ao Brevo dentro de um lote. */
  paralelo?: number
  agora?: Date
  /** Grava o resultado em `sincronizacoes` (padrão: sim). */
  registrar?: boolean
  /** Só estes contatos (envio imediato de um lead do site, E9). */
  ids?: readonly number[]
}

/** Erros que valem para todos os contatos: não adianta continuar. */
function erroGeral(e: ErroBrevo): boolean {
  if (e.motivo === 'timeout' || e.motivo === 'rede' || e.motivo === 'nao_conectado') return true
  return e.motivo === 'http' && (e.status === 401 || e.status === 403 || e.status === 425 || e.status === 429 || (e.status ?? 0) >= 500)
}

/**
 * Atributos enviados ao Brevo. Campo vazio no CRM (inclusive `nome = ''`) é omitido, nunca
 * enviado como texto vazio: assim o painel não apaga no Brevo um dado que só falta aqui.
 */
export function atributosDoContato(c: Pick<Contato, 'nome' | 'telefone' | 'escritorio' | 'cidade' | 'uf'>): AtributosBrevo {
  const a: AtributosBrevo = {}
  const por = (k: keyof AtributosBrevo, v: string | null) => {
    const t = v?.trim()
    if (t) a[k] = t
  }
  por('NOME', c.nome)
  por('TELEFONE', c.telefone)
  por('ESCRITORIO', c.escritorio)
  por('CIDADE', c.cidade)
  por('UF', c.uf)
  return a
}

type Envio = { ok: true; brevoId: string | null } | { ok: false; erro: ErroBrevo }

async function enviarContato(cliente: ClienteBrevo, c: Contato): Promise<Envio> {
  const email = c.emailNormalizado
  const atributos = atributosDoContato(c)

  if (c.status === 'descadastrado') {
    // Nunca `listIds` aqui. Bloqueia para email e tira de toda lista.
    const r = await cliente.upsertContato({ email, atributos, emailBlacklisted: true })
    if (!r.ok) return { ok: false, erro: r }
    const atual = await cliente.obterContato(email)
    if (!atual.ok) return { ok: false, erro: atual }
    if (atual.dados && atual.dados.listIds.length > 0) {
      const u = await cliente.atualizarContato(email, { unlinkListIds: atual.dados.listIds, emailBlacklisted: true })
      if (!u.ok) return { ok: false, erro: u }
    }
    const id = r.dados.id ?? atual.dados?.id ?? null
    return { ok: true, brevoId: id !== null ? String(id) : c.brevoId }
  }

  const r = await cliente.upsertContato({ email, atributos })
  if (!r.ok) return { ok: false, erro: r }
  if (r.dados.id !== null) return { ok: true, brevoId: String(r.dados.id) }
  if (c.brevoId) return { ok: true, brevoId: c.brevoId }
  const atual = await cliente.obterContato(email)
  if (!atual.ok) return { ok: false, erro: atual }
  return { ok: true, brevoId: atual.dados ? String(atual.dados.id) : null }
}

/**
 * Grava o resultado só se o contato não mudou desde a leitura: uma edição no meio da
 * sincronização deixa o contato `pendente` para a próxima rodada.
 */
async function marcar(db: BancoCrm, c: Contato, set: Partial<Pick<Contato, 'syncStatus' | 'syncErro' | 'brevoId'>>) {
  await db
    .update(contatos)
    .set(set)
    .where(
      and(
        eq(contatos.id, c.id),
        eq(contatos.syncStatus, c.syncStatus),
        sql`date_trunc('milliseconds', ${contatos.atualizadoEm}) = ${c.atualizadoEm.toISOString()}::timestamptz`,
      ),
    )
}

const AINDA_PENDENTE = or(eq(contatos.syncStatus, 'pendente'), eq(contatos.syncStatus, 'erro'))

async function contarRestantes(db: BancoCrm): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(contatos).where(AINDA_PENDENTE)
  return Number(r?.n ?? 0)
}

async function registrarExecucao(
  db: BancoCrm,
  fonte: string,
  status: 'ok' | 'erro' | 'parcial',
  mensagem: string,
  linhas: number,
  agora: Date,
) {
  await db
    .insert(sincronizacoes)
    .values({ fonte, status, mensagem, executadoEm: agora, linhas, ...(status === 'ok' ? { ultimoOkEm: agora } : {}) })
    .onConflictDoUpdate({
      target: sincronizacoes.fonte,
      set: { status, mensagem, executadoEm: agora, linhas, ...(status === 'ok' ? { ultimoOkEm: agora } : {}) },
    })
}

/**
 * Envia ao Brevo os contatos `pendente` (e os que deram `erro` antes), em lotes. Sem chave:
 * não faz nada e diz "Brevo não conectado".
 */
export async function sincronizarPendentes(opts: OpcoesSincronizacao = {}): Promise<ResultadoSincronizacao> {
  const cliente = opts.cliente ?? criarClienteBrevo()
  if (!cliente.conectado) return { conectado: false, mensagem: MENSAGEM_NAO_CONECTADO }
  const db = opts.db ?? bancoPadrao()
  const limite = opts.limite ?? 200
  const tamanhoLote = opts.tamanhoLote ?? 50
  const paralelo = Math.max(1, opts.paralelo ?? 5)

  let enviados = 0
  let erros = 0
  let interrompido: string | null = null
  let ultimoId = 0
  let processados = 0

  // `pendente` antes de `erro`: contatos que falham sempre (ids baixos) não podem tomar o
  // teto da execução e deixar os novos para trás. Cada fase tem o seu cursor.
  const tentados = new Set<number>()
  for (const fase of ['pendente', 'erro'] as const) {
    ultimoId = 0
    while (processados < limite && !interrompido) {
      const lote = await db
        .select()
        .from(contatos)
        .where(
          and(
            eq(contatos.syncStatus, fase),
            gt(contatos.id, ultimoId),
            opts.ids ? inArray(contatos.id, opts.ids.length > 0 ? [...opts.ids] : [-1]) : undefined,
          ),
        )
        .orderBy(asc(contatos.id))
        .limit(Math.min(tamanhoLote, limite - processados))
      if (lote.length === 0) break
      ultimoId = lote[lote.length - 1].id
      // Quem falhou na fase `pendente` desta mesma execução não é tentado de novo.
      const novos = lote.filter((c) => !tentados.has(c.id))
      for (const c of novos) tentados.add(c.id)
      processados += novos.length

      for (let i = 0; i < novos.length && !interrompido; i += paralelo) {
        const grupo = novos.slice(i, i + paralelo)
        const resultados = await Promise.all(grupo.map((c) => enviarContato(cliente, c)))
        for (let j = 0; j < grupo.length; j++) {
          const c = grupo[j]
          const r = resultados[j]
          if (r.ok) {
            await marcar(db, c, { syncStatus: 'sincronizado', syncErro: null, brevoId: r.brevoId })
            enviados++
          } else if (erroGeral(r.erro)) {
            interrompido ??= r.erro.mensagem // o contato continua como estava, para a próxima rodada
          } else {
            await marcar(db, c, { syncStatus: 'erro', syncErro: r.erro.mensagem.slice(0, 200) })
            erros++
          }
        }
      }
    }
  }

  const restantes = await contarRestantes(db)
  if (opts.registrar !== false) {
    const status = interrompido ? 'erro' : erros > 0 || restantes > 0 ? 'parcial' : 'ok'
    const mensagem = interrompido
      ? `Interrompido: ${interrompido} Enviados: ${enviados}.`
      : `Enviados: ${enviados}; com erro: ${erros}; restantes: ${restantes}.`
    await registrarExecucao(db, FONTE_SINCRONIZACAO, status, mensagem, enviados, opts.agora ?? new Date())
  }
  return { conectado: true, enviados, erros, restantes, interrompido }
}

export type ResultadoLista =
  | { ok: true; adicionados: number; recusadosDescadastrados: number; falhas: number }
  | { ok: false; mensagem: string }

/**
 * Único caminho para pôr contatos numa lista do Brevo (funis da E9). Descadastrados são
 * filtrados no SELECT e nunca chegam ao cliente.
 */
export async function adicionarContatosALista(
  listaId: number,
  contatoIds: readonly number[],
  opts: { db?: BancoCrm; cliente?: ClienteBrevo } = {},
): Promise<ResultadoLista> {
  const cliente = opts.cliente ?? criarClienteBrevo()
  if (!cliente.conectado) return { ok: false, mensagem: MENSAGEM_NAO_CONECTADO }
  if (contatoIds.length === 0) return { ok: true, adicionados: 0, recusadosDescadastrados: 0, falhas: 0 }
  const db = opts.db ?? bancoPadrao()
  const ids = [...new Set(contatoIds)]
  const aptos = await db
    .select({ email: contatos.emailNormalizado })
    .from(contatos)
    .where(and(inArray(contatos.id, ids), ne(contatos.status, 'descadastrado')))
  const [{ n: existentes }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contatos)
    .where(inArray(contatos.id, ids))
  const recusados = Number(existentes) - aptos.length
  if (aptos.length === 0) return { ok: true, adicionados: 0, recusadosDescadastrados: recusados, falhas: 0 }
  const r = await cliente.adicionarALista(listaId, aptos.map((a) => a.email))
  if (!r.ok) return { ok: false, mensagem: r.mensagem }
  return { ok: true, adicionados: r.dados.sucesso.length, recusadosDescadastrados: recusados, falhas: r.dados.falha.length }
}

/** Atributos do Brevo → campos do CRM. Aceita os nomes do painel e os padrões do Brevo. */
export function dadosDoContatoBrevo(c: ContatoBrevo, baseLegal: BaseLegal): DadosContato | null {
  if (!c.email) return null
  const a = c.atributos
  const texto = (...chaves: string[]) => {
    for (const k of chaves) {
      const v = a[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
      if (typeof v === 'number') return String(v)
    }
    return null
  }
  const nomeComposto = [texto('FIRSTNAME', 'PRENOM'), texto('LASTNAME', 'NOM', 'SOBRENOME')].filter(Boolean).join(' ')
  return {
    email: c.email,
    nome: texto('NOME') ?? (nomeComposto || null),
    telefone: texto('TELEFONE', 'SMS', 'WHATSAPP'),
    escritorio: texto('ESCRITORIO', 'EMPRESA', 'COMPANY'),
    cidade: texto('CIDADE'),
    uf: texto('UF'),
    baseLegal,
    brevoId: String(c.id),
    // Bloqueado no Brevo (descadastro, bounce, spam) entra/fica como descadastrado.
    status: c.emailBlacklisted ? 'descadastrado' : null,
  }
}

export type ResultadoImportacaoBrevo =
  | { conectado: false; mensagem: typeof MENSAGEM_NAO_CONECTADO }
  | {
      conectado: true
      lidos: number
      criados: number
      atualizados: number
      inalterados: number
      ignorados: number
      /** Parou no teto por execução; rode de novo para continuar. */
      truncado: boolean
      erro: string | null
    }

/**
 * Traz para o CRM os contatos que já existem no Brevo (origem `brevo`). A base legal é
 * escolhida na tela para o lote inteiro, como na planilha. Quem está bloqueado no Brevo
 * entra como `descadastrado`; quem já é descadastrado no CRM continua.
 */
export async function importarDoBrevo(opts: {
  baseLegal: BaseLegal
  db?: BancoCrm
  cliente?: ClienteBrevo
  maxContatos?: number
  porPagina?: number
  agora?: Date
}): Promise<ResultadoImportacaoBrevo> {
  const cliente = opts.cliente ?? criarClienteBrevo()
  if (!cliente.conectado) return { conectado: false, mensagem: MENSAGEM_NAO_CONECTADO }
  const db = opts.db ?? bancoPadrao()
  const max = opts.maxContatos ?? 10_000
  const porPagina = Math.min(opts.porPagina ?? 500, 1000)
  const r = { conectado: true as const, lidos: 0, criados: 0, atualizados: 0, inalterados: 0, ignorados: 0, truncado: false, erro: null as string | null }

  let offset = 0
  for (;;) {
    if (r.lidos >= max) {
      r.truncado = true
      break
    }
    const pedido = Math.min(porPagina, max - r.lidos)
    const pagina = await cliente.listarContatos({ limite: pedido, offset })
    if (!pagina.ok) {
      r.erro = pagina.mensagem
      break
    }
    const itens = pagina.dados.contatos
    if (itens.length === 0) break
    r.lidos += itens.length
    offset += itens.length
    const dados = itens.map((c) => dadosDoContatoBrevo(c, opts.baseLegal)).filter((d): d is DadosContato => d !== null)
    r.ignorados += itens.length - dados.length
    const res = await upsertContatos(dados, 'brevo', { db, agora: opts.agora })
    for (const x of res) {
      if (x.acao === 'criado') r.criados++
      else if (x.acao === 'atualizado') r.atualizados++
      else if (x.acao === 'inalterado') r.inalterados++
      else r.ignorados++
    }
    if (itens.length < pedido) break
  }

  const mensagem = r.erro
    ? `Interrompido: ${r.erro} Lidos: ${r.lidos}.`
    : `Lidos: ${r.lidos}; criados: ${r.criados}; atualizados: ${r.atualizados}; sem mudança: ${r.inalterados}; ignorados: ${r.ignorados}${r.truncado ? '; parou no teto, rode de novo' : ''}.`
  await registrarExecucao(db, FONTE_IMPORTACAO_BREVO, r.erro ? 'erro' : r.truncado ? 'parcial' : 'ok', mensagem, r.lidos, opts.agora ?? new Date())
  return r
}

export type EstadoIntegracao = {
  porSync: Record<Contato['syncStatus'], number>
  ultimaSincronizacao: typeof sincronizacoes.$inferSelect | null
  ultimaImportacao: typeof sincronizacoes.$inferSelect | null
}

/** Dados da tela de integração: contagem por situação de sincronização e últimas execuções. */
export async function estadoIntegracao(opts: { db?: BancoCrm } = {}): Promise<EstadoIntegracao> {
  const db = opts.db ?? bancoPadrao()
  const [linhas, execucoes] = await Promise.all([
    db.select({ s: contatos.syncStatus, n: sql<number>`count(*)::int` }).from(contatos).groupBy(contatos.syncStatus),
    db.select().from(sincronizacoes).where(inArray(sincronizacoes.fonte, [FONTE_SINCRONIZACAO, FONTE_IMPORTACAO_BREVO])),
  ])
  const porSync: Record<Contato['syncStatus'], number> = { pendente: 0, sincronizado: 0, erro: 0 }
  for (const l of linhas) porSync[l.s] = Number(l.n)
  return {
    porSync,
    ultimaSincronizacao: execucoes.find((e) => e.fonte === FONTE_SINCRONIZACAO) ?? null,
    ultimaImportacao: execucoes.find((e) => e.fonte === FONTE_IMPORTACAO_BREVO) ?? null,
  }
}
