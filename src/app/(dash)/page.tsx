import Link from 'next/link'
import type { ReactNode } from 'react'
import { connection } from 'next/server'
import { count, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { auditIssues, auditRuns, briefings, gscSnapshots, gscTotais, topics } from '@/lib/db/schema'
import { REGRA_INTERROMPIDO } from '@/lib/auditoria'
import { diasDesde } from '@/lib/oportunidades'
import { carregarOportunidadesDoSnapshot } from '@/lib/oportunidades-snapshot'
import { calcularVariacao, escolherComparacao, type Totais } from '@/lib/visao-geral'
import { Aviso, CabecalhoPagina, Cartao, EstadoVazio, Indicador, Selo } from '@/components/ui'
import { AvisoSearchConsole } from './_compartilhado/aviso-search-console'
import { GraficoSessoes, IndicadoresTrafego, legendaPeriodo } from './_compartilhado/bloco-trafego'
import { carregarDiarioGa4, carregarSincronizacoesSeguro, carregarTotaisGa4, carregarTotaisGsc } from './_compartilhado/carregar'
import { GraficosSearchConsole } from './_compartilhado/graficos-search-console'
import { seriesSearchConsole } from './_compartilhado/search-console'
import { emailContaServico, explicarSearchConsole, ultimaSincronizacaoOk } from './_compartilhado/sincronizacao'
import { resumirTrafego } from './_compartilhado/trafego'

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

type DadosGsc = {
  data: string
  atual: Totais
  /** De onde vem a comparação; null quando não há base honesta. */
  anterior: { totais: Totais; descricao: string } | null
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

  const [[linhaTotais], oportunidades] = await Promise.all([
    db.select().from(gscTotais).where(eq(gscTotais.snapshotDate, ultima)).limit(1),
    carregarOportunidadesDoSnapshot(),
  ])
  // Assuntos distintos sem tema, pela mesma regra de /oportunidades.
  const oportunidadesAbertas = oportunidades?.queriesAbertas ?? 0
  const fonte = escolherComparacao(ultima, datas, linhaTotais ?? null)

  if (fonte.tipo === 'totais') {
    // Atual e anterior vêm da mesma linha, somados pelo cron do mesmo jeito: par coerente.
    const { inicio, fim } = fonte.periodoAnterior
    return {
      data: ultima,
      atual: fonte.atual,
      anterior: {
        totais: fonte.anterior,
        descricao: `Variação em relação aos 28 dias anteriores (${formatarData(inicio)} a ${formatarData(fim)}), nos termos sincronizados.`,
      },
      oportunidadesAbertas,
    }
  }
  const [atual, anterior] = await Promise.all([
    totaisDe(ultima),
    fonte.tipo === 'snapshot' ? totaisDe(fonte.dataAnterior) : Promise.resolve(null),
  ])
  return {
    data: ultima,
    atual,
    anterior:
      fonte.tipo === 'snapshot' && anterior
        ? { totais: anterior, descricao: `Variação em relação ao snapshot de ${formatarData(fonte.dataAnterior)}.` }
        : null,
    oportunidadesAbertas,
  }
}

type DadosAuditoria = { data: Date; paginas: number; criticos: number; incompleta: boolean }

async function carregarAuditoria(): Promise<DadosAuditoria | null> {
  const db = getDb()
  const [run] = await db
    .select()
    .from(auditRuns)
    .where(eq(auditRuns.status, 'concluido'))
    .orderBy(desc(auditRuns.id))
    .limit(1)
  if (!run) return null
  const [[c], [interrompido]] = await Promise.all([
    db
      .select({ total: count() })
      .from(auditIssues)
      .where(sql`${auditIssues.runId} = ${run.id} and ${auditIssues.severidade} = 'critico'`),
    db
      .select({ id: auditIssues.id })
      .from(auditIssues)
      .where(sql`${auditIssues.runId} = ${run.id} and ${auditIssues.regra} = ${REGRA_INTERROMPIDO}`)
      .limit(1),
  ])
  return {
    data: run.finalizadoEm ?? run.iniciadoEm,
    paginas: run.paginasRastreadas,
    criticos: c?.total ?? 0,
    incompleta: interrompido !== undefined,
  }
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

async function carregarUltimosBriefings() {
  return getDb()
    .select({ id: briefings.id, criadoEm: briefings.criadoEm, tema: topics.titulo })
    .from(briefings)
    .innerJoin(topics, eq(briefings.topicId, topics.id))
    .orderBy(desc(briefings.criadoEm), desc(briefings.id))
    .limit(3)
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

const CLASSE_LINK = 'text-sm font-medium text-acento-texto underline-offset-4 hover:underline'

function Abrir({ href, rotulo = 'Abrir' }: { href: string; rotulo?: string }) {
  return (
    <Link href={href} className={CLASSE_LINK}>
      {rotulo} <span aria-hidden="true">→</span>
    </Link>
  )
}

/** Cartão de um módulo: título, link para a tela e o conteúdo (ou o estado vazio). */
function Bloco({
  titulo,
  descricao,
  href,
  rotuloLink,
  className,
  children,
}: {
  titulo: string
  descricao?: ReactNode
  href: string
  rotuloLink?: string
  className?: string
  children: ReactNode
}) {
  return (
    <Cartao titulo={titulo} descricao={descricao} acoes={<Abrir href={href} rotulo={rotuloLink} />} className={className}>
      {children}
    </Cartao>
  )
}

function Indisponivel({ children }: { children: ReactNode }) {
  return <Aviso tipo="erro">{children}</Aviso>
}

function SemDado({ titulo, children }: { titulo: string; children: ReactNode }) {
  return <EstadoVazio titulo={titulo} explicacao={children} nivelTitulo={3} className="py-6" />
}

export default async function VisaoGeralPage() {
  await connection()
  const [gsc, auditoria, temas, trafego, totaisGsc, ultimosBriefings, sinc, totaisGa4] = await Promise.all([
    carregar('gsc', carregarGsc),
    carregar('auditoria', carregarAuditoria),
    carregar('temas', carregarTemas),
    carregar('tráfego', () => carregarDiarioGa4()),
    carregar('totais gsc', () => carregarTotaisGsc()),
    carregar('briefings', carregarUltimosBriefings),
    carregarSincronizacoesSeguro(),
    carregar('totais ga4', carregarTotaisGa4),
  ])

  const diasGsc = gsc.ok && gsc.dados ? diasDesde(gsc.dados.data) : 0
  const diasAuditoria = auditoria.ok && auditoria.dados ? diasDesde(dataIsoSaoPaulo(auditoria.dados.data)) : 0
  const totalTemas = temas.ok ? STATUS.reduce((s, k) => s + temas.dados[k], 0) : 0
  const resumoTrafego = trafego.ok ? resumirTrafego(trafego.dados, ultimaSincronizacaoOk(sinc?.ga4)) : null
  const explicacaoGsc = sinc ? explicarSearchConsole(sinc.gsc, gsc.ok && gsc.dados !== null, emailContaServico()) : null

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <CabecalhoPagina
        secao="Painel"
        titulo="Visão geral"
        subtitulo="Tráfego, Search Console, auditoria e conteúdo num só lugar. Cada bloco leva ao seu módulo."
      />

      {explicacaoGsc && <AvisoSearchConsole explicacao={explicacaoGsc} />}
      {gsc.ok && gsc.dados && diasGsc > DIAS_GSC_DESATUALIZADO && (
        <Aviso tipo="alerta" role="alert">
          Atenção: os dados do Search Console são de {formatarData(gsc.dados.data)}, há {diasGsc} dias. Não representam a situação atual.
        </Aviso>
      )}
      {auditoria.ok && auditoria.dados && diasAuditoria > DIAS_AUDITORIA_DESATUALIZADA && (
        <Aviso tipo="alerta" role="alert">
          Atenção: a última auditoria foi há {diasAuditoria} dias. Rode um novo rastreamento.
        </Aviso>
      )}

      {/* Tráfego: o único bloco com dado real todos os dias. */}
      <Bloco
        titulo="Tráfego do site"
        descricao={resumoTrafego ? legendaPeriodo(resumoTrafego) : 'Google Analytics, últimos 28 dias.'}
        href="/trafego"
        rotuloLink="Abrir tráfego"
      >
        {!trafego.ok ? (
          <Indisponivel>Não foi possível carregar os dados do Google Analytics agora.</Indisponivel>
        ) : !resumoTrafego ? (
          <SemDado titulo="Google Analytics ainda não sincronizado">
            Não há sessões gravadas até a primeira sincronização. Não é zero visita: só não sabemos ainda.
          </SemDado>
        ) : (
          <div className="space-y-6">
            <IndicadoresTrafego
              resumo={resumoTrafego}
              usuarios={totaisGa4.ok ? totaisGa4.dados : null}
              falhaUsuarios={!totaisGa4.ok}
            />
            <GraficoSessoes dias={trafego.dados} resumo={resumoTrafego} altura={200} comEngajadas={false} />
          </div>
        )}
      </Bloco>

      <div className="grid gap-6 lg:grid-cols-2">
        {!gsc.ok ? (
          <>
            <Bloco titulo="Cliques e impressões" href="/oportunidades"><Indisponivel>Não foi possível carregar os dados do Search Console agora.</Indisponivel></Bloco>
            <Bloco titulo="Oportunidades abertas" href="/oportunidades"><Indisponivel>Não foi possível carregar os dados do Search Console agora.</Indisponivel></Bloco>
          </>
        ) : !gsc.dados ? (
          <>
            <Bloco titulo="Cliques e impressões" href="/oportunidades" descricao="Search Console, janela de 28 dias.">
              {/* O gráfico por dia ocupa este lugar no estado "sem dado", com o motivo. */}
              <GraficosSearchConsole
                series={totaisGsc.ok ? seriesSearchConsole(totaisGsc.dados) : undefined}
                explicacao={explicacaoGsc}
              />
            </Bloco>
            <Bloco titulo="Oportunidades abertas" href="/oportunidades" descricao="Termos nas posições 5 a 20 sem tema.">
              <SemDado titulo="Search Console ainda não sincronizado">
                Não sabemos quais termos são oportunidades até a primeira sincronização.
              </SemDado>
            </Bloco>
          </>
        ) : (
          <>
            <Bloco
              titulo="Cliques e impressões"
              href="/oportunidades"
              descricao={`Search Console, janela de 28 dias, sincronizado em ${formatarData(gsc.dados.data)}.`}
            >
              <div className="grid grid-cols-2 gap-6">
                <Indicador
                  rotulo="Cliques nos termos sincronizados"
                  valor={gsc.dados.atual.clicks}
                  variacao={gsc.dados.anterior ? calcularVariacao(gsc.dados.atual.clicks, gsc.dados.anterior.totais.clicks) : null}
                />
                <Indicador
                  rotulo="Impressões nos termos sincronizados"
                  valor={gsc.dados.atual.impressions}
                  variacao={gsc.dados.anterior ? calcularVariacao(gsc.dados.atual.impressions, gsc.dados.anterior.totais.impressions) : null}
                />
              </div>
              <p className="mt-4 text-xs text-tinta-suave">
                {gsc.dados.anterior ? gsc.dados.anterior.descricao : 'Comparação disponível após 28 dias de histórico.'}
              </p>
            </Bloco>
            <Bloco titulo="Oportunidades abertas" href="/oportunidades">
              <Indicador
                rotulo="Termos nas posições 5 a 20 sem tema"
                valor={gsc.dados.oportunidadesAbertas}
                detalhe={gsc.dados.oportunidadesAbertas === 0 ? 'Nenhuma oportunidade aberta no último snapshot.' : undefined}
              />
            </Bloco>
          </>
        )}
      </div>

      {gsc.ok && gsc.dados && (
      <Bloco
        titulo="Search Console por dia"
        descricao="Cliques e impressões da janela de 28 dias, a cada sincronização."
        href="/oportunidades"
        rotuloLink="Abrir oportunidades"
      >
        <GraficosSearchConsole
          series={totaisGsc.ok ? seriesSearchConsole(totaisGsc.dados) : undefined}
          explicacao={null}
        />
      </Bloco>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {!auditoria.ok ? (
          <Bloco titulo="Problemas críticos" href="/auditoria"><Indisponivel>Não foi possível carregar a auditoria agora.</Indisponivel></Bloco>
        ) : !auditoria.dados ? (
          <Bloco titulo="Problemas críticos" href="/auditoria">
            <SemDado titulo="O site ainda não foi rastreado">Não sabemos se há problemas críticos até a primeira auditoria.</SemDado>
          </Bloco>
        ) : (
          <Bloco titulo="Problemas críticos" href="/auditoria">
            <Indicador
              rotulo="Na última auditoria concluída"
              valor={auditoria.dados.criticos}
              detalhe={`Rastreamento de ${formatoDataHora.format(auditoria.dados.data)} · ${auditoria.dados.paginas} páginas`}
            />
            {auditoria.dados.criticos > 0 && (
              <p className="mt-3">
                <Selo variante="critico">{fmt(auditoria.dados.criticos)} {auditoria.dados.criticos === 1 ? 'crítico' : 'críticos'} para corrigir</Selo>
              </p>
            )}
            {auditoria.dados.incompleta && (
              <Aviso tipo="alerta" role="alert" className="mt-3">
                Auditoria incompleta: o rastreamento foi interrompido por tempo depois de {auditoria.dados.paginas} páginas.
                Pode haver problemas críticos nas páginas não visitadas.
              </Aviso>
            )}
          </Bloco>
        )}

        {!temas.ok ? (
          <Bloco titulo="Temas por status" href="/temas"><Indisponivel>Não foi possível carregar os temas agora.</Indisponivel></Bloco>
        ) : totalTemas === 0 ? (
          <Bloco titulo="Temas por status" href="/temas">
            <SemDado titulo="Nenhum tema cadastrado">Pesquise temas ou crie um a partir de uma oportunidade.</SemDado>
          </Bloco>
        ) : (
          <Bloco titulo="Temas por status" href="/temas" descricao={`${fmt(totalTemas)} temas no total.`}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              {STATUS.map((s) => (
                <div key={s}>
                  <dt className="text-sm text-tinta-suave">
                    <Link href={`/temas?filtro=${s}`} className="hover:text-tinta hover:underline">{ROTULO_STATUS[s]}</Link>
                  </dt>
                  <dd className="mt-0.5 text-2xl font-semibold text-tinta">{fmt(temas.dados[s])}</dd>
                </div>
              ))}
            </dl>
          </Bloco>
        )}

        {!ultimosBriefings.ok ? (
          <Bloco titulo="Últimos briefings" href="/briefings"><Indisponivel>Não foi possível carregar os briefings agora.</Indisponivel></Bloco>
        ) : ultimosBriefings.dados.length === 0 ? (
          <Bloco titulo="Últimos briefings" href="/briefings">
            <SemDado titulo="Nenhum briefing gerado ainda">Escolha um tema em Temas e use &ldquo;Gerar briefing&rdquo;.</SemDado>
          </Bloco>
        ) : (
          <Bloco titulo="Últimos briefings" href="/briefings">
            <ul className="-my-2 divide-y divide-borda">
              {ultimosBriefings.dados.map((b) => (
                <li key={b.id} className="py-2.5">
                  <Link href={`/briefings?id=${b.id}`} className="block text-sm font-medium text-tinta hover:text-acento-texto hover:underline">
                    {b.tema}
                  </Link>
                  <p className="mt-0.5 text-xs text-tinta-suave">{formatoDataHora.format(b.criadoEm)}</p>
                </li>
              ))}
            </ul>
          </Bloco>
        )}
      </div>
    </div>
  )
}
