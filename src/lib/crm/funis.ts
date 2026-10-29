import { and, asc, desc, eq, gte, inArray, isNotNull, ne, notExists, or, sql } from 'drizzle-orm'
import { criarClienteBrevo, MENSAGEM_NAO_CONECTADO, type ClienteBrevo, type ErroBrevo } from '@/lib/brevo'
import { contatos, eventosContato, funilInscricoes, funis, type Funil, type FunilInscricao } from '@/lib/db/schema'
import { bancoPadrao, type BancoCrm } from './banco'
import type { StatusContato } from './campos'
import { DEFINICOES_FUNIS, nomeListaBrevo, PASTA_BREVO } from './funis-conteudo'
import {
  ehSlugFunil,
  inicioDoDiaBrasilia,
  limiteReativacao,
  MAX_REATIVACAO_POR_DIA,
  podeEntrar,
  prospeccaoLiberada,
  validarLigarProspeccao,
  vagasHoje,
  type CaminhoInscricao,
  type ChecklistLgpd,
  type FunilParaRegra,
  type MotivoRecusa,
  type SlugFunil,
} from './funis-regras'
import { adicionarContatosALista } from './sincronizar'

/**
 * Funis do CRM (E9). O CRM decide quem está em qual funil; cada funil corresponde a uma
 * lista do Brevo, e a automação do Brevo ("contato adicionado à lista") envia os emails.
 *
 * - Entrar num funil grava a inscrição (`lista_sync = pendente`) e o evento `entrou_funil`;
 *   sair grava `saiu_funil` e marca a remoção da lista como pendente.
 * - A lista do Brevo é atualizada por `sincronizarInscricoes`: adicionar passa sempre por
 *   `adicionarContatosALista` (que recusa descadastrados no próprio SELECT); remover usa o
 *   cliente do Brevo. Sem chave ou sem lista conectada, a inscrição fica guardada como
 *   pendente — nunca é erro.
 * - Nada aqui registra dado de contato em log.
 */

const ORDEM_FUNIS: readonly SlugFunil[] = DEFINICOES_FUNIS.map((d) => d.slug)

function ordenar(lista: Funil[]): Funil[] {
  return [...lista].sort((a, b) => ORDEM_FUNIS.indexOf(a.slug as SlugFunil) - ORDEM_FUNIS.indexOf(b.slug as SlugFunil))
}

/**
 * Cria os quatro funis se faltarem. Idempotente: num funil existente só atualiza nome,
 * descrição e base legal exigida; ligado/desligado, lista, teto e checklist são do usuário.
 */
export async function garantirFunis(opts: { db?: BancoCrm } = {}): Promise<Funil[]> {
  const db = opts.db ?? bancoPadrao()
  for (const d of DEFINICOES_FUNIS) {
    await db
      .insert(funis)
      .values({ slug: d.slug, nome: d.nome, descricao: d.descricao, ativo: d.ativoInicial, exigeBaseLegal: d.exigeBaseLegal })
      .onConflictDoUpdate({
        target: funis.slug,
        set: { nome: d.nome, descricao: d.descricao, exigeBaseLegal: d.exigeBaseLegal },
        // Não reescreve a linha (nem o `atualizado_em`) quando nada mudou.
        setWhere: sql`${funis.nome} is distinct from ${d.nome} or ${funis.descricao} is distinct from ${d.descricao} or ${funis.exigeBaseLegal} is distinct from ${d.exigeBaseLegal}`,
      })
  }
  return ordenar(await db.select().from(funis).where(inArray(funis.slug, [...ORDEM_FUNIS])))
}

export async function obterFunil(slug: SlugFunil, opts: { db?: BancoCrm } = {}): Promise<Funil> {
  const db = opts.db ?? bancoPadrao()
  const [f] = await db.select().from(funis).where(eq(funis.slug, slug))
  if (f) return f
  const todos = await garantirFunis({ db })
  const g = todos.find((x) => x.slug === slug)
  if (!g) throw new Error('funil não encontrado depois de garantirFunis')
  return g
}

function paraRegra(f: Funil): FunilParaRegra {
  if (!ehSlugFunil(f.slug)) throw new Error('slug de funil desconhecido')
  return { slug: f.slug, ativo: f.ativo, tetoDiario: f.tetoDiario, exigeBaseLegal: f.exigeBaseLegal, checklistLgpdEm: f.checklistLgpdEm }
}

/**
 * Último evento da linha do tempo, ou a criação do contato se não houver evento. Nomes
 * qualificados à mão: numa consulta de uma tabela só o Drizzle escreve `"id"` sem a tabela, e
 * dentro da subconsulta isso seria a coluna da tabela interna.
 */
const ultimaInteracao = sql<Date>`coalesce((select max(ec.em) from eventos_contato ec where ec.contato_id = "contatos"."id"), "contatos"."criado_em")`.mapWith(
  contatos.criadoEm,
)

export type ResultadoInscricao = {
  inscritos: number[]
  jaInscritos: number
  recusados: Partial<Record<MotivoRecusa | 'ja_passou' | 'nao_encontrado', number>>
}

function somar(r: ResultadoInscricao, motivo: keyof ResultadoInscricao['recusados']) {
  r.recusados[motivo] = (r.recusados[motivo] ?? 0) + 1
}

/** Reentrada (linha que já existe e não está ativa): só pela tela, ou pela reativação diária. */
function reentradaPermitida(slug: SlugFunil, caminho: CaminhoInscricao): boolean {
  return caminho === 'manual' || (caminho === 'cron' && slug === 'reativacao')
}

/**
 * Inscreve contatos num funil, aplicando `podeEntrar` a cada um. A linha do funil é travada
 * (`FOR UPDATE`) para que o teto diário conte certo com chamadas simultâneas.
 */
export async function inscrever(
  slug: SlugFunil,
  contatoIds: readonly number[],
  opts: { db?: BancoCrm; caminho: CaminhoInscricao; agora?: Date },
): Promise<ResultadoInscricao> {
  const db = opts.db ?? bancoPadrao()
  const agora = opts.agora ?? new Date()
  const r: ResultadoInscricao = { inscritos: [], jaInscritos: 0, recusados: {} }
  const ids = [...new Set(contatoIds)]
  if (ids.length === 0) return r
  const funilBase = await obterFunil(slug, { db })

  return db.transaction(async (tx) => {
    const [funil] = await tx.select().from(funis).where(eq(funis.id, funilBase.id)).for('update')
    const regra = paraRegra(funil)
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(funilInscricoes)
      .where(and(eq(funilInscricoes.funilId, funil.id), gte(funilInscricoes.entrouEm, inicioDoDiaBrasilia(agora))))
    let inscritosHoje = Number(n)

    const linhas = await tx
      .select({ id: contatos.id, status: contatos.status, baseLegal: contatos.baseLegal, origem: contatos.origem, ultima: ultimaInteracao })
      .from(contatos)
      .where(inArray(contatos.id, ids))
      .orderBy(asc(contatos.id))
      .for('update', { of: contatos })
    const existentes = await tx
      .select()
      .from(funilInscricoes)
      .where(and(eq(funilInscricoes.funilId, funil.id), inArray(funilInscricoes.contatoId, ids)))
    const porContato = new Map(existentes.map((e) => [e.contatoId, e]))
    r.recusados.nao_encontrado = ids.length - linhas.length
    if (!r.recusados.nao_encontrado) delete r.recusados.nao_encontrado

    for (const c of linhas) {
      const atual = porContato.get(c.id)
      if (atual?.status === 'ativo') {
        r.jaInscritos++
        continue
      }
      if (atual && !reentradaPermitida(regra.slug, opts.caminho)) {
        somar(r, 'ja_passou')
        continue
      }
      const d = podeEntrar(
        regra,
        { status: c.status, baseLegal: c.baseLegal, origem: c.origem, ultimaInteracaoEm: c.ultima },
        { caminho: opts.caminho, agora, inscritosHoje },
      )
      if (!d.ok) {
        somar(r, d.motivo)
        continue
      }
      await tx
        .insert(funilInscricoes)
        .values({ contatoId: c.id, funilId: funil.id, status: 'ativo', origem: opts.caminho, entrouEm: agora, listaSync: 'pendente' })
        .onConflictDoUpdate({
          target: [funilInscricoes.contatoId, funilInscricoes.funilId],
          set: { status: 'ativo', origem: opts.caminho, entrouEm: agora, saiuEm: null, motivoSaida: null, listaSync: 'pendente', listaSyncErro: null },
        })
      await tx.insert(eventosContato).values({
        contatoId: c.id,
        tipo: 'entrou_funil',
        dados: { funil: funil.slug, nome: funil.nome, origem: opts.caminho },
        em: agora,
      })
      inscritosHoje++
      r.inscritos.push(c.id)
    }
    return r
  })
}

/** Tira contatos de um funil (inscrições ativas viram `saiu`). Devolve quantas encerrou. */
export async function sair(
  funilId: number,
  contatoIds: readonly number[],
  opts: { db?: BancoCrm; motivo: string; agora?: Date },
): Promise<number> {
  const db = opts.db ?? bancoPadrao()
  const ids = [...new Set(contatoIds)]
  if (ids.length === 0) return 0
  return encerrar(db, and(eq(funilInscricoes.funilId, funilId), inArray(funilInscricoes.contatoId, ids)), opts.motivo, opts.agora ?? new Date())
}

/** Gancho do descadastro: encerra toda inscrição ativa do contato. */
export async function sairDeTodosOsFunis(contatoId: number, opts: { db?: BancoCrm; motivo: string; agora?: Date }): Promise<number> {
  const db = opts.db ?? bancoPadrao()
  return encerrar(db, eq(funilInscricoes.contatoId, contatoId), opts.motivo, opts.agora ?? new Date())
}

async function encerrar(db: BancoCrm, filtro: ReturnType<typeof and>, motivo: string, agora: Date): Promise<number> {
  const texto = motivo.trim().slice(0, 200) || 'saída'
  const encerradas = await db
    .update(funilInscricoes)
    .set({ status: 'saiu', saiuEm: agora, motivoSaida: texto, listaSync: 'pendente', listaSyncErro: null })
    .where(and(filtro, eq(funilInscricoes.status, 'ativo')))
    .returning({ contatoId: funilInscricoes.contatoId, funilId: funilInscricoes.funilId })
  if (encerradas.length === 0) return 0
  const fs = await db.select({ id: funis.id, slug: funis.slug, nome: funis.nome }).from(funis).where(inArray(funis.id, [...new Set(encerradas.map((e) => e.funilId))]))
  const porId = new Map(fs.map((f) => [f.id, f]))
  await db.insert(eventosContato).values(
    encerradas.map((e) => ({
      contatoId: e.contatoId,
      tipo: 'saiu_funil' as const,
      dados: { funil: porId.get(e.funilId)?.slug ?? null, nome: porId.get(e.funilId)?.nome ?? null, motivo: texto },
      em: agora,
    })),
  )
  return encerradas.length
}

/**
 * Defesa extra: contato que virou descadastrado por outro caminho (planilha, importação do
 * Brevo) e ainda tem inscrição ativa sai de todos os funis.
 */
export async function encerrarInscricoesDeDescadastrados(opts: { db?: BancoCrm; agora?: Date } = {}): Promise<number> {
  const db = opts.db ?? bancoPadrao()
  const alvo = await db
    .selectDistinct({ id: funilInscricoes.contatoId })
    .from(funilInscricoes)
    .innerJoin(contatos, eq(contatos.id, funilInscricoes.contatoId))
    .where(and(eq(funilInscricoes.status, 'ativo'), eq(contatos.status, 'descadastrado')))
  let total = 0
  for (const a of alvo) total += await sairDeTodosOsFunis(a.id, { db, motivo: 'descadastrado', agora: opts.agora })
  return total
}

async function inscritosHojeNoFunil(db: BancoCrm, funilId: number, agora: Date): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(funilInscricoes)
    .where(and(eq(funilInscricoes.funilId, funilId), gte(funilInscricoes.entrouEm, inicioDoDiaBrasilia(agora))))
  return Number(n)
}

const semInscricaoAtiva = (funilId: number) =>
  notExists(sql`(select 1 from funil_inscricoes fi where fi.contato_id = "contatos"."id" and fi.funil_id = ${funilId} and fi.status = 'ativo')`)
const semNenhumaInscricao = (funilId: number) =>
  notExists(sql`(select 1 from funil_inscricoes fi where fi.contato_id = "contatos"."id" and fi.funil_id = ${funilId})`)

/** Etapa diária: clientes sem interação há 180 dias, no máximo 50 por dia. */
export async function inscreverReativacao(opts: { db?: BancoCrm; agora?: Date } = {}): Promise<ResultadoInscricao> {
  const db = opts.db ?? bancoPadrao()
  const agora = opts.agora ?? new Date()
  const funil = await obterFunil('reativacao', { db })
  const vazio: ResultadoInscricao = { inscritos: [], jaInscritos: 0, recusados: {} }
  if (!funil.ativo) return vazio
  const hoje = await inscritosHojeNoFunil(db, funil.id, agora)
  const vagas = Math.min(vagasHoje(MAX_REATIVACAO_POR_DIA, hoje), vagasHoje(funil.tetoDiario, hoje))
  if (vagas <= 0) return vazio
  const candidatos = await db
    .select({ id: contatos.id })
    .from(contatos)
    .where(and(eq(contatos.status, 'cliente'), sql`${ultimaInteracao} <= ${limiteReativacao(agora).toISOString()}::timestamptz`, semInscricaoAtiva(funil.id)))
    .orderBy(asc(ultimaInteracao), asc(contatos.id))
    .limit(vagas)
  return inscrever('reativacao', candidatos.map((c) => c.id), { db, caminho: 'cron', agora })
}

/** Etapa diária da prospecção fria: só ligada, com checklist, dentro do teto; nunca reinscreve. */
export async function inscreverProspeccao(opts: { db?: BancoCrm; agora?: Date } = {}): Promise<ResultadoInscricao> {
  const db = opts.db ?? bancoPadrao()
  const agora = opts.agora ?? new Date()
  const funil = await obterFunil('prospeccao-fria', { db })
  const vazio: ResultadoInscricao = { inscritos: [], jaInscritos: 0, recusados: {} }
  if (!funil.ativo || !prospeccaoLiberada(funil)) return vazio
  const vagas = vagasHoje(funil.tetoDiario, await inscritosHojeNoFunil(db, funil.id, agora))
  if (vagas <= 0) return vazio
  const candidatos = await db
    .select({ id: contatos.id })
    .from(contatos)
    .where(and(eq(contatos.status, 'lead'), eq(contatos.baseLegal, 'legitimo_interesse'), semNenhumaInscricao(funil.id)))
    .orderBy(asc(contatos.criadoEm), asc(contatos.id))
    .limit(vagas)
  return inscrever('prospeccao-fria', candidatos.map((c) => c.id), { db, caminho: 'cron', agora })
}

/** Ids dos contatos com uma tag (para inscrever um lote importado com tag). */
export async function contatosComTag(tag: string, opts: { db?: BancoCrm; limite?: number } = {}): Promise<number[]> {
  const db = opts.db ?? bancoPadrao()
  const t = tag.trim().toLowerCase()
  if (!t) return []
  const linhas = await db
    .select({ id: contatos.id })
    .from(contatos)
    .where(and(sql`${contatos.tags} @> ${JSON.stringify([t])}::jsonb`, ne(contatos.status, 'descadastrado')))
    .orderBy(asc(contatos.id))
    .limit(opts.limite ?? 5000)
  return linhas.map((l) => l.id)
}

/** Ids dos contatos por email (normalizado), para a inscrição manual por lista de emails. */
export async function contatosPorEmail(emails: readonly string[], opts: { db?: BancoCrm } = {}): Promise<{ ids: number[]; naoEncontrados: number }> {
  const db = opts.db ?? bancoPadrao()
  const unicos = [...new Set(emails)]
  if (unicos.length === 0) return { ids: [], naoEncontrados: 0 }
  const linhas = await db.select({ id: contatos.id }).from(contatos).where(inArray(contatos.emailNormalizado, unicos))
  return { ids: linhas.map((l) => l.id), naoEncontrados: unicos.length - linhas.length }
}

// ---------------------------------------------------------------------------
// Sincronização das inscrições com as listas do Brevo
// ---------------------------------------------------------------------------

export type ResultadoSyncInscricoes =
  | { conectado: false; mensagem: typeof MENSAGEM_NAO_CONECTADO }
  | { conectado: true; adicionados: number; removidos: number; erros: number; semLista: number; aguardandoContato: number; interrompido: string | null }

/** Erro que vale para todas as chamadas (chave, permissão, limite, Brevo fora): parar. */
function erroGeral(e: ErroBrevo): boolean {
  if (e.motivo !== 'http') return true
  return e.status === 401 || e.status === 403 || e.status === 425 || e.status === 429 || (e.status ?? 0) >= 500
}

const PENDENTE_OU_ERRO = or(eq(funilInscricoes.listaSync, 'pendente'), eq(funilInscricoes.listaSync, 'erro'))

/**
 * Leva ao Brevo as inscrições pendentes: adiciona as ativas (só de contatos que já existem
 * no Brevo, com `brevo_id`) e remove as encerradas. Funil sem lista conectada fica pendente.
 */
export async function sincronizarInscricoes(
  opts: { db?: BancoCrm; cliente?: ClienteBrevo; limite?: number; tamanhoLote?: number } = {},
): Promise<ResultadoSyncInscricoes> {
  const cliente = opts.cliente ?? criarClienteBrevo()
  if (!cliente.conectado) return { conectado: false, mensagem: MENSAGEM_NAO_CONECTADO }
  const db = opts.db ?? bancoPadrao()
  const limite = opts.limite ?? 500
  const tamanhoLote = Math.max(1, opts.tamanhoLote ?? 100)
  const r = { conectado: true as const, adicionados: 0, removidos: 0, erros: 0, semLista: 0, aguardandoContato: 0, interrompido: null as string | null }

  const [{ n: semLista }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(funilInscricoes)
    .innerJoin(funis, eq(funis.id, funilInscricoes.funilId))
    .where(and(PENDENTE_OU_ERRO, sql`${funis.brevoListaId} is null`))
  r.semLista = Number(semLista)

  const pendentes = await db
    .select({
      inscricao: funilInscricoes,
      listaId: funis.brevoListaId,
      email: contatos.emailNormalizado,
      brevoId: contatos.brevoId,
      statusContato: contatos.status,
    })
    .from(funilInscricoes)
    .innerJoin(funis, eq(funis.id, funilInscricoes.funilId))
    .innerJoin(contatos, eq(contatos.id, funilInscricoes.contatoId))
    .where(and(PENDENTE_OU_ERRO, isNotNull(funis.brevoListaId)))
    .orderBy(asc(funilInscricoes.id))
    .limit(limite)

  const marcar = (ids: number[], listaSync: 'sincronizado' | 'erro', erro: string | null = null) =>
    ids.length === 0
      ? Promise.resolve()
      : db.update(funilInscricoes).set({ listaSync, listaSyncErro: erro?.slice(0, 200) ?? null }).where(inArray(funilInscricoes.id, ids)).then(() => undefined)

  let ultimoErro: ErroBrevo | null = null
  const espiao: ClienteBrevo = {
    ...cliente,
    async adicionarALista(listaId, emails) {
      const x = await cliente.adicionarALista(listaId, emails)
      ultimoErro = x.ok ? null : x
      return x
    },
  }

  type Item = (typeof pendentes)[number]
  const grupos = new Map<string, Item[]>()
  for (const p of pendentes) {
    const listaId = p.listaId as number
    const acao = p.inscricao.status === 'ativo' ? 'add' : 'remove'
    if (acao === 'add' && p.statusContato === 'descadastrado') continue // será encerrada; nunca vai para lista
    if (!p.brevoId) {
      // Contato ainda não existe no Brevo: adicionar espera a sincronização do contato;
      // remover não tem o que tirar.
      if (acao === 'remove') await marcar([p.inscricao.id], 'sincronizado')
      else r.aguardandoContato++
      continue
    }
    const chave = `${acao}:${listaId}`
    grupos.set(chave, [...(grupos.get(chave) ?? []), p])
  }

  for (const [chave, itens] of grupos) {
    if (r.interrompido) break
    const [acao, lista] = chave.split(':')
    const listaId = Number(lista)
    for (let i = 0; i < itens.length && !r.interrompido; i += tamanhoLote) {
      const lote = itens.slice(i, i + tamanhoLote)
      if (acao === 'add') {
        // Sempre por `adicionarContatosALista` (filtra descadastrados). O espião só guarda o
        // erro tipado do cliente, que o resultado dela não devolve.
        const tentar = async (ids: number[]) => {
          ultimoErro = null
          const res = await adicionarContatosALista(listaId, ids, { db, cliente: espiao })
          return { res, erro: ultimoErro as ErroBrevo | null }
        }
        const { res, erro } = await tentar(lote.map((x) => x.inscricao.contatoId))
        if (res.ok && res.falhas === 0) {
          await marcar(lote.map((x) => x.inscricao.id), 'sincronizado')
          r.adicionados += res.adicionados
          continue
        }
        if (!res.ok && (!erro || erroGeral(erro))) {
          r.interrompido = res.mensagem
          continue
        }
        // Lote recusado pelos dados (400) ou com falhas: um por um, para saber qual falhou.
        for (const x of lote) {
          if (r.interrompido) break
          const um = await tentar([x.inscricao.contatoId])
          if (um.res.ok && um.res.falhas === 0) {
            await marcar([x.inscricao.id], 'sincronizado')
            r.adicionados += um.res.adicionados
          } else if (!um.res.ok && (!um.erro || erroGeral(um.erro))) {
            r.interrompido = um.res.mensagem
          } else {
            await marcar([x.inscricao.id], 'erro', um.res.ok ? 'O Brevo não aceitou o contato na lista.' : um.res.mensagem)
            r.erros++
          }
        }
      } else {
        const res = await cliente.removerDaLista(listaId, lote.map((x) => x.email))
        if (res.ok) {
          await marcar(lote.map((x) => x.inscricao.id), 'sincronizado')
          r.removidos += lote.length
          continue
        }
        if (erroGeral(res)) {
          r.interrompido = res.mensagem
          continue
        }
        // 400/404 no lote: um por um; recusado sozinho = já não está na lista.
        for (const x of lote) {
          if (r.interrompido) break
          const um = await cliente.removerDaLista(listaId, [x.email])
          if (um.ok || !erroGeral(um)) {
            await marcar([x.inscricao.id], 'sincronizado')
            r.removidos++
          } else {
            r.interrompido = um.mensagem
          }
        }
      }
    }
  }
  return r
}

// ---------------------------------------------------------------------------
// Configuração dos funis (tela)
// ---------------------------------------------------------------------------

export type ResultadoConexao =
  | { ok: true; listaId: number; verificada: boolean; criada: boolean }
  | { ok: false; motivo: 'nao_conectado' | 'lista_nao_encontrada' | 'lista_invalida' | 'brevo'; mensagem?: string }

async function gravarLista(db: BancoCrm, funilId: number, listaId: number) {
  await db.transaction(async (tx) => {
    const [antes] = await tx.select().from(funis).where(eq(funis.id, funilId)).for('update')
    await tx.update(funis).set({ brevoListaId: listaId, atualizadoEm: new Date() }).where(eq(funis.id, funilId))
    if (antes && antes.brevoListaId !== listaId) {
      // Lista nova: as inscrições ativas precisam ser adicionadas a ela; as encerradas não
      // têm o que remover na lista nova.
      await tx.update(funilInscricoes).set({ listaSync: 'pendente', listaSyncErro: null }).where(and(eq(funilInscricoes.funilId, funilId), eq(funilInscricoes.status, 'ativo')))
      await tx
        .update(funilInscricoes)
        .set({ listaSync: 'sincronizado', listaSyncErro: null })
        .where(and(eq(funilInscricoes.funilId, funilId), ne(funilInscricoes.status, 'ativo')))
    }
  })
}

/**
 * "Conectar ao Brevo": com `listaIdExistente`, usa essa lista (conferida no Brevo quando há
 * chave; sem chave, guardada sem conferir). Sem ela, cria a lista na pasta do painel (a API
 * exige pasta: usa a que já existir com o nome do painel ou cria uma).
 */
export async function conectarListaBrevo(
  slug: SlugFunil,
  opts: { db?: BancoCrm; cliente?: ClienteBrevo; listaIdExistente?: number | null },
): Promise<ResultadoConexao> {
  const db = opts.db ?? bancoPadrao()
  const cliente = opts.cliente ?? criarClienteBrevo()
  const funil = await obterFunil(slug, { db })

  if (opts.listaIdExistente !== undefined && opts.listaIdExistente !== null) {
    const id = opts.listaIdExistente
    if (!Number.isInteger(id) || id <= 0) return { ok: false, motivo: 'lista_invalida' }
    if (!cliente.conectado) {
      await gravarLista(db, funil.id, id)
      return { ok: true, listaId: id, verificada: false, criada: false }
    }
    const l = await cliente.obterLista(id)
    if (!l.ok) return { ok: false, motivo: 'brevo', mensagem: l.mensagem }
    if (!l.dados) return { ok: false, motivo: 'lista_nao_encontrada' }
    await gravarLista(db, funil.id, id)
    return { ok: true, listaId: id, verificada: true, criada: false }
  }

  if (!cliente.conectado) return { ok: false, motivo: 'nao_conectado' }
  const pastas = await cliente.listarPastas()
  if (!pastas.ok) return { ok: false, motivo: 'brevo', mensagem: pastas.mensagem }
  let pastaId = pastas.dados.find((p) => p.nome === PASTA_BREVO)?.id ?? null
  if (pastaId === null) {
    const p = await cliente.criarPasta(PASTA_BREVO)
    if (!p.ok) return { ok: false, motivo: 'brevo', mensagem: p.mensagem }
    pastaId = p.dados.id
  }
  const l = await cliente.criarLista(nomeListaBrevo(funil.nome), pastaId)
  if (!l.ok) return { ok: false, motivo: 'brevo', mensagem: l.mensagem }
  await gravarLista(db, funil.id, l.dados.id)
  return { ok: true, listaId: l.dados.id, verificada: true, criada: true }
}

/** Liga ou desliga um funil. A prospecção fria só liga por `ligarProspeccaoFria`. */
export async function definirAtivo(slug: SlugFunil, ativo: boolean, opts: { db?: BancoCrm } = {}): Promise<{ ok: true } | { ok: false; motivo: 'use_checklist' }> {
  if (slug === 'prospeccao-fria' && ativo) return { ok: false, motivo: 'use_checklist' }
  const db = opts.db ?? bancoPadrao()
  const funil = await obterFunil(slug, { db })
  await db.update(funis).set({ ativo, atualizadoEm: new Date() }).where(eq(funis.id, funil.id))
  return { ok: true }
}

/** Liga a prospecção fria: exige os três itens do checklist de LGPD e o teto diário. */
export async function ligarProspeccaoFria(
  checklist: ChecklistLgpd,
  teto: number | null,
  opts: { db?: BancoCrm; agora?: Date } = {},
): Promise<{ ok: true } | { ok: false; motivo: 'checklist' | 'teto' }> {
  const v = validarLigarProspeccao(checklist, teto)
  if (!v.ok) return v
  const db = opts.db ?? bancoPadrao()
  const funil = await obterFunil('prospeccao-fria', { db })
  const agora = opts.agora ?? new Date()
  await db.update(funis).set({ ativo: true, tetoDiario: v.teto, checklistLgpdEm: agora, atualizadoEm: agora }).where(eq(funis.id, funil.id))
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Consultas da tela
// ---------------------------------------------------------------------------

export type ResumoFunil = Funil & {
  ativos: number
  concluidos: number
  sairam: number
  pendentesBrevo: number
}

export async function resumoFunis(opts: { db?: BancoCrm } = {}): Promise<ResumoFunil[]> {
  const db = opts.db ?? bancoPadrao()
  const lista = await garantirFunis({ db })
  const contagens = await db
    .select({
      funilId: funilInscricoes.funilId,
      status: funilInscricoes.status,
      pendentes: sql<number>`count(*) filter (where ${funilInscricoes.listaSync} <> 'sincronizado')::int`,
      n: sql<number>`count(*)::int`,
    })
    .from(funilInscricoes)
    .groupBy(funilInscricoes.funilId, funilInscricoes.status)
  return lista.map((f) => {
    const doFunil = contagens.filter((c) => c.funilId === f.id)
    const de = (s: FunilInscricao['status']) => Number(doFunil.find((c) => c.status === s)?.n ?? 0)
    return { ...f, ativos: de('ativo'), concluidos: de('concluido'), sairam: de('saiu'), pendentesBrevo: doFunil.reduce((a, c) => a + Number(c.pendentes), 0) }
  })
}

export type MembroFunil = {
  inscricao: FunilInscricao
  contato: { id: number; nome: string; email: string; status: StatusContato }
}

export const MEMBROS_POR_PAGINA = 50

export async function membrosDoFunil(
  funilId: number,
  opts: { db?: BancoCrm; status?: FunilInscricao['status']; pagina?: number } = {},
): Promise<{ itens: MembroFunil[]; total: number }> {
  const db = opts.db ?? bancoPadrao()
  const pagina = Math.max(1, opts.pagina ?? 1)
  const filtro = and(eq(funilInscricoes.funilId, funilId), opts.status ? eq(funilInscricoes.status, opts.status) : undefined)
  const [itens, [{ n }]] = await Promise.all([
    db
      .select({ inscricao: funilInscricoes, contato: { id: contatos.id, nome: contatos.nome, email: contatos.email, status: contatos.status } })
      .from(funilInscricoes)
      .innerJoin(contatos, eq(contatos.id, funilInscricoes.contatoId))
      .where(filtro)
      .orderBy(desc(funilInscricoes.entrouEm), desc(funilInscricoes.id))
      .limit(MEMBROS_POR_PAGINA)
      .offset((pagina - 1) * MEMBROS_POR_PAGINA),
    db.select({ n: sql<number>`count(*)::int` }).from(funilInscricoes).where(filtro),
  ])
  return { itens, total: Number(n) }
}

