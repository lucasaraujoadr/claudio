import Link from 'next/link'
import { connection } from 'next/server'
import { count, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { auditIssues, auditRuns, gscSnapshots, topics } from '@/lib/db/schema'
import { diasDesde, montarOportunidades } from '@/lib/oportunidades'
import { calcularVariacao, escolherSnapshotComparacao, type Variacao } from '@/lib/visao-geral'

export const metadata = { title: 'Visão geral' }

const DIAS_GSC_DESATUALIZADO = 2
const DIAS_AUDITORIA_DESATUALIZADA = 14
const STATUS = ['ideia', 'escolhido', 'briefado', 'publicado'] as const
const ROTULO_STATUS: Record<(typeof STATUS)[number], string> = {
  ideia: 'Ideias',
  escolhido: 'Escolhidos',
  briefado: 'Briefados',
  publicado: 'Publicados',
}

type Resultado<T> = { ok: true; dados: T } | { ok: false }

/** Cada bloco carrega sozinho: uma fonte com erro não apaga os demais. */
async function carregar<T>(nome: string, fn: () => Promise<T>): Promise<Resultado<T>> {
  try {
    return { ok: true, dados: await fn() }
  } catch (e) {
    console.error(`visão geral: bloco ${nome} falhou:`, e instanceof Error ? e.name : 'erro')
    return { ok: false }
  }
}

type Totais = { clicks: number; impressions: number }
type DadosGsc = {
  data: string
  atual: Totais
  anterior: { data: string; totais: Totais } | null
  oportunidadesAbertas: number
}

async function totaisDe(data: string): Promise<Totais> {
  const [r] = await getDb()
    .select({
      clicks: sql<number>`coalesce(sum(${gscSnapshots.clicks}), 0)::int`,
      impressions: sql<number>`coalesce(sum(${gscSnapshots.impressions}), 0)::int`,
    })
    .from(gscSnapshots)
    .where(eq(gscSnapshots.snapshotDate, data))
  return { clicks: r?.clicks ?? 0, impressions: r?.impressions ?? 0 }
}

async function carregarGsc(): Promise<DadosGsc | null> {
  const db = getDb()
  const datas = (
    await db
      .selectDistinct({ data: gscSnapshots.snapshotDate })
      .from(gscSnapshots)
      .orderBy(desc(gscSnapshots.snapshotDate))
  ).map((r) => r.data)
  const ultima = datas[0]
  if (!ultima) return null

  const dataAnterior = escolherSnapshotComparacao(ultima, datas)
  const [atual, anterior, linhas] = await Promise.all([
    totaisDe(ultima),
    dataAnterior ? totaisDe(dataAnterior) : Promise.resolve(null),
    db.select().from(gscSnapshots).where(eq(gscSnapshots.snapshotDate, ultima)),
  ])
  const oportunidades = montarOportunidades(linhas)
  const comTema = new Set(
    oportunidades.length > 0 ? (await db.select({ keyword: topics.keyword }).from(topics)).map((t) => t.keyword) : [],
  )
  return {
    data: ultima,
    atual,
    anterior: dataAnterior && anterior ? { data: dataAnterior, totais: anterior } : null,
    oportunidadesAbertas: oportunidades.filter((o) => !comTema.has(o.query)).length,
  }
}

type DadosAuditoria = { data: Date; paginas: number; criticos: number }

async function carregarAuditoria(): Promise<DadosAuditoria | null> {
  const db = getDb()
  const [run] = await db
    .select()
    .from(auditRuns)
    .where(eq(auditRuns.status, 'concluido'))
    .orderBy(desc(auditRuns.id))
    .limit(1)
  if (!run) return null
  const [c] = await db
    .select({ total: count() })
    .from(auditIssues)
    .where(sql`${auditIssues.runId} = ${run.id} and ${auditIssues.severidade} = 'critico'`)
  return { data: run.finalizadoEm ?? run.iniciadoEm, paginas: run.paginasRastreadas, criticos: c?.total ?? 0 }
}

async function carregarTemas(): Promise<Record<(typeof STATUS)[number], number>> {
  const linhas = await getDb()
    .select({ status: topics.status, total: count() })
    .from(topics)
    .groupBy(topics.status)
  const porStatus = { ideia: 0, escolhido: 0, briefado: 0, publicado: 0 }
  for (const l of linhas) porStatus[l.status] = l.total
  return porStatus
}

const formatoDataHora = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

function formatarData(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

function dataIsoSaoPaulo(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
}

const fmt = (n: number) => n.toLocaleString('pt-BR')

function formatarVariacao(v: Variacao): string {
  const sinal = v.delta > 0 ? '+' : ''
  const pct =
    v.percentual === null
      ? 'sem base de comparação'
      : `${v.percentual > 0 ? '+' : ''}${v.percentual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
  return `${sinal}${fmt(v.delta)} (${pct})`
}

const CARTAO = 'rounded-lg border border-gray-300 p-4'
const VAZIO = 'rounded-lg border border-dashed border-gray-300 p-4'
const TEXTO_SUAVE = 'text-sm text-gray-600 dark:text-gray-400'

function Bloco({
  titulo,
  href,
  vazio,
  children,
}: {
  titulo: string
  href: string
  vazio?: boolean
  children: React.ReactNode
}) {
  return (
    <section className={vazio ? VAZIO : CARTAO}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{titulo}</h2>
        <Link href={href} className="text-sm text-blue-700 underline">
          Abrir
        </Link>
      </div>
      {children}
    </section>
  )
}

function Metrica({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div>
      <p className={TEXTO_SUAVE}>{rotulo}</p>
      <p className="text-2xl font-semibold">{valor}</p>
      {detalhe && <p className={TEXTO_SUAVE}>{detalhe}</p>}
    </div>
  )
}

function Indisponivel({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="text-sm text-red-900">{children}</p>
}

export default async function VisaoGeralPage() {
  await connection()
  const [gsc, auditoria, temas] = await Promise.all([
    carregar('gsc', carregarGsc),
    carregar('auditoria', carregarAuditoria),
    carregar('temas', carregarTemas),
  ])

  const diasGsc = gsc.ok && gsc.dados ? diasDesde(gsc.dados.data) : 0
  const diasAuditoria = auditoria.ok && auditoria.dados ? diasDesde(dataIsoSaoPaulo(auditoria.dados.data)) : 0
  const totalTemas = temas.ok ? STATUS.reduce((s, k) => s + temas.dados[k], 0) : 0

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Visão geral</h1>
        <p className={`mt-1 ${TEXTO_SUAVE}`}>Resumo dos módulos do painel de SEO.</p>
      </header>

      {gsc.ok && gsc.dados && diasGsc > DIAS_GSC_DESATUALIZADO && (
        <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Atenção: os dados do Search Console são de {formatarData(gsc.dados.data)}, há {diasGsc} dias. Não representam a situação atual.
        </p>
      )}
      {auditoria.ok && auditoria.dados && diasAuditoria > DIAS_AUDITORIA_DESATUALIZADA && (
        <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Atenção: a última auditoria foi há {diasAuditoria} dias. Rode um novo rastreamento.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {!gsc.ok ? (
          <>
            <Bloco titulo="Cliques e impressões" href="/oportunidades"><Indisponivel>Não foi possível carregar os dados do Search Console agora.</Indisponivel></Bloco>
            <Bloco titulo="Oportunidades abertas" href="/oportunidades"><Indisponivel>Não foi possível carregar os dados do Search Console agora.</Indisponivel></Bloco>
          </>
        ) : !gsc.dados ? (
          <>
            <Bloco titulo="Cliques e impressões" href="/oportunidades" vazio>
              <p className="font-medium">Search Console ainda não sincronizado</p>
              <p className={TEXTO_SUAVE}>Não há dados de cliques nem de impressões até a primeira sincronização.</p>
            </Bloco>
            <Bloco titulo="Oportunidades abertas" href="/oportunidades" vazio>
              <p className="font-medium">Search Console ainda não sincronizado</p>
              <p className={TEXTO_SUAVE}>Não sabemos quais termos são oportunidades até a primeira sincronização.</p>
            </Bloco>
          </>
        ) : (
          <>
            <Bloco titulo="Cliques e impressões" href="/oportunidades">
              <p className={TEXTO_SUAVE}>Search Console, janela de 28 dias, sincronizado em {formatarData(gsc.dados.data)}.</p>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <Metrica
                  rotulo="Cliques nos termos sincronizados"
                  valor={fmt(gsc.dados.atual.clicks)}
                  detalhe={gsc.dados.anterior ? formatarVariacao(calcularVariacao(gsc.dados.atual.clicks, gsc.dados.anterior.totais.clicks)) : undefined}
                />
                <Metrica
                  rotulo="Impressões nos termos sincronizados"
                  valor={fmt(gsc.dados.atual.impressions)}
                  detalhe={gsc.dados.anterior ? formatarVariacao(calcularVariacao(gsc.dados.atual.impressions, gsc.dados.anterior.totais.impressions)) : undefined}
                />
              </div>
              <p className={`mt-3 ${TEXTO_SUAVE}`}>
                {gsc.dados.anterior
                  ? `Variação em relação ao snapshot de ${formatarData(gsc.dados.anterior.data)}.`
                  : 'Comparação disponível após 28 dias de histórico.'}
              </p>
            </Bloco>
            <Bloco titulo="Oportunidades abertas" href="/oportunidades">
              <Metrica
                rotulo="Termos nas posições 5 a 20 sem tema"
                valor={fmt(gsc.dados.oportunidadesAbertas)}
                detalhe={gsc.dados.oportunidadesAbertas === 0 ? 'Nenhuma oportunidade aberta no último snapshot.' : undefined}
              />
            </Bloco>
          </>
        )}

        {!auditoria.ok ? (
          <Bloco titulo="Problemas críticos" href="/auditoria"><Indisponivel>Não foi possível carregar a auditoria agora.</Indisponivel></Bloco>
        ) : !auditoria.dados ? (
          <Bloco titulo="Problemas críticos" href="/auditoria" vazio>
            <p className="font-medium">O site ainda não foi rastreado</p>
            <p className={TEXTO_SUAVE}>Não sabemos se há problemas críticos até a primeira auditoria.</p>
          </Bloco>
        ) : (
          <Bloco titulo="Problemas críticos" href="/auditoria">
            <Metrica
              rotulo="Na última auditoria concluída"
              valor={fmt(auditoria.dados.criticos)}
              detalhe={`Rastreamento de ${formatoDataHora.format(auditoria.dados.data)} · ${auditoria.dados.paginas} páginas`}
            />
          </Bloco>
        )}

        {!temas.ok ? (
          <Bloco titulo="Temas por status" href="/temas"><Indisponivel>Não foi possível carregar os temas agora.</Indisponivel></Bloco>
        ) : totalTemas === 0 ? (
          <Bloco titulo="Temas por status" href="/temas" vazio>
            <p className="font-medium">Nenhum tema cadastrado</p>
            <p className={TEXTO_SUAVE}>Pesquise temas ou crie um a partir de uma oportunidade.</p>
          </Bloco>
        ) : (
          <Bloco titulo="Temas por status" href="/temas">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {STATUS.map((s) => (
                <div key={s}>
                  <dt className={TEXTO_SUAVE}>{ROTULO_STATUS[s]}</dt>
                  <dd className="text-2xl font-semibold">{fmt(temas.dados[s])}</dd>
                </div>
              ))}
            </dl>
          </Bloco>
        )}
      </div>
    </div>
  )
}
