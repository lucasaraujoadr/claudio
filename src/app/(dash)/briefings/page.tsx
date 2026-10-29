import { connection } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { briefingParaMarkdown } from '@/lib/ai/briefing'
import { briefingSchema } from '@/lib/ai/schemas'
import { getDb } from '@/lib/db'
import { briefings, topics } from '@/lib/db/schema'
import { Aviso, CabecalhoPagina, Cartao, EstadoVazio, Selo, cx } from '@/components/ui'
import { CopiarMarkdown } from './copiar-markdown'

export const metadata = { title: 'Briefings' }

const formatoData = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

export default async function BriefingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  await connection()
  const sp = await searchParams

  const lista = await getDb()
    .select({ id: briefings.id, topicId: briefings.topicId, title: briefings.title, criadoEm: briefings.criadoEm, tema: topics.titulo })
    .from(briefings)
    .innerJoin(topics, eq(briefings.topicId, topics.id))
    .orderBy(desc(briefings.criadoEm), desc(briefings.id))

  if (lista.length === 0) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <CabecalhoPagina secao="SEO" titulo="Briefings" subtitulo="Roteiros de conteúdo gerados para os temas escolhidos." />
        <EstadoVazio
          titulo="Nenhum briefing gerado ainda"
          explicacao={
            <>
              Escolha um tema em <a href="/temas" className="font-medium text-acento-texto underline">Temas</a> e use &ldquo;Gerar briefing&rdquo;.
            </>
          }
        />
      </div>
    )
  }

  const pedido = typeof sp.id === 'string' ? Number(sp.id) : NaN
  const doTema = typeof sp.tema === 'string' ? Number(sp.tema) : NaN
  // A lista vem do mais novo para o mais antigo: o primeiro do tema é o mais recente.
  const selecionado =
    lista.find((b) => b.id === pedido) ?? lista.find((b) => b.topicId === doTema) ?? lista[0]
  const [linha] = await getDb().select().from(briefings).where(eq(briefings.id, selecionado.id)).limit(1)
  const parsed = briefingSchema.safeParse({
    title: linha.title,
    metaDescription: linha.metaDescription,
    outline: linha.outline,
    faq: linha.faq,
    linksInternos: linha.linksInternos,
    keywordsSecundarias: linha.keywordsSecundarias,
  })
  const b = parsed.success ? parsed.data : null
  const ajustes = Array.isArray(linha.ajustes) ? (linha.ajustes as unknown[]) : []

  const SUBTITULO = 'text-sm font-semibold tracking-wide text-tinta-suave uppercase'

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <CabecalhoPagina secao="SEO" titulo="Briefings" subtitulo="Roteiros de conteúdo gerados para os temas escolhidos." />
      {sp.gerado === 'ok' && (
        <Aviso tipo="sucesso" role="status">
          Briefing gerado. O tema agora está como briefado.
        </Aviso>
      )}
      <div className="grid gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
        <nav aria-label="Briefings gerados">
          <ul className="space-y-1.5">
            {lista.map((i) => {
              const ativo = i.id === selecionado.id
              return (
                <li key={i.id}>
                  <a
                    href={`/briefings?id=${i.id}`}
                    aria-current={ativo ? 'page' : undefined}
                    className={cx(
                      'relative block rounded-lg border p-3 text-sm transition-colors',
                      ativo
                        ? 'border-acento/50 bg-acento-suave before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-acento'
                        : 'border-borda bg-superficie hover:bg-elevada',
                    )}
                  >
                    <span className="block font-medium text-tinta">{i.tema}</span>
                    <span className="mt-0.5 block text-xs text-tinta-suave">{formatoData.format(i.criadoEm)}</span>
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>

        {b ? (
          <Cartao as="article" className="min-w-0">
            <div className="space-y-6">
              <CopiarMarkdown markdown={briefingParaMarkdown(b)} />
              <header className="border-b border-borda pb-5">
                <p className={SUBTITULO}>Title</p>
                <h2 className="mt-1 font-titulo text-2xl leading-snug font-semibold text-tinta">{b.title}</h2>
                <p className={cx(SUBTITULO, 'mt-4')}>Meta description</p>
                <p className="mt-1 text-sm text-tinta">{b.metaDescription}</p>
                {(ajustes.includes('title') || ajustes.includes('metaDescription')) && (
                  <p className="mt-3 flex flex-wrap gap-2">
                    {ajustes.includes('title') && <Selo variante="aviso">Title encurtado automaticamente</Selo>}
                    {ajustes.includes('metaDescription') && <Selo variante="aviso">Meta description encurtada automaticamente</Selo>}
                  </p>
                )}
              </header>
              <section>
                <h3 className={SUBTITULO}>Estrutura</h3>
                <ol className="mt-2 list-decimal space-y-2 pl-5 text-tinta marker:text-tinta-suave">
                  {b.outline.map((s, i) => (
                    <li key={i} className="font-medium">
                      {s.h2}
                      {s.h3.length > 0 && (
                        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm font-normal text-tinta-suave">
                          {s.h3.map((h, j) => <li key={j}>{h}</li>)}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
              <section>
                <h3 className={SUBTITULO}>FAQ</h3>
                <dl className="mt-2 space-y-3">
                  {b.faq.map((f, i) => (
                    <div key={i} className="rounded-lg border border-borda bg-elevada p-3">
                      <dt className="font-medium text-tinta">{f.pergunta}</dt>
                      <dd className="mt-1 text-sm text-tinta-suave">{f.resposta}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section>
                <h3 className={SUBTITULO}>Links internos</h3>
                {b.linksInternos.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-tinta">
                    {b.linksInternos.map((l, i) => (
                      <li key={i}>{l.ancora}: <span className="break-all text-tinta-suave">{l.url}</span></li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-tinta-suave">Nenhum link interno sugerido.</p>
                )}
              </section>
              <section>
                <h3 className={SUBTITULO}>Keywords secundárias</h3>
                {b.keywordsSecundarias.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {b.keywordsSecundarias.map((k, i) => (
                      <li key={i}><Selo variante="neutro">{k}</Selo></li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-tinta-suave">Nenhuma.</p>
                )}
              </section>
            </div>
          </Cartao>
        ) : (
          <Aviso tipo="erro" role="alert">
            Este briefing está em um formato que não pôde ser lido.
          </Aviso>
        )}
      </div>
    </div>
  )
}
