import {
  boolean,
  date,
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
export const topicOrigem = pgEnum('topic_origem', ['ia', 'gsc'])
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
