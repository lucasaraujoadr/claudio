import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm'
import { acessoPublicoOk } from '@/lib/acesso-publico'
import { contatos, funilInscricoes, funis, sincronizacoes, type Contato } from '@/lib/db/schema'
import { configResend, criarClienteResend, ErroResend, type ClienteResend } from '@/lib/resend'
import { bancoPadrao, type BancoCrm } from './banco'
import { INTERROMPIDO_POR_TEMPO } from './funis'

/**
 * Sincronização CRM → Resend (contatos e segmento da newsletter). O CRM é a fonte da verdade.
 *
 * Minimização (LGPD): para o Resend vai só email e nome (`salvarContato`); nunca telefone,
 * cidade, escritório, notas ou tags. Contato com `dadosApagadosEm` guarda só o email como
 * supressão: vai como `descadastrado: true`, sem nome, e o id do Resend não é gravado.
 * Descadastrado e apagado nunca são adicionados ao segmento: o único caminho para
 * `adicionarAoSegmento` é o contato elegível (`elegivelNewsletter`).
 *
 * Nada aqui registra dado de contato em log nem em `sync_erro`: as mensagens gravadas são
 * frases fixas.
 */

export const SEGMENTO_NEWSLETTER = 'Newsletter — OG'
export const FONTE_SINCRONIZACAO = 'resend-contatos'
export const MENSAGEM_NAO_CONECTADO = 'Resend não configurado'
const MENSAGEM_ERRO_GENERICO = 'falha ao sincronizar com o Resend'

export type ResultadoSincronizacao =
  | { conectado: false; mensagem: typeof MENSAGEM_NAO_CONECTADO }
  | {
      conectado: true
      enviados: number
      erros: number
      /** Ainda pendentes ou com erro depois desta execução. */
      restantes: number
      /** Frase do erro que parou a execução (chave recusada, Resend fora do ar…). */
      interrompido: string | null
    }

export type ClienteContatos = Pick<ClienteResend, 'salvarContato' | 'garantirSegmento' | 'adicionarAoSegmento' | 'removerDoSegmento'>

export type OpcoesSincronizacao = {
  db?: BancoCrm
  /** Cliente do Resend. Omitido: `configResend()`; `null` = sem chave (nada é feito). */
  cliente?: ClienteContatos | null
  /** Máximo de contatos por execução (cabe no tempo de uma função da Vercel). */
  limite?: number
  /** Contatos lidos do banco por vez. */
  tamanhoLote?: number
  agora?: Date
  /** Grava o resultado em `sincronizacoes` (padrão: sim). */
  registrar?: boolean
  /** Só estes contatos (envio imediato de um lead do site). */
  ids?: readonly number[]
  /** Checado entre contatos: `true` para parar (prazo da rotina diária). */
  deveParar?: () => boolean
}

/** Quem entra no segmento: lead/cliente, consentimento/contrato, não apagado e na nutrição. */
export function elegivelNewsletter(
  c: Pick<Contato, 'status' | 'baseLegal' | 'dadosApagadosEm'>,
  inscricaoNutricaoAtiva: boolean,
): boolean {
  return (
    inscricaoNutricaoAtiva &&
    !c.dadosApagadosEm &&
    (c.status === 'lead' || c.status === 'cliente') &&
    (c.baseLegal === 'consentimento' || c.baseLegal === 'contrato')
  )
}

/** Erros que valem para todos os contatos: não adianta continuar. */
function erroGeral(e: unknown): e is ErroResend {
  return e instanceof ErroResend && (e.tipo === 'credencial' || e.tipo === 'limite' || e.tipo === 'rede' || e.tipo === 'servidor')
}

/** `null` quando o contato não existia no Resend (já estava fora do segmento). */
async function removerTolerante(cliente: ClienteContatos, email: string, segmentoId: string) {
  try {
    await cliente.removerDoSegmento(email, segmentoId)
  } catch (e) {
    if (!(e instanceof ErroResend && e.tipo === 'nao_encontrado')) throw e
  }
}

/** Faz o que o Resend precisa para este contato. Devolve o id do contato no Resend, se guardável. */
async function enviarContato(cliente: ClienteContatos, segmentoId: string, c: Contato, naNutricao: boolean): Promise<string | null> {
  const email = c.emailNormalizado
  if (c.dadosApagadosEm) {
    // Só a supressão: sem nome, e o id não é guardado.
    await cliente.salvarContato({ email, nome: null, descadastrado: true })
    await removerTolerante(cliente, email, segmentoId)
    return null
  }
  const nome = c.nome.trim() || null
  if (c.status === 'descadastrado') {
    const { id } = await cliente.salvarContato({ email, nome, descadastrado: true })
    await removerTolerante(cliente, email, segmentoId)
    return id
  }
  if (elegivelNewsletter(c, naNutricao)) {
    const { id } = await cliente.salvarContato({ email, nome, descadastrado: false })
    await cliente.adicionarAoSegmento(email, segmentoId)
    return id
  }
  await removerTolerante(cliente, email, segmentoId)
  return c.resendContatoId
}

/**
 * Grava o resultado só se o contato não mudou desde a leitura: uma edição no meio da
 * sincronização deixa o contato `pendente` para a próxima rodada.
 */
async function marcar(db: BancoCrm, c: Contato, set: Partial<Pick<Contato, 'syncStatus' | 'syncErro' | 'resendContatoId'>>) {
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

async function idsNaNutricao(db: BancoCrm, ids: readonly number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set()
  const r = await db
    .select({ id: funilInscricoes.contatoId })
    .from(funilInscricoes)
    .innerJoin(funis, eq(funis.id, funilInscricoes.funilId))
    .where(and(eq(funis.slug, 'nutricao-blog'), eq(funilInscricoes.status, 'ativo'), inArray(funilInscricoes.contatoId, [...ids])))
  return new Set(r.map((x) => x.id))
}

async function registrarExecucao(db: BancoCrm, status: 'ok' | 'erro' | 'parcial', mensagem: string, linhas: number, agora: Date) {
  await db
    .insert(sincronizacoes)
    .values({ fonte: FONTE_SINCRONIZACAO, status, mensagem, executadoEm: agora, linhas, ...(status === 'ok' ? { ultimoOkEm: agora } : {}) })
    .onConflictDoUpdate({
      target: sincronizacoes.fonte,
      set: { status, mensagem, executadoEm: agora, linhas, ...(status === 'ok' ? { ultimoOkEm: agora } : {}) },
    })
}

function clientePadrao(): ClienteResend | null {
  const cfg = configResend()
  return cfg ? criarClienteResend(cfg) : null
}

/**
 * Envia ao Resend os contatos `pendente` (e os que deram `erro` antes), em lotes: elegíveis
 * entram no segmento da newsletter; os demais saem dele (descadastrado e apagado também ficam
 * `unsubscribed`). Sem chave: não faz nada.
 */
export async function sincronizarPendentes(opts: OpcoesSincronizacao = {}): Promise<ResultadoSincronizacao> {
  const cliente = opts.cliente !== undefined ? opts.cliente : clientePadrao()
  if (!cliente) return { conectado: false, mensagem: MENSAGEM_NAO_CONECTADO }
  const db = opts.db ?? bancoPadrao()
  const limite = opts.limite ?? 200
  const tamanhoLote = opts.tamanhoLote ?? 50

  let enviados = 0
  let erros = 0
  let interrompido: string | null = null
  let processados = 0
  let segmentoId: string | null = null

  // `pendente` antes de `erro`: contatos que falham sempre (ids baixos) não podem tomar o
  // teto da execução e deixar os novos para trás. Cada fase tem o seu cursor.
  const tentados = new Set<number>()
  for (const fase of ['pendente', 'erro'] as const) {
    let ultimoId = 0
    while (processados < limite && !interrompido) {
      if (opts.deveParar?.()) {
        interrompido = INTERROMPIDO_POR_TEMPO
        break
      }
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
      if (novos.length === 0) continue

      try {
        segmentoId ??= (await cliente.garantirSegmento(SEGMENTO_NEWSLETTER)).id
      } catch (e) {
        interrompido = e instanceof ErroResend ? e.message : MENSAGEM_ERRO_GENERICO
        break
      }
      const naNutricao = await idsNaNutricao(db, novos.map((c) => c.id))

      for (const c of novos) {
        if (opts.deveParar?.()) {
          interrompido = INTERROMPIDO_POR_TEMPO
          break
        }
        try {
          const resendId = await enviarContato(cliente, segmentoId, c, naNutricao.has(c.id))
          await marcar(db, c, { syncStatus: 'sincronizado', syncErro: null, resendContatoId: resendId })
          enviados++
        } catch (e) {
          if (erroGeral(e)) {
            interrompido = e.message // o contato continua como estava, para a próxima rodada
            break
          }
          await marcar(db, c, { syncStatus: 'erro', syncErro: e instanceof ErroResend ? e.message : MENSAGEM_ERRO_GENERICO })
          erros++
        }
      }
    }
  }

  const restantes = await contarRestantes(db)
  if (opts.registrar !== false) {
    const status = interrompido ? 'erro' : erros > 0 || restantes > 0 ? 'parcial' : 'ok'
    const mensagem = interrompido
      ? `Interrompido: ${interrompido}. Enviados: ${enviados}.`
      : `Enviados: ${enviados}; com erro: ${erros}; restantes: ${restantes}.`
    await registrarExecucao(db, status, mensagem, enviados, opts.agora ?? new Date())
  }
  return { conectado: true, enviados, erros, restantes, interrompido }
}

export type EstadoIntegracao = {
  conectado: boolean
  /** `null`: não conectado ou a checagem falhou. */
  acessoPublico: boolean | null
  pendentes: number
  erros: number
  ultimoSync: typeof sincronizacoes.$inferSelect | null
}

/** Dados da tela de integração: fila de sincronização, última execução e acesso público. */
export async function estadoIntegracao(
  opts: { db?: BancoCrm; conectado?: boolean; acessoPublico?: () => Promise<boolean> } = {},
): Promise<EstadoIntegracao> {
  const db = opts.db ?? bancoPadrao()
  const conectado = opts.conectado ?? configResend() !== null
  const [linhas, execucoes, acesso] = await Promise.all([
    db.select({ s: contatos.syncStatus, n: sql<number>`count(*)::int` }).from(contatos).groupBy(contatos.syncStatus),
    db.select().from(sincronizacoes).where(eq(sincronizacoes.fonte, FONTE_SINCRONIZACAO)),
    // Não depende da chave do Resend: o alerta de proteção da Vercel vale antes de conectar.
    (opts.acessoPublico ?? (() => acessoPublicoOk()))().catch(() => null),
  ])
  const n = (s: Contato['syncStatus']) => Number(linhas.find((l) => l.s === s)?.n ?? 0)
  return { conectado, acessoPublico: acesso, pendentes: n('pendente'), erros: n('erro'), ultimoSync: execucoes[0] ?? null }
}
