import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

export const intencao = pgEnum('intencao', [
  'informacional',
  'comercial',
  'transacional',
  'navegacional',
])
export const prioridade = pgEnum('prioridade', ['alta', 'media', 'baixa'])
export const clusterStatus = pgEnum('cluster_status', ['ativo', 'arquivado'])
export const topicStatus = pgEnum('topic_status', [
  'ideia',
  'escolhido',
  'briefado',
  'publicado',
])
export const topicOrigem = pgEnum('topic_origem', ['ia', 'gsc', 'tendencia'])
export const severidade = pgEnum('severidade', ['critico', 'aviso', 'info'])
export const runStatus = pgEnum('run_status', ['rodando', 'concluido', 'falhou'])

export const gscSnapshots = pgTable(
  'gsc_snapshots',
  {
    id: serial('id').primaryKey(),
    snapshotDate: date('snapshot_date').notNull(),
    query: text('query').notNull(),
    page: text('page').notNull(),
    clicks: integer('clicks').notNull(),
    impressions: integer('impressions').notNull(),
    ctr: real('ctr').notNull(),
    position: real('position').notNull(),
  },
  (t) => [unique().on(t.snapshotDate, t.query, t.page)],
)

/**
 * Totais da janela atual e dos 28 dias anteriores a ela, gravados pelo cron junto com
 * o snapshot. Dão à visão geral a comparação desde o primeiro dia sincronizado.
 */
export const gscTotais = pgTable('gsc_totais', {
  snapshotDate: date('snapshot_date').primaryKey(),
  clicksAtual: integer('clicks_atual').notNull(),
  impressionsAtual: integer('impressions_atual').notNull(),
  clicksAnterior: integer('clicks_anterior').notNull(),
  impressionsAnterior: integer('impressions_anterior').notNull(),
})

export const clusters = pgTable('clusters', {
  id: serial('id').primaryKey(),
  nome: text('nome').notNull(),
  keywordPilar: text('keyword_pilar').notNull(),
  intencao: intencao('intencao').notNull(),
  prioridade: prioridade('prioridade').notNull(),
  status: clusterStatus('status').notNull().default('ativo'),
  criadoEm: timestamp('criado_em').notNull().defaultNow(),
})

export const topics = pgTable(
  'topics',
  {
    id: serial('id').primaryKey(),
    clusterId: integer('cluster_id').references(() => clusters.id),
    titulo: text('titulo').notNull(),
    keyword: text('keyword').notNull(),
    /** normalizarKeyword(keyword): identidade do assunto; o índice único impede tema duplicado. */
    keywordNormalizada: text('keyword_normalizada').notNull(),
    intencao: intencao('intencao').notNull(),
    prioridade: prioridade('prioridade').notNull(),
    status: topicStatus('status').notNull().default('ideia'),
    origem: topicOrigem('origem').notNull(),
    urlPublicada: text('url_publicada'),
    notas: text('notas'),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('topics_keyword_normalizada_idx').on(t.keywordNormalizada)],
)

export const briefings = pgTable('briefings', {
  id: serial('id').primaryKey(),
  topicId: integer('topic_id')
    .notNull()
    .references(() => topics.id),
  title: text('title').notNull(),
  metaDescription: text('meta_description').notNull(),
  outline: jsonb('outline').notNull(),
  faq: jsonb('faq').notNull(),
  linksInternos: jsonb('links_internos').notNull(),
  keywordsSecundarias: jsonb('keywords_secundarias').notNull(),
  modelo: text('modelo').notNull(),
  // Campos que foram encurtados automaticamente (['title', 'metaDescription']); null = nenhum.
  ajustes: jsonb('ajustes'),
  criadoEm: timestamp('criado_em').notNull().defaultNow(),
})

export const auditRuns = pgTable('audit_runs', {
  id: serial('id').primaryKey(),
  iniciadoEm: timestamp('iniciado_em').notNull().defaultNow(),
  finalizadoEm: timestamp('finalizado_em'),
  paginasRastreadas: integer('paginas_rastreadas').notNull().default(0),
  status: runStatus('status').notNull().default('rodando'),
})

export const auditPages = pgTable('audit_pages', {
  id: serial('id').primaryKey(),
  runId: integer('run_id')
    .notNull()
    .references(() => auditRuns.id),
  url: text('url').notNull(),
  statusCode: integer('status_code'),
  title: text('title'),
  metaDescription: text('meta_description'),
  h1Count: integer('h1_count').notNull().default(0),
  h1Texto: text('h1_texto'),
  palavras: integer('palavras').notNull().default(0),
  canonical: text('canonical'),
  noindex: boolean('noindex').notNull().default(false),
  linksEntrando: integer('links_entrando').notNull().default(0),
  linksSaindo: integer('links_saindo').notNull().default(0),
  schemaTypes: jsonb('schema_types').notNull().default([]),
  imagensSemAlt: integer('imagens_sem_alt').notNull().default(0),
})

export const auditIssues = pgTable('audit_issues', {
  id: serial('id').primaryKey(),
  runId: integer('run_id')
    .notNull()
    .references(() => auditRuns.id),
  pageId: integer('page_id').references(() => auditPages.id),
  severidade: severidade('severidade').notNull(),
  regra: text('regra').notNull(),
  mensagem: text('mensagem').notNull(),
})

export type Topic = typeof topics.$inferSelect
export type Cluster = typeof clusters.$inferSelect
export type AuditPage = typeof auditPages.$inferSelect

/** Série diária do Google Analytics 4: uma linha por dia, regravada a cada execução. */
export const ga4Diario = pgTable('ga4_diario', {
  data: date('data').primaryKey(),
  sessoes: integer('sessoes').notNull(),
  usuarios: integer('usuarios').notNull(),
  sessoesEngajadas: integer('sessoes_engajadas').notNull(),
  eventosChave: integer('eventos_chave').notNull(),
})

/** Páginas de entrada por origem/mídia na janela de 28 dias, um snapshot por dia. */
export const ga4Paginas = pgTable(
  'ga4_paginas',
  {
    snapshotDate: date('snapshot_date').notNull(),
    pagina: text('pagina').notNull(),
    origemMidia: text('origem_midia').notNull(),
    sessoes: integer('sessoes').notNull(),
    usuarios: integer('usuarios').notNull(),
    eventosChave: integer('eventos_chave').notNull(),
  },
  (t) => [unique().on(t.snapshotDate, t.pagina, t.origemMidia)],
)

/**
 * Totais deduplicados do GA4 (uma consulta sem dimensões, duas janelas): últimos 28 dias
 * terminando na véspera do snapshot e os 28 anteriores. Usuários só podem vir daqui: a
 * soma dos usuários de cada dia conta de novo quem voltou em outro dia.
 */
export const ga4Totais = pgTable('ga4_totais', {
  snapshotDate: date('snapshot_date').primaryKey(),
  inicioAtual: date('inicio_atual').notNull(),
  fimAtual: date('fim_atual').notNull(),
  inicioAnterior: date('inicio_anterior').notNull(),
  fimAnterior: date('fim_anterior').notNull(),
  usuariosAtual: integer('usuarios_atual').notNull(),
  usuariosAnterior: integer('usuarios_anterior').notNull(),
  sessoesAtual: integer('sessoes_atual').notNull(),
  sessoesAnterior: integer('sessoes_anterior').notNull(),
  sessoesEngajadasAtual: integer('sessoes_engajadas_atual').notNull(),
  sessoesEngajadasAnterior: integer('sessoes_engajadas_anterior').notNull(),
  eventosChaveAtual: integer('eventos_chave_atual').notNull(),
  eventosChaveAnterior: integer('eventos_chave_anterior').notNull(),
})

/** Última execução de cada fonte da rotina diária (para "última sincronização"). */
export const sincronizacoes = pgTable('sincronizacoes', {
  fonte: text('fonte').primaryKey(),
  status: text('status').notNull(),
  mensagem: text('mensagem'),
  executadoEm: timestamp('executado_em', { withTimezone: true }).notNull(),
  linhas: integer('linhas'),
  /** Último sucesso da fonte; trava de custo do radar (um erro depois de um ok não a reabre). */
  ultimoOkEm: timestamp('ultimo_ok_em', { withTimezone: true }),
})

export const potencial = pgEnum('potencial', ['alto', 'medio', 'baixo'])
export const teseStatus = pgEnum('tese_status', ['nova', 'virou_tema', 'descartada'])

/** Fatos recentes (decisões, leis, índices) coletados pela busca diária; só com fonte verificada. */
export const tendencias = pgTable('tendencias', {
  id: serial('id').primaryKey(),
  titulo: text('titulo').notNull(),
  resumo: text('resumo').notNull(),
  fonteUrl: text('fonte_url').notNull(),
  publicadoEm: date('publicado_em'),
  palavrasChave: jsonb('palavras_chave').notNull().$type<string[]>(),
  coletadoEm: timestamp('coletado_em').notNull().defaultNow(),
  /** sha256 da URL normalizada: a mesma fonte não entra duas vezes. */
  hash: text('hash').notNull().unique(),
})

export const tesesSugeridas = pgTable(
  'teses_sugeridas',
  {
    id: serial('id').primaryKey(),
    tendenciaId: integer('tendencia_id').references(() => tendencias.id),
    titulo: text('titulo').notNull(),
    keyword: text('keyword').notNull(),
    keywordNormalizada: text('keyword_normalizada').notNull(),
    intencao: intencao('intencao').notNull(),
    justificativa: text('justificativa').notNull(),
    /** Estimativa qualitativa do modelo, não medição. */
    potencial: potencial('potencial').notNull(),
    sinais: jsonb('sinais').notNull().$type<string[]>(),
    status: teseStatus('status').notNull().default('nova'),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('teses_keyword_normalizada_idx').on(t.keywordNormalizada)],
)

export type Tendencia = typeof tendencias.$inferSelect
export type TeseSugerida = typeof tesesSugeridas.$inferSelect

// ---------------------------------------------------------------------------
// CRM (E7): contatos, linha do tempo e lotes de importação de planilha.
// ---------------------------------------------------------------------------

export const contatoOrigem = pgEnum('contato_origem', ['site', 'planilha', 'manual', 'brevo'])
export const baseLegal = pgEnum('base_legal', ['consentimento', 'legitimo_interesse', 'contrato'])
export const contatoStatus = pgEnum('contato_status', ['lead', 'cliente', 'inativo', 'descadastrado'])
export const syncStatus = pgEnum('sync_status', ['pendente', 'sincronizado', 'erro'])
export const eventoContatoTipo = pgEnum('evento_contato_tipo', [
  'criado',
  'atualizado',
  'importado',
  'mudou_status',
  'entrou_funil',
  'saiu_funil',
  'enviado',
  'aberto',
  'clicado',
  'descadastrou',
  'bounce',
  'spam',
])

/** Dado pessoal (LGPD): nunca vai para prompt de IA nem para log. */
export const contatos = pgTable(
  'contatos',
  {
    id: serial('id').primaryKey(),
    /** Vazio quando a fonte não traz nome (ex.: contato vindo só com email). */
    nome: text('nome').notNull().default(''),
    /** Como foi informado (aparado); a identidade é `emailNormalizado`. */
    email: text('email').notNull(),
    emailNormalizado: text('email_normalizado').notNull(),
    telefone: text('telefone'),
    escritorio: text('escritorio'),
    cidade: text('cidade'),
    uf: varchar('uf', { length: 2 }),
    origem: contatoOrigem('origem').notNull(),
    baseLegal: baseLegal('base_legal').notNull(),
    consentimentoEm: timestamp('consentimento_em', { withTimezone: true }),
    status: contatoStatus('status').notNull().default('lead'),
    tags: jsonb('tags').notNull().$type<string[]>().default([]),
    notas: text('notas'),
    brevoId: text('brevo_id'),
    syncStatus: syncStatus('sync_status').notNull().default('pendente'),
    syncErro: text('sync_erro'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('contatos_email_normalizado_idx').on(t.emailNormalizado)],
)

export const eventosContato = pgTable(
  'eventos_contato',
  {
    id: serial('id').primaryKey(),
    contatoId: integer('contato_id')
      .notNull()
      .references(() => contatos.id, { onDelete: 'cascade' }),
    tipo: eventoContatoTipo('tipo').notNull(),
    dados: jsonb('dados').$type<Record<string, unknown>>(),
    em: timestamp('em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('eventos_contato_contato_em_idx').on(t.contatoId, t.em.desc())],
)

/**
 * Planilha enviada, guardada no servidor entre a pré-visualização e a confirmação: a
 * confirmação manda só o id do lote e o mapeamento, e as linhas são relidas daqui.
 * `conteudo` é apagado ao concluir; o lote inteiro some depois de 24 horas.
 */
export const importacoesContatos = pgTable('importacoes_contatos', {
  id: text('id').primaryKey(),
  nomeArquivo: text('nome_arquivo').notNull(),
  conteudo: text('conteudo'),
  totalLinhas: integer('total_linhas').notNull(),
  /** `pendente` → `processando` (reivindicado por uma confirmação) → `concluida`. */
  status: text('status').notNull().default('pendente'),
  relatorio: jsonb('relatorio'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  concluidoEm: timestamp('concluido_em', { withTimezone: true }),
})

export type Contato = typeof contatos.$inferSelect
export type EventoContato = typeof eventosContato.$inferSelect
export type ImportacaoContatos = typeof importacoesContatos.$inferSelect
