import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { contatos, eventosContato, type Contato, type EventoContato } from '@/lib/db/schema'
import { bancoPadrao, type BancoCrm } from './banco'
import {
  normalizarTags,
  normalizarUf,
  textoOuNulo,
  type BaseLegal,
  type CampoContato,
  type DadosContato,
  type Origem,
  type StatusContato,
} from './campos'
import { normalizarEmail } from './email'
import { LIMITE_NOTAS, LIMITE_TAGS, resendMudou, criarEstado, diferencas, estadoDe, mesclarEstado, type EstadoContato } from './mesclar'

/**
 * Núcleo do CRM. Contrato usado pela importação (E7), pelos webhooks e pela
 * sincronização com o Resend (E8) e pelos funis (E9).
 *
 * Nenhuma função daqui registra dado de contato em log, e nada daqui vai para prompt de IA.
 */

export type TipoEvento = EventoContato['tipo']

export type OpcoesUpsert = {
  db?: BancoCrm
  agora?: Date
  /**
   * Contato já `descadastrado`: `manter_status` (padrão) atualiza os outros campos e
   * mantém o status; `ignorar` não toca no contato (a importação de planilha usa este).
   * Em nenhum dos dois o contato sai de `descadastrado`.
   */
  seDescadastrado?: 'manter_status' | 'ignorar'
  /** Presente na importação de planilha: vira um evento `importado` na linha do tempo. */
  importacao?: { lote: string; arquivo: string }
}

/** `dados_apagados`: o titular pediu para apagar os dados; o email só serve de supressão. */
export type MotivoIgnorado = 'email_invalido' | 'sem_base_legal' | 'descadastrado' | 'dados_apagados'

export type ResultadoUpsert =
  | { acao: 'criado'; contatoId: number }
  | { acao: 'atualizado'; contatoId: number; alterados: CampoContato[]; mantidos: CampoContato[] }
  | { acao: 'inalterado'; contatoId: number; mantidos: CampoContato[] }
  | { acao: 'ignorado'; motivo: MotivoIgnorado; contatoId?: number }

const TAMANHO_BLOCO = 500

type NovoEvento = { contatoId: number; tipo: TipoEvento; dados: Record<string, unknown> | null; em?: Date }

/** Cria ou atualiza um contato pelo email normalizado. Ver `upsertContatos`. */
export async function upsertContato(dados: DadosContato, origem: Origem, opts: OpcoesUpsert = {}): Promise<ResultadoUpsert> {
  const [r] = await upsertContatos([dados], origem, opts)
  return r
}

/**
 * Cria ou atualiza vários contatos numa transação só, um resultado por item (na ordem).
 * Regras de mescla em `mesclarEstado`; itens com o mesmo email são aplicados em ordem.
 *
 * Concorrência: cada email é primeiro inserido com `ON CONFLICT (email_normalizado) DO
 * NOTHING` e, se já existia (inclusive criado agora por outra transação), lido com `FOR
 * UPDATE` antes da mescla. Duas chamadas simultâneas para o mesmo email se serializam
 * nessa trava; nenhuma sobrescreve a outra com dado velho.
 */
export async function upsertContatos(
  itens: readonly DadosContato[],
  origem: Origem,
  opts: OpcoesUpsert = {},
): Promise<ResultadoUpsert[]> {
  const db = opts.db ?? bancoPadrao()
  const agora = opts.agora ?? new Date()
  const resultados: ResultadoUpsert[] = new Array(itens.length)
  const porEmail = new Map<string, number[]>()
  itens.forEach((item, i) => {
    const email = normalizarEmail(item.email)
    if (!email) {
      resultados[i] = { acao: 'ignorado', motivo: 'email_invalido' }
      return
    }
    const lista = porEmail.get(email)
    if (lista) lista.push(i)
    else porEmail.set(email, [i])
  })
  const emails = [...porEmail.keys()].sort() // ordem fixa de travas entre transações
  if (emails.length === 0) return resultados

  await db.transaction(async (tx) => {
    const banco = tx as unknown as BancoCrm
    for (let i = 0; i < emails.length; i += TAMANHO_BLOCO) {
      await processarBloco(banco, emails.slice(i, i + TAMANHO_BLOCO), porEmail, itens, origem, agora, opts, resultados)
    }
  })
  return resultados
}

async function travar(db: BancoCrm, emails: string[]): Promise<Contato[]> {
  if (emails.length === 0) return []
  return db
    .select()
    .from(contatos)
    .where(inArray(contatos.emailNormalizado, emails))
    .orderBy(asc(contatos.emailNormalizado))
    .for('update')
}

async function processarBloco(
  db: BancoCrm,
  emails: string[],
  porEmail: Map<string, number[]>,
  itens: readonly DadosContato[],
  origem: Origem,
  agora: Date,
  opts: OpcoesUpsert,
  resultados: ResultadoUpsert[],
): Promise<void> {
  const existentes = new Map((await travar(db, emails)).map((c) => [c.emailNormalizado, c]))

  // 1. Emails novos: insere o estado criado pelo primeiro item que traz base legal.
  const novos: { email: string; criador: number; estado: EstadoContato }[] = []
  for (const email of emails) {
    if (existentes.has(email)) continue
    const indices = porEmail.get(email)!
    const criador = indices.find((i) => itens[i].baseLegal)
    if (criador === undefined) {
      for (const i of indices) resultados[i] = { acao: 'ignorado', motivo: 'sem_base_legal' }
      continue
    }
    novos.push({ email, criador, estado: criarEstado(itens[criador], email, origem, agora)! })
  }
  const inseridos = new Map<string, Contato>()
  if (novos.length > 0) {
    const linhas = await db
      .insert(contatos)
      .values(novos.map((n) => ({ ...n.estado, criadoEm: agora, atualizadoEm: agora })))
      .onConflictDoNothing({ target: contatos.emailNormalizado })
      .returning()
    for (const l of linhas) inseridos.set(l.emailNormalizado, l)
    // Criados por outra transação entre a leitura e a inserção: viram existentes.
    const corrida = novos.filter((n) => !inseridos.has(n.email)).map((n) => n.email)
    for (const c of await travar(db, corrida)) existentes.set(c.emailNormalizado, c)
  }

  const eventos: NovoEvento[] = []
  const atualizacoes: { linha: Contato; estado: EstadoContato; pendente: boolean }[] = []
  const eventoImportado = (contatoId: number, acao: string) => {
    if (opts.importacao) eventos.push({ contatoId, tipo: 'importado', dados: { ...opts.importacao, acao } })
  }

  const aplicar = (linha: Contato, inicio: EstadoContato, indices: number[]) => {
    let estado = inicio
    let pendente = false
    for (const i of indices) {
      const m = mesclarEstado(estado, itens[i], origem, agora)
      if (m.alterados.length === 0) {
        resultados[i] = { acao: 'inalterado', contatoId: linha.id, mantidos: m.mantidos }
        continue
      }
      resultados[i] = { acao: 'atualizado', contatoId: linha.id, alterados: m.alterados, mantidos: m.mantidos }
      const campos = m.alterados.filter((c) => c !== 'status' && c !== 'consentimentoEm')
      if (campos.length > 0) {
        eventos.push({ contatoId: linha.id, tipo: 'atualizado', dados: { campos, mantidos: m.mantidos, origem } })
      }
      if (m.status) eventos.push({ contatoId: linha.id, tipo: 'mudou_status', dados: { ...m.status, origem } })
      eventoImportado(linha.id, 'atualizado')
      pendente ||= m.resendMudou
      estado = m.estado
    }
    if (estado !== inicio) atualizacoes.push({ linha, estado, pendente })
  }

  for (const n of novos) {
    const linha = inseridos.get(n.email)
    if (!linha) continue
    const indices = porEmail.get(n.email)!
    for (const i of indices) {
      if (i >= n.criador) break
      resultados[i] = { acao: 'ignorado', motivo: 'sem_base_legal' }
    }
    resultados[n.criador] = { acao: 'criado', contatoId: linha.id }
    eventos.push({ contatoId: linha.id, tipo: 'criado', dados: { origem } })
    eventoImportado(linha.id, 'criado')
    aplicar(linha, n.estado, indices.filter((i) => i > n.criador))
  }

  for (const email of emails) {
    const linha = existentes.get(email)
    if (!linha) continue
    const indices = porEmail.get(email)!
    if (linha.dadosApagadosEm) {
      // Dados apagados a pedido (LGPD art. 18): nenhuma origem repreenche o contato.
      for (const i of indices) resultados[i] = { acao: 'ignorado', motivo: 'dados_apagados', contatoId: linha.id }
      continue
    }
    if (linha.status === 'descadastrado' && opts.seDescadastrado === 'ignorar') {
      for (const i of indices) resultados[i] = { acao: 'ignorado', motivo: 'descadastrado', contatoId: linha.id }
      continue
    }
    aplicar(linha, estadoDe(linha), indices)
  }

  if (atualizacoes.length > 0) {
    // Linhas travadas acima: um único INSERT … ON CONFLICT DO UPDATE grava o estado final.
    await db
      .insert(contatos)
      .values(
        atualizacoes.map((a) => ({
          ...a.estado,
          id: a.linha.id,
          syncStatus: a.pendente ? ('pendente' as const) : a.linha.syncStatus,
          criadoEm: a.linha.criadoEm,
          atualizadoEm: agora,
        })),
      )
      .onConflictDoUpdate({
        target: contatos.emailNormalizado,
        set: {
          nome: sql`excluded.nome`,
          telefone: sql`excluded.telefone`,
          escritorio: sql`excluded.escritorio`,
          cidade: sql`excluded.cidade`,
          uf: sql`excluded.uf`,
          baseLegal: sql`excluded.base_legal`,
          consentimentoEm: sql`excluded.consentimento_em`,
          // Defesa extra: mesmo que a mescla errasse, o banco não tira ninguém de descadastrado.
          status: sql`case when ${contatos.status} = 'descadastrado' then ${contatos.status} else excluded.status end`,
          tags: sql`excluded.tags`,
          notas: sql`excluded.notas`,
          resendContatoId: sql`excluded.resend_contato_id`,
          syncStatus: sql`excluded.sync_status`,
          atualizadoEm: sql`excluded.atualizado_em`,
        },
      })
  }
  if (eventos.length > 0) await db.insert(eventosContato).values(eventos)
}

/** Acrescenta um evento à linha do tempo (webhooks do Resend, funis). */
export async function registrarEvento(
  contatoId: number,
  tipo: TipoEvento,
  dados: Record<string, unknown> | null = null,
  opts: { db?: BancoCrm; em?: Date } = {},
): Promise<void> {
  const db = opts.db ?? bancoPadrao()
  await db.insert(eventosContato).values({ contatoId, tipo, dados, ...(opts.em ? { em: opts.em } : {}) })
}

export type ResultadoStatus =
  | { ok: true; de: StatusContato; para: StatusContato }
  | { ok: false; motivo: 'nao_encontrado' | 'descadastrado' }

/**
 * Muda o status de um contato. Entrar em `descadastrado` pode; sair dele não — para isso
 * existe `reativarContato`.
 */
export async function mudarStatus(
  id: number,
  para: StatusContato,
  opts: { db?: BancoCrm; origem?: Origem | 'descadastro' | 'resend'; motivo?: string } = {},
): Promise<ResultadoStatus> {
  const db = opts.db ?? bancoPadrao()
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(contatos).where(eq(contatos.id, id)).for('update')
    if (!c) return { ok: false, motivo: 'nao_encontrado' } as const
    if (c.status === para) return { ok: true, de: c.status, para } as const
    if (c.status === 'descadastrado') return { ok: false, motivo: 'descadastrado' } as const
    await tx
      .update(contatos)
      .set({ status: para, syncStatus: 'pendente', atualizadoEm: new Date() })
      .where(and(eq(contatos.id, id), sql`${contatos.status} <> 'descadastrado'`))
    const motivo = textoOuNulo(opts.motivo)
    await tx.insert(eventosContato).values({
      contatoId: id,
      tipo: 'mudou_status',
      dados: { de: c.status, para, origem: opts.origem ?? 'manual', ...(motivo ? { motivo } : {}) },
    })
    return { ok: true, de: c.status, para } as const
  })
}

/**
 * Única saída de `descadastrado`: ação explícita, com motivo registrado na linha do tempo.
 * A tela só oferece isto atrás de um aviso de LGPD (a pessoa pediu para sair).
 */
export async function reativarContato(
  id: number,
  motivo: string,
  opts: { db?: BancoCrm } = {},
): Promise<{ ok: true } | { ok: false; motivo: 'sem_motivo' | 'nao_encontrado' | 'nao_descadastrado' | 'dados_apagados' }> {
  const texto = textoOuNulo(motivo)
  if (!texto) return { ok: false, motivo: 'sem_motivo' }
  const db = opts.db ?? bancoPadrao()
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(contatos).where(eq(contatos.id, id)).for('update')
    if (!c) return { ok: false, motivo: 'nao_encontrado' } as const
    if (c.status !== 'descadastrado') return { ok: false, motivo: 'nao_descadastrado' } as const
    // Quem pediu para apagar os dados nunca volta: sobrou só o email, como supressão.
    if (c.dadosApagadosEm) return { ok: false, motivo: 'dados_apagados' } as const
    await tx.update(contatos).set({ status: 'lead', syncStatus: 'pendente', atualizadoEm: new Date() }).where(eq(contatos.id, id))
    await tx.insert(eventosContato).values({
      contatoId: id,
      tipo: 'mudou_status',
      dados: { de: 'descadastrado', para: 'lead', reativacao: true, motivo: texto.slice(0, 1000), origem: 'manual' },
    })
    return { ok: true } as const
  })
}

export type EdicaoContato = {
  nome?: string | null
  telefone?: string | null
  escritorio?: string | null
  cidade?: string | null
  uf?: string | null
  baseLegal?: BaseLegal
  tags?: readonly string[]
  notas?: string | null
}

/**
 * Edição manual pela tela de detalhe. Diferente do upsert, é explícita: campo enviado
 * vazio apaga, as tags enviadas substituem as atuais e a base legal pode ser trocada
 * (inclusive por uma mais fraca, registrando de/para). Não mexe no status nem no email.
 */
export async function editarContato(
  id: number,
  edicao: EdicaoContato,
  opts: { db?: BancoCrm; agora?: Date } = {},
): Promise<{ ok: true; alterados: CampoContato[] } | { ok: false; motivo: 'nao_encontrado' | 'uf_invalida' | 'longo' | 'dados_apagados' }> {
  if (edicao.uf != null && edicao.uf.trim() !== '' && !normalizarUf(edicao.uf)) return { ok: false, motivo: 'uf_invalida' }
  // A edição explícita recusa o que passa do limite em vez de cortar calado.
  if ((edicao.notas ?? '').trim().length > LIMITE_NOTAS) return { ok: false, motivo: 'longo' }
  if (edicao.tags !== undefined && normalizarTags(edicao.tags).length > LIMITE_TAGS) return { ok: false, motivo: 'longo' }
  const db = opts.db ?? bancoPadrao()
  const agora = opts.agora ?? new Date()
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(contatos).where(eq(contatos.id, id)).for('update')
    if (!c) return { ok: false, motivo: 'nao_encontrado' } as const
    if (c.dadosApagadosEm) return { ok: false, motivo: 'dados_apagados' } as const
    const atual = estadoDe(c)
    const novo: EstadoContato = { ...atual, tags: [...atual.tags] }
    if (edicao.nome !== undefined) novo.nome = textoOuNulo(edicao.nome) ?? ''
    for (const k of ['telefone', 'escritorio', 'cidade', 'notas'] as const) {
      if (edicao[k] !== undefined) novo[k] = textoOuNulo(edicao[k])
    }
    if (edicao.uf !== undefined) novo.uf = normalizarUf(edicao.uf)
    if (edicao.tags !== undefined) novo.tags = normalizarTags(edicao.tags)
    if (edicao.baseLegal !== undefined) {
      novo.baseLegal = edicao.baseLegal
      if (edicao.baseLegal === 'consentimento' && atual.baseLegal !== 'consentimento') novo.consentimentoEm = agora
      // Sem consentimento como base, não há data de consentimento a exibir.
      if (edicao.baseLegal !== 'consentimento') novo.consentimentoEm = null
    }
    const alterados = diferencas(atual, novo)
    if (alterados.length === 0) return { ok: true, alterados } as const
    await tx
      .update(contatos)
      .set({
        nome: novo.nome,
        telefone: novo.telefone,
        escritorio: novo.escritorio,
        cidade: novo.cidade,
        uf: novo.uf,
        baseLegal: novo.baseLegal,
        consentimentoEm: novo.consentimentoEm,
        tags: novo.tags,
        notas: novo.notas,
        atualizadoEm: agora,
        ...(resendMudou(alterados) ? { syncStatus: 'pendente' as const } : {}),
      })
      .where(eq(contatos.id, id))
    const campos = alterados.filter((k) => k !== 'consentimentoEm')
    await tx.insert(eventosContato).values({
      contatoId: id,
      tipo: 'atualizado',
      dados: {
        campos,
        origem: 'manual',
        ...(novo.baseLegal !== atual.baseLegal ? { baseLegal: { de: atual.baseLegal, para: novo.baseLegal } } : {}),
      },
    })
    return { ok: true, alterados: campos } as const
  })
}

/** Linha do tempo, do evento mais novo ao mais antigo. */
export async function linhaDoTempo(contatoId: number, opts: { db?: BancoCrm; limite?: number } = {}): Promise<EventoContato[]> {
  const db = opts.db ?? bancoPadrao()
  return db
    .select()
    .from(eventosContato)
    .where(eq(eventosContato.contatoId, contatoId))
    .orderBy(desc(eventosContato.em), desc(eventosContato.id))
    .limit(opts.limite ?? 200)
}
